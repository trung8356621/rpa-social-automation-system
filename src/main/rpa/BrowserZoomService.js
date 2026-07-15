import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Allowed UI zoom presets (Chrome Menu → Zoom). */
export const ALLOWED_BROWSER_ZOOM_PERCENTS = [50, 67, 75, 80, 90, 100];

/** Default Record / Open Browser / Execute zoom (%). */
export const DEFAULT_BROWSER_ZOOM_PERCENT = 67;

/** SQLite settings key. */
export const BROWSER_ZOOM_SETTING_KEY = 'default_browser_zoom';

/**
 * Chrome preset factors for the labels above.
 * 67% in the Chrome UI is the 0.666 preset (not exactly 0.67).
 */
const PRESET_ZOOM_FACTORS = {
  50: 0.5,
  67: 0.666,
  75: 0.75,
  80: 0.8,
  90: 0.9,
  100: 1,
};

/** Discrete Chrome zoom ladder used by Ctrl+/-. */
const ZOOM_LADDER_PERCENTS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

const ZOOM_LEVEL_EPSILON = 0.02;
const ZOOM_FACTOR_EPSILON = 0.015;

function percentToZoomFactor(percent) {
  const normalized = normalizeBrowserZoomPercent(percent);
  return PRESET_ZOOM_FACTORS[normalized] ?? normalized / 100;
}

function percentToZoomLevel(percent) {
  return Math.log(percentToZoomFactor(percent)) / Math.log(1.2);
}

function zoomLevelsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < ZOOM_LEVEL_EPSILON;
}

function zoomFactorsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < ZOOM_FACTOR_EPSILON;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeBrowserZoomPercent(value) {
  const n = Number(value);
  if (ALLOWED_BROWSER_ZOOM_PERCENTS.includes(n)) return n;
  return DEFAULT_BROWSER_ZOOM_PERCENT;
}

/**
 * Resolve zoom % from app settings object.
 * @param {Record<string, unknown>} [settings]
 */
export function resolveBrowserZoomPercent(settings = {}) {
  return normalizeBrowserZoomPercent(settings?.[BROWSER_ZOOM_SETTING_KEY]);
}

/**
 * Applies real Chromium browser zoom (Menu → Zoom), not CSS zoom / setViewport.
 *
 * CDP does not expose HostZoomMap. Writing Preferences with a fake partition id
 * (e.g. "0") is silently ignored by Chromium — so Preferences alone must never
 * be treated as "zoom applied".
 *
 * Strategy order (headed):
 * 1. Electron webContents.setZoomFactor when available
 * 2. OS-level Ctrl+0 / Ctrl+/- (real Chrome Menu Zoom accelerator)
 * 3. Preferences seed only (updates known partition keys for next launch)
 */
export class BrowserZoomService {
  /**
   * Best-effort seed of HostZoomMap prefs before puppeteer.launch.
   * Only updates existing Chromium partition keys — never invents "0".
   * Does NOT guarantee zoom is applied; call applyDefaultZoom after page ready.
   */
  async prepareUserDataDir(userDataDir, percent = DEFAULT_BROWSER_ZOOM_PERCENT) {
    const targetPercent = normalizeBrowserZoomPercent(percent);
    const targetLevel = percentToZoomLevel(targetPercent);

    if (!userDataDir) {
      return { alreadyAtTarget: false, percent: targetPercent, zoomLevel: targetLevel, prepared: false };
    }

    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    let prefs = {};
    let existed = false;

    try {
      const raw = await fs.readFile(prefsPath, 'utf8');
      prefs = JSON.parse(raw);
      existed = true;
    } catch {
      await fs.mkdir(path.dirname(prefsPath), { recursive: true });
      prefs = {};
    }

    if (!prefs.partition || typeof prefs.partition !== 'object') {
      prefs.partition = {};
    }

    const alreadyAtTarget = this._prefsAlreadyAtTarget(prefs, targetLevel);
    const wrote = this._writeDefaultZoomLevel(prefs, targetLevel);
    this._clearPerHostZoomLevels(prefs);

    if (wrote || !existed) {
      await fs.writeFile(prefsPath, `${JSON.stringify(prefs)}\n`, 'utf8');
    }

    return {
      // Never trust Preferences alone for "already applied" — Chromium may ignore
      // unknown partition keys. Runtime keyboard/Electron must still verify/apply.
      alreadyAtTarget: false,
      prefsLookReady: existed && alreadyAtTarget && wrote !== false,
      percent: targetPercent,
      zoomLevel: targetLevel,
      prepared: true,
      prefsPath,
      prefsWrote: wrote,
    };
  }

