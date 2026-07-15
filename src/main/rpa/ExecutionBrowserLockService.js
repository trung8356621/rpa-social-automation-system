import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** SQLite settings key — when true, Execute locks the automation browser against user input. */
export const EXECUTION_BROWSER_LOCK_SETTING_KEY = 'execution_browser_lock';

/** Default: lock enabled. */
export const DEFAULT_EXECUTION_BROWSER_LOCK = true;

/** Watchdog force-unlock if Execute never calls unlock (ms). */
export const DEFAULT_BROWSER_LOCK_WATCHDOG_MS = 30 * 60 * 1000;

/** Re-apply Win32 disable for new Chrome windows during a lock (ms). */
const WIN32_REFRESH_INTERVAL_MS = 2000;

/**
 * Resolve lock enabled flag from settings.
 * @param {Record<string, unknown>} [settings]
 * @returns {boolean}
 */
export function resolveExecutionBrowserLockEnabled(settings = {}) {
  const raw = settings?.[EXECUTION_BROWSER_LOCK_SETTING_KEY];
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true;
  return DEFAULT_EXECUTION_BROWSER_LOCK;
}

/**
 * Strategy: disable Chromium HWNDs via Win32 EnableWindow(FALSE).
 * User mouse/keyboard to those windows is blocked; CDP/Puppeteer still injects normally.
 * Does not use BlockInput (would freeze the whole desktop including Electron).
 */
export class Win32DisableWindowStrategy {
  get name() {
    return 'win32_disable_window';
  }

  isSupported() {
    return process.platform === 'win32';
  }

  async lock({ browser, page }) {
    const pid = resolveBrowserPid(browser, page);
    if (!pid) {
      return { ok: false, reason: 'no_browser_pid', hwnds: [] };
    }

    const hwnds = await disableProcessWindows(pid);
    if (!hwnds.length) {
      return { ok: false, reason: 'no_visible_windows', hwnds: [] };
    }

    const refreshTimer = setInterval(() => {
      disableProcessWindows(pid).catch(() => {});
    }, WIN32_REFRESH_INTERVAL_MS);
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref();

    return {
      ok: true,
      strategy: this.name,
      pid,
      hwnds,
      refreshTimer,
    };
  }

  async unlock(session) {
    if (session?.refreshTimer) {
      clearInterval(session.refreshTimer);
      session.refreshTimer = null;
    }
    const pid = session?.pid;
    if (!pid) return { ok: true, strategy: this.name };
    await enableProcessWindows(pid);
    return { ok: true, strategy: this.name };
  }
}

/**
 * Strategy: transparent always-on-top Electron overlays covering Chromium windows.
 * Cross-platform fallback; blocks mouse to windows below. Keyboard is best-effort
 * (overlay focuses itself when shown).
 */
export class OverlayWindowStrategy {
  get name() {
    return 'overlay_window';
  }

  isSupported() {
    return Boolean(process.versions?.electron);
  }