  /**
   * Apply zoom after the page/target is ready. Call after goto when possible.
   * Does not change Puppeteer viewport or CSS zoom.
   */
  async applyDefaultZoom({
    page = null,
    browser = null,
    userDataDir = null,
    percent = DEFAULT_BROWSER_ZOOM_PERCENT,
    prepareResult = null,
  } = {}) {
    const targetPercent = normalizeBrowserZoomPercent(percent);
    const targetFactor = percentToZoomFactor(targetPercent);

    // Strategy 1 — Electron webContents (real zoom when page is Electron-hosted).
    const electronResult = await this._strategyElectronWebContents({
      page,
      percent: targetPercent,
      factor: targetFactor,
    });
    if (electronResult.ok) {
      this._logResult(electronResult, targetPercent);
      return electronResult;
    }

    // Strategy 2 — OS keyboard accelerators (real Chrome Menu → Zoom).
    // Preferences alone are unreliable; this is the headed Chromium path.
    const keyboardResult = await this._strategyKeyboard({
      page,
      browser,
      percent: targetPercent,
    });
    if (keyboardResult.ok) {
      this._logResult(keyboardResult, targetPercent);
      return keyboardResult;
    }

    // Strategy 3 — Preferences were seeded but cannot be verified as live zoom.
    if (prepareResult?.prepared && prepareResult?.prefsLookReady) {
      console.warn(
        '[BrowserZoom] Preferences look ready but live zoom could not be confirmed '
        + `(keyboard=${keyboardResult.reason || 'fail'}). `
        + 'Chromium may still be at 100%.',
      );
      return {
        ok: false,
        strategy: 'preferences_unverified',
        percent: targetPercent,
        reason: 'preferences_unverified',
      };
    }

    console.warn(
      `[BrowserZoom] Could not set browser zoom to ${targetPercent}% `
      + `(electron=${electronResult.reason || 'fail'}, `
      + `keyboard=${keyboardResult.reason || 'fail'})`,
    );
    return {
      ok: false,
      percent: targetPercent,
      strategies: { electron: electronResult, keyboard: keyboardResult },
      prepareResult,
      userDataDir,
    };
  }

  _logResult(result, targetPercent) {
    if (result.alreadyAtTarget) {
      console.log('[BrowserZoom] Browser already at target zoom.');
    } else {
      console.log(`[BrowserZoom] Set browser zoom: ${targetPercent}%`);
    }
  }

  /**
   * Strategy: Electron webContents zoom.
   */
  async _strategyElectronWebContents({ page, percent, factor }) {
    const electronWc = typeof page?.setZoomFactor === 'function'
      ? page
      : (page?.webContents && typeof page.webContents.setZoomFactor === 'function'
        ? page.webContents
        : null);

    if (!electronWc) {
      return { ok: false, reason: 'not_electron_webcontents' };
    }

    try {
      const current = typeof electronWc.getZoomFactor === 'function'
        ? Number(electronWc.getZoomFactor())
        : null;
      if (current != null && zoomFactorsEqual(current, factor)) {
        return { ok: true, strategy: 'electron', alreadyAtTarget: true, percent };
      }
      electronWc.setZoomFactor(factor);
      return { ok: true, strategy: 'electron', alreadyAtTarget: false, percent };
    } catch (error) {
      return { ok: false, reason: error.message || 'electron_zoom_failed' };
    }
  }

  /**
   * Strategy: OS-level Ctrl+0 then Ctrl+/- so Chromium chrome handles Menu Zoom.
   * page.keyboard / CDP Input cannot trigger browser-chrome zoom shortcuts.
   */
  async _strategyKeyboard({ page, browser, percent }) {
    if (process.platform !== 'win32') {
      return { ok: false, reason: 'keyboard_fallback_win32_only' };
    }

    const pid = browser?.process?.()?.pid || page?.browser?.()?.process?.()?.pid;
    if (!pid) {
      return { ok: false, reason: 'no_browser_pid' };
    }

    const stepsFrom100 = this._ctrlStepsFrom100(percent);
    if (stepsFrom100 === 0) {
      // Target is 100%: still send Ctrl+0 to reset any leftover site zoom.
      try {
        await this._sendChromeZoomHotkeys(pid, 0);
        return { ok: true, strategy: 'keyboard', alreadyAtTarget: false, percent, stepsFrom100: 0 };
      } catch (error) {
        return { ok: false, reason: error.message || 'keyboard_failed' };
      }
    }

    try {
      await this._sendChromeZoomHotkeys(pid, stepsFrom100);
      return { ok: true, strategy: 'keyboard', alreadyAtTarget: false, percent, stepsFrom100 };
    } catch (error) {
      return { ok: false, reason: error.message || 'keyboard_failed' };
    }
  }

  _prefsAlreadyAtTarget(prefs, targetLevel) {
    const defaults = prefs?.partition?.default_zoom_level;
    if (defaults == null) return false;

    if (typeof defaults === 'number') {
      return zoomLevelsEqual(defaults, targetLevel);
    }
    if (typeof defaults === 'object') {
      const entries = Object.entries(defaults).filter(([key]) => key !== '0');
      if (!entries.length) return false;
      return entries.every(([, v]) => zoomLevelsEqual(v, targetLevel));
    }
    return false;
  }