  async lock({ browser, page }) {
    const pid = resolveBrowserPid(browser, page);
    let BrowserWindow;
    try {
      ({ BrowserWindow } = await import('electron'));
    } catch (error) {
      return { ok: false, reason: error.message || 'electron_unavailable' };
    }

    const boundsList = pid
      ? await listProcessWindowBounds(pid)
      : [];

    const overlays = [];
    const targets = boundsList.length > 0
      ? boundsList
      : [{ x: 0, y: 0, width: 1280, height: 720 }];

    for (const bounds of targets) {
      const overlay = new BrowserWindow({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      overlay.setMenuBarVisibility(false);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.setIgnoreMouseEvents(false);

      const html = encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;width:100%;height:100%;cursor:not-allowed;
  background:rgba(0,0,0,0.01);user-select:none;-webkit-user-select:none;}
</style></head>
<body tabindex="0"
  oncontextmenu="return false"
  onmousedown="return false"
  onmouseup="return false"
  onmousemove="return false"
  onwheel="return false"
  onkeydown="return false"
  onkeyup="return false"
  ondragstart="return false"></body></html>`);

      await overlay.loadURL(`data:text/html;charset=utf-8,${html}`);
      overlay.showInactive();
      overlay.focus();
      overlays.push(overlay);
    }

    let refreshTimer = null;
    if (pid) {
      refreshTimer = setInterval(() => {
        refreshOverlayBounds(overlays, pid).catch(() => {});
      }, WIN32_REFRESH_INTERVAL_MS);
      if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
    }

    return {
      ok: overlays.length > 0,
      strategy: this.name,
      pid,
      overlays,
      refreshTimer,
    };
  }

  async unlock(session) {
    if (session?.refreshTimer) {
      clearInterval(session.refreshTimer);
      session.refreshTimer = null;
    }
    const overlays = session?.overlays || [];
    for (const overlay of overlays) {
      try {
        if (overlay && !overlay.isDestroyed()) overlay.destroy();
      } catch {
        // Ignore destroy races.
      }
    }
    if (session) session.overlays = [];
    return { ok: true, strategy: this.name };
  }
}

/**
 * Composite strategy: try Win32 first on Windows, then Overlay.
 */
export class CompositeBrowserLockStrategy {
  constructor(strategies = []) {
    this.strategies = strategies.length > 0
      ? strategies
      : [new Win32DisableWindowStrategy(), new OverlayWindowStrategy()];
  }

  get name() {
    return 'composite';
  }

  async lock(ctx) {
    const errors = [];
    for (const strategy of this.strategies) {
      if (!strategy.isSupported?.()) continue;
      try {
        const result = await strategy.lock(ctx);
        if (result?.ok) {
          return { ...result, activeStrategy: strategy };
        }
        errors.push(`${strategy.name}:${result?.reason || 'failed'}`);
      } catch (error) {
        errors.push(`${strategy.name}:${error.message || error}`);
      }
    }
    return { ok: false, reason: errors.join('; ') || 'no_strategy' };
  }

  async unlock(session) {
    const strategy = session?.activeStrategy;
    if (strategy) {
      return strategy.unlock(session);
    }
    // Fallback: try all strategies' unlock cleanup.
    for (const s of this.strategies) {
      try {
        await s.unlock(session);
      } catch {
        // Ignore.
      }
    }
    return { ok: true };
  }
}

/**
 * System-level Execution Browser Lock.
 * Executor calls lock/unlock only — no lock logic inside Executor.
 */
export class ExecutionBrowserLockService {
  constructor({ strategy = null, watchdogTimeoutMs = DEFAULT_BROWSER_LOCK_WATCHDOG_MS } = {}) {
    this._strategy = strategy || new CompositeBrowserLockStrategy();
    this._watchdogTimeoutMs = watchdogTimeoutMs;
    /** @type {Map<string, object>} */
    this._locks = new Map();
    this._exitHandlersInstalled = false;
    this._installExitHandlers();
  }

  /**
   * @param {string} [executionId]
   * @returns {boolean}
   */
  isLocked(executionId) {
    if (executionId) return this._locks.has(String(executionId));
    return this._locks.size > 0;
  }

  /**
   * Lock the automation browser against physical user input.
   * No-op when already locked for the same executionId, headless, or missing browser.
   */
  async lock({
    executionId,
    browser = null,
    page = null,
    headless = false,
    timeoutMs = null,
  } = {}) {
    const id = String(executionId || '').trim();
    if (!id) {
      throw new Error('[BrowserLock] executionId is required.');
    }
    if (this._locks.has(id)) {
      return { ok: true, alreadyLocked: true, executionId: id };
    }
    if (headless) {
      console.log('[BrowserLock] Skip lock (headless).');
      return { ok: true, skipped: true, reason: 'headless', executionId: id };
    }
    if (!browser) {
      console.warn('[BrowserLock] Skip lock (no browser).');
      return { ok: true, skipped: true, reason: 'no_browser', executionId: id };
    }

    console.log('[BrowserLock] Lock browser.');
    const session = await this._strategy.lock({ browser, page, executionId: id });
    if (!session?.ok) {
      console.warn(`[BrowserLock] Lock failed: ${session?.reason || 'unknown'}`);
      return { ok: false, reason: session?.reason || 'lock_failed', executionId: id };
    }

    const watchdogMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : this._watchdogTimeoutMs;

    const watchdog = setTimeout(() => {
      this._watchdogForceUnlock(id).catch(() => {});
    }, watchdogMs);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    this._locks.set(id, {
      ...session,
      executionId: id,
      watchdog,
      lockedAt: Date.now(),
    });

    console.log(`[BrowserLock] Locked via ${session.strategy || 'unknown'} (execution=${id}).`);
    return { ok: true, executionId: id, strategy: session.strategy };
  }

  /**
   * Unlock browser for an execution. Safe to call multiple times.
   */
  async unlock(executionId) {
    const id = String(executionId || '').trim();
    if (!id) return { ok: true, skipped: true, reason: 'no_execution_id' };

    const session = this._locks.get(id);
    if (!session) {
      return { ok: true, alreadyUnlocked: true, executionId: id };
    }

    this._locks.delete(id);
    if (session.watchdog) {
      clearTimeout(session.watchdog);
      session.watchdog = null;
    }

    console.log('[BrowserLock] Unlock browser.');
    try {
      await this._strategy.unlock(session);
    } catch (error) {
      console.warn(`[BrowserLock] Unlock error: ${error.message || error}`);
      return { ok: false, error: error.message || String(error), executionId: id };
    }
    return { ok: true, executionId: id };
  }

  /** Unlock every active lock (process shutdown / crash recovery). */
  async unlockAll(reason = 'unlock_all') {
    const ids = [...this._locks.keys()];
    for (const id of ids) {
      console.log(`[BrowserLock] Unlock all (${reason}): ${id}`);
      await this.unlock(id);
    }
  }

  async _watchdogForceUnlock(executionId) {
    if (!this._locks.has(executionId)) return;
    console.warn('[BrowserLock] Watchdog force unlock.');
    await this.unlock(executionId);
  }

  _installExitHandlers() {
    if (this._exitHandlersInstalled) return;
    this._exitHandlersInstalled = true;

    const forceUnlockSyncBestEffort = () => {
      for (const [id, session] of this._locks.entries()) {
        if (session.watchdog) clearTimeout(session.watchdog);
        if (session.refreshTimer) clearInterval(session.refreshTimer);
        // Best-effort sync unlock for Win32; overlays destroy on process exit.
        if (session.pid && process.platform === 'win32') {
          try {
            enableProcessWindowsSync(session.pid);
          } catch {
            // Ignore.
          }
        }
        this._locks.delete(id);
      }
    };

    process.once('exit', forceUnlockSyncBestEffort);
    process.once('SIGINT', () => {
      this.unlockAll('SIGINT').finally(() => process.exit(0));
    });
    process.once('SIGTERM', () => {
      this.unlockAll('SIGTERM').finally(() => process.exit(0));
    });
  }
}

function resolveBrowserPid(browser, page) {
  return browser?.process?.()?.pid
    || page?.browser?.()?.process?.()?.pid
    || null;
}

function buildWin32WindowScript(action, pid) {
  const mode = action === 'enable' ? 'enable' : action === 'list' ? 'list' : 'disable';
  return `
$signature = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class BrowserLockWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnableWindow(IntPtr hWnd, bool bEnable);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
Add-Type $signature -ErrorAction SilentlyContinue
$mode = '${mode}'
$targetPid = ${Number(pid)}
$targetPids = New-Object 'System.Collections.Generic.HashSet[UInt32]'
[void]$targetPids.Add([uint32]$targetPid)
$changed = $true
while ($changed) {
  $changed = $false
  Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.ParentProcessId -and $targetPids.Contains([uint32]$_.ParentProcessId) -and -not $targetPids.Contains([uint32]$_.ProcessId)) {
      [void]$targetPids.Add([uint32]$_.ProcessId)
      $changed = $true
    }
  }
}
$results = New-Object System.Collections.Generic.List[string]
[BrowserLockWin32]::EnumWindows({
  param($h, $l)
  $procId = 0
  [BrowserLockWin32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if (-not $targetPids.Contains([uint32]$procId)) { return $true }
  if (-not [BrowserLockWin32]::IsWindowVisible($h)) { return $true }
  if ([BrowserLockWin32]::GetWindowTextLength($h) -le 0) { return $true }
  $rect = New-Object BrowserLockWin32+RECT
  [BrowserLockWin32]::GetWindowRect($h, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left
  $ht = $rect.Bottom - $rect.Top
  if ($w -lt 80 -or $ht -lt 80) { return $true }
  if ($mode -eq 'disable') {
    [BrowserLockWin32]::EnableWindow($h, $false) | Out-Null
  } elseif ($mode -eq 'enable') {
    [BrowserLockWin32]::EnableWindow($h, $true) | Out-Null
  }
  $results.Add(("{0}|{1}|{2}|{3}|{4}" -f $h.ToInt64(), $rect.Left, $rect.Top, $w, $ht))
  return $true
}, [IntPtr]::Zero) | Out-Null
($results -join [char]10)
`;
}

async function disableProcessWindows(pid) {
  return runWin32WindowAction('disable', pid);
}

async function enableProcessWindows(pid) {
  return runWin32WindowAction('enable', pid);
}

function enableProcessWindowsSync(pid) {
  // Best-effort sync unlock on process exit.
  const script = buildWin32WindowScript('enable', pid);
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 8000,
  });
}

async function runWin32WindowAction(action, pid) {
  if (process.platform !== 'win32' || !pid) return [];
  const script = buildWin32WindowScript(action, pid);
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
    );
    return parseHwndLines(String(stdout || ''));
  } catch (error) {
    console.warn(`[BrowserLock] Win32 ${action} failed:`, error.message || error);
    return [];
  }
}

async function listProcessWindowBounds(pid) {
  const rows = await runWin32WindowAction('list', pid);
  return rows.map((row) => ({
    hwnd: row.hwnd,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
  }));
}

function parseHwndLines(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hwnd, x, y, width, height] = line.split('|').map((v) => Number(v));
      return {
        hwnd,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
      };
    })
    .filter((row) => row.hwnd && row.width > 0 && row.height > 0);
}

async function refreshOverlayBounds(overlays, pid) {
  const boundsList = await listProcessWindowBounds(pid);
  if (!boundsList.length || !overlays?.length) return;
  const count = Math.min(overlays.length, boundsList.length);
  for (let i = 0; i < count; i += 1) {
    const overlay = overlays[i];
    const bounds = boundsList[i];
    if (!overlay || overlay.isDestroyed?.()) continue;
    try {
      overlay.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    } catch {
      // Ignore.
    }
  }
}

let sharedInstance = null;

export function getExecutionBrowserLockService() {
  if (!sharedInstance) {
    sharedInstance = new ExecutionBrowserLockService();
  }
  return sharedInstance;
}