  /**
   * Update known Chromium partition zoom keys only.
   * @returns {boolean} whether any known key was updated
   */
  _writeDefaultZoomLevel(prefs, targetLevel) {
    const current = prefs.partition.default_zoom_level;

    if (typeof current === 'number') {
      prefs.partition.default_zoom_level = targetLevel;
      return true;
    }

    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const realKeys = Object.keys(current).filter((key) => key !== '0');
      if (realKeys.length === 0) {
        // Do not invent partition id "0" — Chromium ignores it.
        return false;
      }
      for (const key of realKeys) {
        current[key] = targetLevel;
      }
      // Drop bogus key if present.
      delete current['0'];
      prefs.partition.default_zoom_level = current;
      return true;
    }

    return false;
  }

  _clearPerHostZoomLevels(prefs) {
    const perHost = prefs?.partition?.per_host_zoom_levels;
    if (!perHost || typeof perHost !== 'object') return;
    for (const partId of Object.keys(perHost)) {
      if (partId === '0') {
        delete perHost[partId];
        continue;
      }
      perHost[partId] = {};
    }
  }

  _ctrlStepsFrom100(percent) {
    const target = normalizeBrowserZoomPercent(percent);
    const fromIdx = ZOOM_LADDER_PERCENTS.indexOf(100);
    const toIdx = ZOOM_LADDER_PERCENTS.indexOf(target);
    if (fromIdx < 0 || toIdx < 0) return 0;
    return toIdx - fromIdx;
  }

  async _sendChromeZoomHotkeys(pid, stepsFrom100) {
    const count = Math.abs(stepsFrom100);
    const vkZoom = stepsFrom100 < 0 ? 0xBD : 0xBB; // VK_OEM_MINUS / VK_OEM_PLUS
    const vkControl = 0x11;
    const vk0 = 0x30;
    const keyUp = 2;

    // Real Chrome Menu Zoom via OS accelerators (Ctrl+0, Ctrl+-).
    // CDP / page.keyboard cannot trigger browser-chrome zoom.
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ZoomWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
"@
$targetPid = ${Number(pid)}
$targetPids = New-Object 'System.Collections.Generic.HashSet[UInt32]'
[void]$targetPids.Add([uint32]$targetPid)
$changed = $true
while ($changed) {
  $changed = $false
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.ParentProcessId -and $targetPids.Contains([uint32]$_.ParentProcessId) -and -not $targetPids.Contains([uint32]$_.ProcessId)) {
      [void]$targetPids.Add([uint32]$_.ProcessId)
      $changed = $true
    }
  }
}
$script:hwnd = [IntPtr]::Zero
[ZoomWin32]::EnumWindows({
  param($h, $l)
  $procId = 0
  [ZoomWin32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($targetPids.Contains([uint32]$procId) -and [ZoomWin32]::IsWindowVisible($h)) {
    $script:hwnd = $h
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($script:hwnd -eq [IntPtr]::Zero) { throw 'No visible Chromium window' }

[ZoomWin32]::AllowSetForegroundWindow(-1) | Out-Null
[ZoomWin32]::ShowWindow($script:hwnd, 9) | Out-Null
[ZoomWin32]::BringWindowToTop($script:hwnd) | Out-Null
$fore = [ZoomWin32]::GetForegroundWindow()
$curTid = [ZoomWin32]::GetCurrentThreadId()
$forePid = 0
$foreTid = [ZoomWin32]::GetWindowThreadProcessId($fore, [ref]$forePid)
if ($foreTid -ne 0 -and $foreTid -ne $curTid) {
  [ZoomWin32]::AttachThreadInput($curTid, $foreTid, $true) | Out-Null
}
[ZoomWin32]::SetForegroundWindow($script:hwnd) | Out-Null
if ($foreTid -ne 0 -and $foreTid -ne $curTid) {
  [ZoomWin32]::AttachThreadInput($curTid, $foreTid, $false) | Out-Null
}
Start-Sleep -Milliseconds 300

function Send-Chord([byte]$mod, [byte]$key) {
  [ZoomWin32]::keybd_event($mod, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [ZoomWin32]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [ZoomWin32]::keybd_event($key, 0, ${keyUp}, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [ZoomWin32]::keybd_event($mod, 0, ${keyUp}, [UIntPtr]::Zero)
}

# Reset to 100%
Send-Chord ${vkControl} ${vk0}
Start-Sleep -Milliseconds 150

for ($i = 0; $i -lt ${count}; $i++) {
  Send-Chord ${vkControl} ${vkZoom}
  Start-Sleep -Milliseconds 100
}
`;

    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 20000,
    });
  }
}

let sharedInstance = null;

export function getBrowserZoomService() {
  if (!sharedInstance) {
    sharedInstance = new BrowserZoomService();
  }
  return sharedInstance;
}
