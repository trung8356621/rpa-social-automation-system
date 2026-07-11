import { getElementAnchorHelpersScript } from './ElementAnchorScript.js';
import { ensureRememberMeChecked, isCheckboxAlreadyChecked, resolveGuestSessionDir } from '../browser/BrowserSessionPaths.js';
import { resolveScenarioTargetUrl, resolveVariableTemplate } from './VariableResolver.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import puppeteer from 'puppeteer';

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_ACTION_DELAY_MS = 300;
const execFileAsync = promisify(execFile);
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

class RecorderService {
  constructor({ appDataPath, dbService, browserProfileService } = {}) {
    if (!appDataPath) {
      throw new Error('[Recorder] appDataPath is required.');
    }
    if (!dbService) {
      throw new Error('[Recorder] dbService is required.');
    }

    this.appDataPath = appDataPath;
    this.dbService = dbService;
    this.browserProfileService = browserProfileService || null;
    this.browser = null;
    this.page = null;
    this.cdpSession = null;
    this.isRecording = false;
    this.recordedEvents = [];
    this.frames = [];
    this.startTime = 0;
    this.lastEventTime = 0;
    this.frameCounter = 0;
    this.cacheDir = '';
    this.framesDir = '';
    this.scenario = null;
    this.mode = 'replace';
    this.importWarning = null;
    this.previewWarning = null;
    this.viewport = DEFAULT_VIEWPORT;
    this.devicePixelRatio = 1;
    this.usedUserDataDir = null;
    this._screenshotTimer = null;
    this._screenshotInProgress = false;
    this._lastScreenshotPromise = null;
    // Luu lai importProfileId de dung khi openBrowser
    this.lastImportProfileId = null;
    this._stopping = false;
    this._stopPromise = null;
    this._recordingFrameHandler = null;
    this._recordingWidgetConfig = { debounce_keydown: { debounce_ms: 300 } };
  }

  async startRecording({ scenario, scenarioId: payloadScenarioId, targetUrl, viewport = DEFAULT_VIEWPORT, mode = 'replace', importProfileId = null } = {}) {
    if (this.isRecording) {
      throw new Error('Dang co phien record dang chay. Hay Stop truoc khi Record moi.');
    }

    const existingScenario = payloadScenarioId ? this.dbService.getScenarioById(payloadScenarioId) : null;
    const scenarioId = scenario?.id || payloadScenarioId || crypto.randomUUID();
    const sourceScenario = scenario || existingScenario || {};
    const settings = this.dbService.getSettings();
    const effectiveViewport = this._getViewportFromSettings(settings, viewport);
    const rawTargetUrl = targetUrl || sourceScenario?.target_url || 'about:blank';
    const variableMap = this.dbService.buildVariableMap(scenarioId, null);
    const resolvedTargetUrl = resolveScenarioTargetUrl(rawTargetUrl, variableMap);
    const safeScenario = {
      id: scenarioId,
      name: sourceScenario?.name || 'Kich ban moi',
      description: sourceScenario?.description || '',
      platform: sourceScenario?.platform || 'custom',
      target_url: resolvedTargetUrl,
      recorded_width: effectiveViewport.width,
      recorded_height: effectiveViewport.height,
      device_pixel_ratio: sourceScenario?.device_pixel_ratio || 1,
      browser_profile_id: sourceScenario?.browser_profile_id || existingScenario?.browser_profile_id || null,
      scenario_type: sourceScenario?.scenario_type || existingScenario?.scenario_type || 'action',
      parent_id: sourceScenario?.parent_id || existingScenario?.parent_id || null,
      dom_check_anchor: sourceScenario?.dom_check_anchor || existingScenario?.dom_check_anchor || null,
      scenario_meta: sourceScenario?.scenario_meta || existingScenario?.scenario_meta || {},
    };

    this._recordingWidgetConfig = this._resolveGlobalWidgetConfig(safeScenario.scenario_meta);

    const effectiveImportProfileId = importProfileId
      ?? existingScenario?.browser_profile_id
      ?? sourceScenario?.browser_profile_id
      ?? null;

    this.scenario = safeScenario;
    this.mode = mode === 'append' ? 'append' : 'replace';
    this.lastImportProfileId = effectiveImportProfileId;
    this.viewport = {
      width: safeScenario.recorded_width,
      height: safeScenario.recorded_height,
    };
    this.recordedEvents = [];
    this.frames = [];
    this.frameCounter = 0;
    this.startTime = Date.now();
    this.lastEventTime = this.startTime;
    this.importWarning = null;
    this.previewWarning = null;
    this.cacheDir = this._getScenarioStorageDir(scenarioId);
    this.framesDir = path.join(this.cacheDir, 'frames');
    if (this.mode === 'replace') {
      await fs.rm(this.framesDir, { recursive: true, force: true }).catch(() => {});
    }
    await fs.mkdir(this.framesDir, { recursive: true });

    // Lay settings tu DB (su dung root browser.userDataDir lam noi debug frame/profile)
    const configuredUserDataDir = settings?.['browser.userDataDir'];

    if (configuredUserDataDir) {
      await fs.mkdir(path.join(configuredUserDataDir, 'profiles'), { recursive: true });
      await fs.mkdir(path.join(configuredUserDataDir, 'imports'), { recursive: true });
      await fs.mkdir(path.join(configuredUserDataDir, 'storage'), { recursive: true });
      await fs.mkdir(path.join(configuredUserDataDir, 'guest'), { recursive: true });
    }

    const userDataDir = await this._resolveRecordingUserDataDir(scenarioId, effectiveImportProfileId);
    this.usedUserDataDir = userDataDir;

    this.isRecording = true;
    this._stopping = false;

    try {
      if (this.browserProfileService) {
        await this.browserProfileService.waitForProfileUnlock(userDataDir);
      }

      this.browser = await puppeteer.launch({
        headless: false,
        defaultViewport: this.viewport,
        userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          `--window-size=${this.viewport.width},${this.viewport.height}`,
        ],
      });

      this.browser.on('disconnected', () => {
        this._handleBrowserDisconnected();
      });
      await this._releaseBrowserTopMost();

      this.page = await this.browser.newPage();
      await this._releaseBrowserTopMost();
      this.page.setDefaultTimeout(30000);
      this.page.setDefaultNavigationTimeout(60000);

      await this._prepareParentScenarioForRecording(sourceScenario, {
        page: this.page,
        viewport: this.viewport,
        variableMap,
      });

      await this._installRecordingBridge(this.page);

      // Chromium restores cookies natively from userDataDir — just navigate to the target.
      await this.page.goto(resolvedTargetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await ensureRememberMeChecked(this.page);

      // Reset timing anchors to post-load so step time_offset is relative to page-ready,
      // not to browser launch. This prevents the first step from carrying a large load delay.
      this.startTime = Date.now();
      this.lastEventTime = this.startTime;

      // Start capturing frames only after the page has loaded — avoids blank/loading frames
      // polluting the manifest and keeps manifestDuration in sync with step time_offset values.
      this._screenshotTimer = setInterval(() => {
        this._lastScreenshotPromise = this._takeScreenshot();
      }, 250);

      await this._releaseBrowserTopMost();
      // Chromium may re-assert topmost after first paint; release again after render settles
      setTimeout(() => this._releaseBrowserTopMost().catch(() => {}), 1000);
      await this._injectRecordingScript(this.page);

      this.devicePixelRatio = await this.page.evaluate(() => window.devicePixelRatio || 1).catch(() => 1);
      this.scenario.device_pixel_ratio = this.devicePixelRatio;

      await this._takeScreenshot();

      return {
        scenarioId,
        targetUrl: safeScenario.target_url,
        viewport: this.viewport,
        cacheDir: this.cacheDir,
        importWarning: this.importWarning,
        startedAt: this.startTime,
      };
    } catch (error) {
      this.isRecording = false;
      await this._cleanupBrowser();
      throw error;
    }
  }

  async stopRecording() {
    if (this._stopping) {
      return this._stopPromise;
    }
    if (!this.isRecording && !this.scenario) {
      throw new Error('Khong co phien record nao dang chay.');
    }

    this._stopping = true;
    this._stopPromise = this._finalizeRecordingSession();
    try {
      return await this._stopPromise;
    } finally {
      this._stopping = false;
      this._stopPromise = null;
    }
  }

  async _finalizeRecordingSession() {
    const endTime = Date.now();
    const durationMs = Math.max(0, endTime - this.startTime);
    this.isRecording = false;

    if (this._recordingFrameHandler && this.page) {
      this.page.off('framenavigated', this._recordingFrameHandler);
      this._recordingFrameHandler = null;
    }

    // Dung screenshot timer
    if (this._screenshotTimer) {
      clearInterval(this._screenshotTimer);
      this._screenshotTimer = null;
    }
    await this._lastScreenshotPromise?.catch(() => {});
    this._screenshotInProgress = false;

    if (this.browserProfileService && this.browser?.isConnected?.()) {
      await this.browserProfileService.gracefulCloseBrowser(
        this.browser,
        this.usedUserDataDir,
        this.page,
      );
    } else {
      await this._cleanupBrowser();
    }

    await this._mirrorFramesToStorage();
    // Disk frames may outlive in-memory list when browser crashed mid-session.
    await this._hydrateFramesFromDiskIfNeeded();
    const recordedSteps = this._buildSteps();
    const effectiveDurationMs = Math.max(
      durationMs,
      this.frames.length ? Math.max(...this.frames.map((frame) => Number(frame.timestamp) || 0)) : 0,
    );
    const previewManifest = await this._writePreviewManifest(effectiveDurationMs);
    // Khong tu dong render video — chi xuat ban moi render
    const currentScenario = this.scenario?.id ? this.dbService.getScenarioById(this.scenario.id) : null;
    const existingSteps = this.mode === 'append' ? currentScenario?.steps || [] : [];
    const steps = [...existingSteps, ...recordedSteps];
    const scenarioToSave = {
      ...(currentScenario || {}),
      ...this.scenario,
      recorded_width: this.viewport.width,
      recorded_height: this.viewport.height,
      device_pixel_ratio: this.devicePixelRatio,
      // Giu nguyen preview_path cu neu co, tranh mat video da xuat ban
      preview_path: currentScenario?.preview_path || null,
      preview_manifest_path: previewManifest,
      preview_duration_ms: effectiveDurationMs,
      // Avoid empty UI persist wiping a real frame list later in the same save path.
      preview_manifest_frames: this.frames.map((frame) => ({
        time: frame.timestamp,
        name: frame.fileName,
        path: frame.filePath,
        url: frame.filePath ? toCacheUrl(frame.filePath) : null,
      })),
    };
    const saved = this.dbService.saveScenario(scenarioToSave, steps);

    const result = {
      scenario: saved,
      steps: saved.steps || [],
      metadata: {
        durationMs: effectiveDurationMs,
        totalEvents: this.recordedEvents.length,
        totalSteps: recordedSteps.length,
        totalFrames: this.frames.length,
        cacheDir: this.cacheDir,
        frames: this.frames,
        previewManifest,
        previewWarning: this.previewWarning,
        mode: this.mode,
        importWarning: this.importWarning,
      },
    };

    this._resetSession();
    return result;
  }

  _handleBrowserDisconnected() {
    if (this._stopping || !this.scenario) {
      this.isRecording = false;
      return;
    }
    console.warn('[Recorder] Browser disconnected — tu dong dung va luu phien record.');
    this.stopRecording().catch((error) => {
      console.warn(`[Recorder] Auto-stop sau disconnect that bai: ${error.message}`);
      this.isRecording = false;
    });
  }

  async openBrowser(scenarioId, targetUrl, viewport = DEFAULT_VIEWPORT) {
    // Mo Puppeteer browser doc lap, dung userDataDir giong nhu startRecording
    // De nguoi dung co the kiem tra thu cong trang thai browser.
    // Luon dung profiles/<scenarioId> de session duoc giu lai qua cac lan mo.
    const settings = this.dbService.getSettings();
    const effectiveViewport = this._getViewportFromSettings(settings, viewport);
    const browserDataRoot = settings?.['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
    const userDataDir = resolveGuestSessionDir(browserDataRoot, scenarioId || 'manual');

    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: effectiveViewport,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${effectiveViewport.width},${effectiveViewport.height}`,
      ],
    }).catch((err) => {
      console.error('[Recorder] openBrowser loi:', err.message);
      return null;
    });

    if (!browser) return { opened: false, error: 'Khong the mo browser' };

    // Mo tab va dieu huong den targetUrl
    try {
      const page = await browser.newPage();
      if (targetUrl) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
    } catch { /* silent */ }

    // Khong close browser — nguoi dung tu dong
    return {
      opened: true,
      userDataDir,
      viewport: effectiveViewport,
    };
  }

  async replayAndRecord(scenarioId, targetUrl, viewport = DEFAULT_VIEWPORT, importProfileId = null) {
    // Lay scenario tu DB de lay danh sach steps can replay
    const scenario = this.dbService.getScenarioById(scenarioId);
    if (!scenario) {
      return { success: false, error: 'Khong tim thay kich ban' };
    }
    const steps = scenario.steps || [];
    if (!steps.length) {
      return { success: false, error: 'Kich ban khong co buoc nao de phat lai' };
    }

    // Lay settings de xac dinh userDataDir
    const settings = this.dbService.getSettings();
    const effectiveViewport = this._getViewportFromSettings(settings, viewport);
    const effectiveImportProfileId = importProfileId || scenario.browser_profile_id || null;
    const userDataDir = await this._resolveRecordingUserDataDir(scenarioId, effectiveImportProfileId);
    const variableMap = this.dbService.buildVariableMap(scenarioId, null);

    // Mo browser va phat lai tung buoc
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: effectiveViewport,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${effectiveViewport.width},${effectiveViewport.height}`,
      ],
    }).catch(() => null);

    if (!browser) {
      return { success: false, error: 'Khong the mo browser de phat lai' };
    }

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);
      await this._releaseBrowserTopMost(browser);

      // Dieu huong den target_url cua scenario truoc khi phat lai step
      const initialUrl = resolveScenarioTargetUrl(
        targetUrl || scenario.target_url || 'about:blank',
        variableMap,
      );
      console.log(`[Recorder] Dieu huong den URL ban dau: ${initialUrl}`);
      await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
        console.warn(`[Recorder] Khong the mo URL ban dau: ${initialUrl}`);
      });
      await this._releaseBrowserTopMost(browser);
      // Doi trang load
      await new Promise((resolve) => setTimeout(resolve, randomRuntimeDelay(1000)));

      await this._replayStepsOnPage(page, steps, {
        scenario,
        viewport: effectiveViewport,
        variableMap,
      });

      // Sau khi phat lai xong, bat dau record append mode
      this._recordingWidgetConfig = this._resolveGlobalWidgetConfig(scenario.scenario_meta || {});
      await this._installRecordingBridge(page);

      this.scenario = {
        id: scenarioId,
        name: scenario.name,
        description: scenario.description,
        platform: scenario.platform,
        target_url: scenario.target_url,
        recorded_width: effectiveViewport.width,
        recorded_height: effectiveViewport.height,
        device_pixel_ratio: scenario.device_pixel_ratio || 1,
        scenario_type: scenario.scenario_type || 'action',
        parent_id: scenario.parent_id || null,
        browser_profile_id: scenario.browser_profile_id || effectiveImportProfileId || null,
        scenario_meta: scenario.scenario_meta || {},
      };
      this.mode = 'append';
      this.lastImportProfileId = effectiveImportProfileId;
      this.viewport = { width: effectiveViewport.width, height: effectiveViewport.height };
      this.recordedEvents = [];
      this.frames = [];
      this.frameCounter = 0;
      this.startTime = Date.now();
      this.lastEventTime = this.startTime;
      this.cacheDir = this._getScenarioStorageDir(scenarioId);
      this.framesDir = path.join(this.cacheDir, 'frames');
      await fs.mkdir(this.framesDir, { recursive: true });
      this.usedUserDataDir = userDataDir;

      this.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio || 1).catch(() => 1);
      this.isRecording = true;
      this._stopping = false;
      this.browser = browser;
      this.page = page;

      // Screenshot capture ~4 FPS (same as startRecording)
      this._screenshotTimer = setInterval(() => {
        this._lastScreenshotPromise = this._takeScreenshot();
      }, 250);
      await this._takeScreenshot();

      browser.on('disconnected', () => {
        this._handleBrowserDisconnected();
      });

      return {
        success: true,
        replayedSteps: steps.length,
        scenarioId,
        cacheDir: this.cacheDir,
        viewport: effectiveViewport,
        startedAt: this.startTime,
      };
    } catch (error) {
      await browser.close().catch(() => {});
      return { success: false, error: error.message };
    }
  }

  async _prepareParentScenarioForRecording(scenario, { page, viewport, variableMap } = {}) {
    if (!page || page.isClosed()) return;
    if (normalizeScenarioType(scenario?.scenario_type) === 'prepare') return;

    const parentId = String(scenario?.parent_id || '').trim();
    if (!parentId) return;
    if (!hasDomCheckAnchor(scenario?.dom_check_anchor)) return;

    const parent = this.dbService.getScenarioById(parentId);
    if (!parent) {
      throw new Error(`Khong tim thay kich ban parent/login: ${parentId}`);
    }
    if (!parent.steps?.length) {
      throw new Error('Kich ban parent/login chua co buoc nao.');
    }

    const parentVariableMap = this.dbService.buildVariableMap(parentId, null);
    const parentStartUrl = resolveScenarioTargetUrl(parent.target_url || 'about:blank', parentVariableMap);
    console.log(`[Recorder] Chay parent/login truoc khi record action: ${parent.name || parentId}`);
    await page.goto(parentStartUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
      console.warn(`[Recorder] Khong the mo URL parent/login: ${err.message}`);
    });
    await ensureRememberMeChecked(page);
    await this._releaseBrowserTopMost();
    await new Promise((resolve) => setTimeout(resolve, randomRuntimeDelay(1000)));

    await this._replayStepsOnPage(page, parent.steps, {
      scenario: parent,
      viewport,
      variableMap: parentVariableMap,
    });

    await ensureRememberMeChecked(page);
    await new Promise((resolve) => setTimeout(resolve, randomRuntimeDelay(500)));

    const targetUrl = resolveScenarioTargetUrl(scenario?.target_url || 'about:blank', variableMap);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
      console.warn(`[Recorder] Khong the quay lai URL action sau parent/login: ${err.message}`);
    });
    await ensureRememberMeChecked(page);
    await this._releaseBrowserTopMost();
  }

  async _replayStepsOnPage(page, steps = [], { scenario = {}, viewport = DEFAULT_VIEWPORT, variableMap = new Map() } = {}) {
    for (const step of steps) {
      const { action_type, target_anchor, delay_ms } = step;
      const anchor = target_anchor || {};
      const config = anchor.action_config || {};
      const selector = anchor.selector_value || config.selector || '';
      const stepUrl = config.url || anchor.url || '';

      console.log(`[Recorder] Phat lai buoc: ${action_type} | selector="${selector}"`);

      if (action_type === 'navigate') {
        const url = resolveScenarioTargetUrl(
          stepUrl || scenario.target_url || 'about:blank',
          variableMap,
        );
        console.log(`[Recorder] Navigate den: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
          console.warn(`[Recorder] Navigate that bai: ${err.message}`);
        });
      } else if (action_type === 'click') {
        await this._replayClick(page, anchor, selector, viewport, config);
      } else if (action_type === 'input' || action_type === 'type') {
        const text = resolveVariableTemplate(config.text || '', variableMap);
        await this._replayType(page, anchor, selector, text, viewport, config.delay || 50);
      } else if (action_type === 'file') {
        const filePath = resolveVariableTemplate(config.text || '', variableMap);
        await this._replayFile(page, anchor, selector, filePath, viewport);
      } else if (action_type === 'scroll') {
        const scrollX = anchor.scroll_x ?? config.scrollX ?? 0;
        const scrollY = anchor.scroll_y ?? config.scrollY ?? 0;
        await page.evaluate((x, y) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), scrollX, scrollY).catch(() => {});
      } else if (action_type === 'wait') {
        await new Promise((resolve) => setTimeout(resolve, config.duration || delay_ms || 2000));
      }

      await new Promise((resolve) => setTimeout(resolve, randomRuntimeDelay(delay_ms || DEFAULT_ACTION_DELAY_MS)));
    }
  }

  async _replayClick(page, anchor = {}, selector = '', viewport = DEFAULT_VIEWPORT, config = {}) {
    const selectors = [
      selector,
      anchor.selector_value,
      anchor.id ? `#${anchor.id}` : '',
      anchor.name ? `[name="${anchor.name}"]` : '',
      anchor.ariaLabel ? `[aria-label="${anchor.ariaLabel}"]` : '',
      anchor.placeholder ? `[placeholder="${anchor.placeholder}"]` : '',
    ].filter(Boolean);

    if (config.skip_if_checked) {
      const alreadyChecked = await isCheckboxAlreadyChecked(page, {
        selectors,
        coords: anchor.relative_coords,
        viewport,
      });
      if (alreadyChecked) return;
    }

    const coords = anchor.relative_coords;
    let coordinateAttempt = null;
    if (coords?.x !== undefined && coords?.y !== undefined) {
      if (config.skip_if_checked) {
        const alreadyChecked = await isCheckboxAlreadyChecked(page, {
          selectors: [],
          coords,
          viewport,
        });
        if (alreadyChecked) return;
      }

      const x = Math.round((coords.x / 100) * viewport.width);
      const y = Math.round((coords.y / 100) * viewport.height);
      coordinateAttempt = { x, y };
      try {
        await page.mouse.move(x, y, { steps: 5 });
        await page.mouse.click(x, y);
        console.log(`[Recorder] Replay click by coordinates x=${x}, y=${y} (${coords.x}%, ${coords.y}%)`);
        return;
      } catch (error) {
        console.warn(`[Recorder] Replay coordinate click failed x=${x}, y=${y}; falling back to selector. ${error.message}`);
      }
    }

    for (const item of selectors) {
      try {
        await page.waitForSelector(item, { timeout: 1500 });
        await page.click(item);
        if (coordinateAttempt) {
          console.log(`[Recorder] Replay click fallback selector="${item}" after coordinate x=${coordinateAttempt.x}, y=${coordinateAttempt.y}`);
        } else {
          console.log(`[Recorder] Replay click by selector="${item}" (no valid coordinates)`);
        }
        return;
      } catch {
        // Try next selector.
      }
    }

    const focused = await this._replayFocus(page, anchor, selector);
    if (focused) {
      await page.keyboard.press('Enter').catch(() => {});
    }
  }

  async _replayType(page, anchor = {}, selector = '', text = '', viewport = DEFAULT_VIEWPORT, delay = 50) {
    const focused = await this._replayFocus(page, anchor, selector);

    if (!focused) {
      const coords = anchor.relative_coords;
      if (coords?.x !== undefined && coords?.y !== undefined) {
        const x = Math.round((coords.x / 100) * viewport.width);
        const y = Math.round((coords.y / 100) * viewport.height);
        await page.mouse.click(x, y).catch(() => {});
      }
    }

    await page.keyboard.down('Control').catch(() => {});
    await page.keyboard.press('A').catch(() => {});
    await page.keyboard.up('Control').catch(() => {});
    await page.keyboard.type(String(text || ''), { delay: randomRuntimeDelay(delay, 25, 120) }).catch(() => {});
  }

  async _replayFile(page, anchor = {}, selector = '', filePath = '', viewport = DEFAULT_VIEWPORT) {
    if (!filePath || /^C:\\fakepath\\/i.test(filePath)) return;

    const focused = await this._replayFocus(page, anchor, selector);
    if (!focused) {
      const coords = anchor.relative_coords;
      if (coords?.x !== undefined && coords?.y !== undefined) {
        const x = Math.round((coords.x / 100) * viewport.width);
        const y = Math.round((coords.y / 100) * viewport.height);
        await page.mouse.click(x, y).catch(() => {});
      }
    }

    const handle = selector ? await page.$(selector).catch(() => null) : null;
    if (handle) {
      await handle.uploadFile(filePath).catch(() => {});
      return;
    }

    const selectors = [
      selector,
      anchor.selector_value,
      anchor.id ? `#${anchor.id}` : '',
      anchor.name ? `[name="${anchor.name}"]` : '',
    ].filter(Boolean);

    for (const item of selectors) {
      const candidate = await page.$(item).catch(() => null);
      if (!candidate) continue;
      await candidate.uploadFile(filePath).catch(() => {});
      return;
    }
  }

  _resolveGlobalWidgetConfig(scenarioMeta = {}) {
    const debounceKeydown = scenarioMeta?.global_widgets?.debounce_keydown || {};
    return {
      debounce_keydown: {
        debounce_ms: Math.max(50, Math.min(5000, Number(debounceKeydown.debounce_ms) || 300)),
      },
    };
  }

  async _replayFocus(page, anchor = {}, selector = '') {
    const selectors = [
      selector,
      anchor.selector_value,
      anchor.id ? `#${anchor.id}` : '',
      anchor.name ? `[name="${anchor.name}"]` : '',
      anchor.ariaLabel ? `[aria-label="${anchor.ariaLabel}"]` : '',
      anchor.placeholder ? `[placeholder="${anchor.placeholder}"]` : '',
    ].filter(Boolean);

    for (const item of selectors) {
      try {
        await page.waitForSelector(item, { timeout: 1500 });
        await page.focus(item);
        return true;
      } catch {
        // Try next selector.
      }
    }

    if (anchor.xpath) {
      try {
        return await page.evaluate((xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          if (!element) return false;
          element.focus();
          element.click();
          return true;
        }, anchor.xpath);
      } catch {
        return false;
      }
    }

    return false;
  }

  getStatus() {
    return {
      isRecording: this.isRecording,
      elapsedMs: this.isRecording ? Date.now() - this.startTime : 0,
      eventsCount: this.recordedEvents.length,
      frameCount: this.frames.length,
      targetUrl: this.scenario?.target_url || '',
      scenarioId: this.scenario?.id || null,
      cacheDir: this.cacheDir,
      importWarning: this.importWarning,
      viewport: {
        width: this.viewport.width,
        height: this.viewport.height,
        devicePixelRatio: this.devicePixelRatio,
      },
    };
  }

  _handleClientAction(payload) {
    if (!this.isRecording || !payload?.action_type) return;

    const now = Date.now();
    const timeOffset = now - this.startTime;
    const delayMs = Math.max(0, now - this.lastEventTime);
    this.lastEventTime = now;

    this.recordedEvents.push({
      id: crypto.randomUUID(),
      timestamp: now,
      time_offset: timeOffset,
      delay_ms: delayMs,
      ...payload,
    });
    this._lastScreenshotPromise = this._takeScreenshot();
  }

  async _takeScreenshot() {
    if (!this.isRecording || !this.page || this.page.isClosed()) return;
    if (this._screenshotInProgress) return;

    this._screenshotInProgress = true;
    const frameTimestamp = Date.now() - this.startTime;
    const counter = this.frameCounter + 1;
    const fileName = `frame_${String(counter).padStart(8, '0')}.png`;
    const filePath = path.join(this.framesDir, fileName);

    try {
      const screenshotBuffer = await this.page.screenshot({
        type: 'png',
        fullPage: false,
        captureBeyondViewport: false,
      });
      await fs.writeFile(filePath, screenshotBuffer);
      this.frameCounter = counter;
      this.frames.push({
        timestamp: frameTimestamp,
        fileName,
        filePath,
      });
    } catch (error) {
      console.warn(`[Recorder] Khong chup duoc screenshot: ${error.message}`);
    } finally {
      this._screenshotInProgress = false;
    }
  }

  async _mirrorFramesToStorage() {
    if (!this.scenario?.id || !this.frames.length) return;

    const storageDir = this._getScenarioStorageDir(this.scenario.id);
    const storageFramesDir = path.join(storageDir, 'frames');
    await fs.mkdir(storageFramesDir, { recursive: true });

    const resolvedCurrentDir = path.resolve(this.framesDir || '');
    const resolvedStorageDir = path.resolve(storageFramesDir);
    const sameDir = process.platform === 'win32'
      ? resolvedCurrentDir.toLowerCase() === resolvedStorageDir.toLowerCase()
      : resolvedCurrentDir === resolvedStorageDir;

    if (!sameDir) {
      for (const frame of this.frames) {
        const targetPath = path.join(storageFramesDir, frame.fileName);
        await fs.copyFile(frame.filePath, targetPath).catch(() => {});
        frame.filePath = targetPath;
      }
    }

    this.cacheDir = storageDir;
    this.framesDir = storageFramesDir;
  }

  async _resolveExportFrames(scenarioId) {
    const scenario = this.dbService.getScenarioById(scenarioId);
    if (!scenario) {
      return { scenario: null, frames: [], durationMs: 0, cacheDir: '' };
    }

    const manifestFrames = [];
    for (const frame of scenario.preview_frames || []) {
      if (!frame.path) continue;
      try {
        await fs.access(frame.path);
        manifestFrames.push({
          fileName: frame.name || path.basename(frame.path),
          filePath: frame.path,
          timestamp: Number(frame.time) || 0,
        });
      } catch {
        console.warn(`[Recorder] Frame khong ton tai khi xuat ban: ${frame.path}`);
      }
    }
    manifestFrames.sort((a, b) => a.timestamp - b.timestamp);

    if (manifestFrames.length) {
      const durationMs = scenario.preview_duration_ms != null
        ? Number(scenario.preview_duration_ms)
        : Math.max(...manifestFrames.map((frame) => frame.timestamp));
      const cacheDir = scenario.preview_manifest_path
        ? path.dirname(scenario.preview_manifest_path)
        : this._getScenarioStorageDir(scenarioId);
      return { scenario, frames: manifestFrames, durationMs, cacheDir };
    }

    if (this.frames.length) {
      const sortedFrames = [...this.frames].sort((a, b) => a.timestamp - b.timestamp);
      const durationMs = sortedFrames.length
        ? Math.max(
          sortedFrames[sortedFrames.length - 1].timestamp,
          sortedFrames.length * 33,
        )
        : 0;
      return {
        scenario,
        frames: sortedFrames,
        durationMs,
        cacheDir: this.cacheDir || this._getScenarioStorageDir(scenarioId),
      };
    }

    const diskFramesDir = path.join(this._getScenarioStorageDir(scenarioId), 'frames');
    try {
      const files = await fs.readdir(diskFramesDir);
      const pngFiles = files
        .filter((file) => file.endsWith('.png'))
        .sort()
        .map((file, index) => ({
          fileName: file,
          filePath: path.join(diskFramesDir, file),
          timestamp: index * 33,
        }));
      if (pngFiles.length) {
        return {
          scenario,
          frames: pngFiles,
          durationMs: pngFiles.length * 33,
          cacheDir: path.dirname(diskFramesDir),
        };
      }
    } catch {
      // fall through
    }

    return { scenario, frames: [], durationMs: 0, cacheDir: '' };
  }

  // Public method: render video tu manifest da chinh sua (hoac frames fallback), tra ve path + url
  async renderVideo(scenarioId) {
    if (this.isRecording) {
      return { success: false, error: 'Dang trong qua trinh record. Hay stop truoc khi xuat ban.' };
    }

    const { scenario, frames, durationMs, cacheDir } = await this._resolveExportFrames(scenarioId);
    if (!scenario) {
      return { success: false, error: 'Khong tim thay kich ban.' };
    }
    if (!frames.length) {
      return { success: false, error: 'Khong co frame nao de xuat ban video.' };
    }

    const savedFrames = this.frames;
    const savedCacheDir = this.cacheDir;
    const savedFramesDir = this.framesDir;

    try {
      this.frames = frames;
      this.cacheDir = cacheDir;
      this.framesDir = path.join(cacheDir, 'frames');

      const result = await this._renderPreviewVideo(durationMs);
      if (!result) {
        return { success: false, error: this.previewWarning || 'Khong the tao video.' };
      }

      this.dbService.saveScenario(
        { ...scenario, preview_path: result.filePath },
        scenario.steps || [],
      );

      return {
        success: true,
        filePath: result.filePath,
        fileUrl: result.fileUrl,
      };
    } finally {
      this.frames = savedFrames;
      this.cacheDir = savedCacheDir;
      this.framesDir = savedFramesDir;
    }
  }

  async _writePreviewManifest(durationMs) {
    const manifestPath = path.join(this.cacheDir, 'preview.json');
    const manifest = {
      durationMs,
      frameCount: this.frames.length,
      frames: this.frames.map((frame) => ({
        timestamp: frame.timestamp,
        fileName: frame.fileName,
        filePath: frame.filePath,
        fileUrl: toCacheUrl(frame.filePath),
      })),
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8').catch(() => {});
    return manifestPath;
  }

  async _renderPreviewVideo(durationMs) {
    const outputPath = path.join(this.cacheDir, 'preview.mp4');

    if (!this.frames.length) {
      console.log('[Recorder] Khong co frame de tao preview video.');
      this.previewWarning = 'Khong co frame de tao preview video.';
      return null;
    }

    if (!ffmpegStatic) {
      console.log('[Recorder] ffmpegStatic null/undefined, ffmpeg path:', ffmpegStatic);
      this.previewWarning = 'Chua co ffmpeg di kem app, da fallback sang frame preview.';
      return null;
    }

    console.log(`[Recorder] ffmpegStatic path: ${ffmpegStatic}`);
    console.log(`[Recorder] Bat dau tao preview video: ${this.frames.length} frames, cacheDir=${this.cacheDir}`);

    // === Phuong an 1: dung fluent-ffmpeg voiconcat demuxer ===
    const tryFluentFfmpeg = async () => {
      const concatPath = path.join(this.cacheDir, 'frames.txt');
      const sortedFrames = [...this.frames].sort((a, b) => a.timestamp - b.timestamp);
      const lines = [];

      for (let index = 0; index < sortedFrames.length; index += 1) {
        const frame = sortedFrames[index];
        const nextFrame = sortedFrames[index + 1];
        const duration = nextFrame
          ? Math.max(0.04, (nextFrame.timestamp - frame.timestamp) / 1000)
          : Math.max(0.2, (durationMs - frame.timestamp) / 1000);

        const escaped = escapeConcatPath(frame.filePath);
        lines.push(`file '${escaped}'`);
        lines.push(`duration ${duration.toFixed(3)}`);
      }
      const lastEscaped = escapeConcatPath(sortedFrames[sortedFrames.length - 1].filePath);
      lines.push(`file '${lastEscaped}'`);

      await fs.writeFile(concatPath, lines.join('\n'), 'utf8');
      console.log('[Recorder] Da ghi frames.txt, bat dau ffmpeg (fluent-ffmpeg)...');
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatPath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            '-c:v libx264',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
            '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
          ])
          .on('start', (cmdLine) => {
            console.log(`[Recorder] ffmpeg command: ${cmdLine}`);
          })
          .on('end', () => {
            console.log('[Recorder] ffmpeg hoan thanh tao preview.mp4');
            resolve();
          })
          .on('error', (err) => {
            console.error(`[Recorder] ffmpeg loi (fluent-ffmpeg): ${err.message}`);
            reject(err);
          })
          .save(outputPath);
      });

      await fs.access(outputPath);
    };

    // === Phuong an 2: concat demuxer bang execFile neu fluent-ffmpeg fail ===
    const tryExecFileFfmpeg = async () => {
      console.log('[Recorder] Thu phuong an 2: execFile raw ffmpeg (concat demuxer)');
      const concatPath = path.join(this.cacheDir, 'frames-exec.txt');
      const sortedFrames = [...this.frames].sort((a, b) => a.timestamp - b.timestamp);
      const lines = [];

      for (let index = 0; index < sortedFrames.length; index += 1) {
        const frame = sortedFrames[index];
        const nextFrame = sortedFrames[index + 1];
        const duration = nextFrame
          ? Math.max(0.04, (nextFrame.timestamp - frame.timestamp) / 1000)
          : Math.max(0.2, (durationMs - frame.timestamp) / 1000);

        const escaped = escapeConcatPath(frame.filePath);
        lines.push(`file '${escaped}'`);
        lines.push(`duration ${duration.toFixed(3)}`);
      }
      const lastEscaped = escapeConcatPath(sortedFrames[sortedFrames.length - 1].filePath);
      lines.push(`file '${lastEscaped}'`);

      await fs.writeFile(concatPath, lines.join('\n'), 'utf8');
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-y',
        outputPath,
      ];
      console.log(`[Recorder] execFile ffmpeg args: ${args.join(' ')}`);
      await execFileAsync(ffmpegStatic, args, { timeout: 60000 });
      await fs.access(outputPath);
    };

    try {
      // Thu phuong an 1 truoc
      await tryFluentFfmpeg();
    } catch (fluentError) {
      console.warn(`[Recorder] Phuong an 1 (fluent-ffmpeg) that bai: ${fluentError.message}`);
      try {
        // Thu phuong an 2
        await tryExecFileFfmpeg();
      } catch (execError) {
        console.error(`[Recorder] Phuong an 2 (execFile) cung that bai: ${execError.message}`);
        this.previewWarning = `Tao preview video loi: ${execError.message}`;
        return null;
      }
    }

    // Kiem tra file output co ton tai
    try {
      const stat = await fs.stat(outputPath);
      console.log(`[Recorder] preview.mp4 da tao: ${outputPath} (${stat.size} bytes)`);
    } catch {
      console.warn('[Recorder] preview.mp4 khong ton tai sau khi ffmpeg hoan thanh');
      this.previewWarning = 'preview.mp4 khong ton tai sau khi tao';
      return null;
    }

    return {
      filePath: outputPath,
      fileUrl: toCacheUrl(outputPath),
    };
  }

  _buildSteps() {
    const events = this._mergeTypeEvents(this.recordedEvents);
    return events.map((event) => {
      const frame = this._findClosestFrame(event.time_offset);
      const anchor = event.target_anchor || {};
      const selectorValue = event.selector_value || this._pickSelector(anchor);
      const relativeCoords = event.relative_coords || anchor.relative_coords || null;
      const actionConfig = this._actionConfigForEvent(event, selectorValue);

      return {
        action_type: event.action_type,
        delay_ms: DEFAULT_ACTION_DELAY_MS,
        target_anchor: {
          ...anchor,
          relative_coords: relativeCoords,
          action_config: actionConfig,
          selector_type: selectorValue ? 'css' : 'anchor',
          selector_value: selectorValue,
          description: this._describeEvent(event, selectorValue),
          associated_frame: frame?.filePath || null,
          associated_frame_url: frame?.filePath ? toCacheUrl(frame.filePath) : null,
          associated_frame_name: frame?.fileName || null,
          time_offset: event.time_offset,
          scroll_x: event.scroll_x,
          scroll_y: event.scroll_y,
        },
      };
    });
  }

  _mergeTypeEvents(events) {
    const merged = [];
    const inputLike = new Set(['input', 'type', 'file']);

    for (const event of events) {
      if (!inputLike.has(event.action_type)) {
        merged.push(event);
        continue;
      }

      const previous = merged[merged.length - 1];
      const sameTarget = previous
        && inputLike.has(previous.action_type)
        && previous.selector_value === event.selector_value
        && JSON.stringify(previous.target_anchor || {}) === JSON.stringify(event.target_anchor || {})
        && event.time_offset - previous.time_offset < 2500;

      if (sameTarget && event.text !== undefined) {
        previous.text = event.text;
        previous.action_type = event.action_type;
        previous.delay_ms += event.delay_ms;
        previous.time_offset = event.time_offset;
      } else {
        merged.push({ ...event });
      }
    }

    return merged;
  }

  _findClosestFrame(timeOffset) {
    if (!this.frames.length) return null;

    let bestFrame = this.frames[0];
    let bestDistance = Math.abs(bestFrame.timestamp - timeOffset);

    for (const frame of this.frames) {
      const distance = Math.abs(frame.timestamp - timeOffset);
      if (distance < bestDistance) {
        bestFrame = frame;
        bestDistance = distance;
      }
    }

    return bestFrame;
  }

  _actionConfigForEvent(event, selectorValue) {
    if (event.action_type === 'navigate') {
      return { url: event.url || this.scenario?.target_url || '' };
    }
    if (event.action_type === 'input' || event.action_type === 'type') {
      return { selector: selectorValue || '', text: event.text || '', delay: randomRuntimeDelay(50, 25, 120) };
    }
    if (event.action_type === 'file') {
      return { selector: selectorValue || '', text: event.text || '' };
    }
    if (event.action_type === 'scroll') {
      return { scrollX: event.scroll_x || 0, scrollY: event.scroll_y || 0 };
    }
    return { selector: selectorValue || '' };
  }

  _describeEvent(event, selectorValue) {
    if (event.action_type === 'input' || event.action_type === 'type') return `Nhap: "${event.text || ''}"`;
    if (event.action_type === 'file') return `File: "${event.text || ''}"`;
    if (event.action_type === 'scroll') return `Scroll den ${event.scroll_y || 0}px`;
    if (event.action_type === 'navigate') return event.url || 'Mo URL';
    return `Bam: ${selectorValue || event.target_anchor?.innerText || 'target'}`;
  }

  _pickSelector(anchor = {}) {
    if (anchor.id) return `#${anchor.id}`;
    if (anchor.testId) return `[data-testid="${anchor.testId}"]`;
    if (anchor.name) return `[name="${anchor.name}"]`;
    if (anchor.ariaLabel) return `[aria-label="${anchor.ariaLabel}"]`;
    if (anchor.placeholder) return `[placeholder="${anchor.placeholder}"]`;
    return anchor.xpath || '';
  }

  async _resolveRecordingUserDataDir(scenarioId, importProfileId) {
    const browserDataRoot = this._getBrowserUserDataRoot();
    const importsDir = path.join(browserDataRoot, 'imports');
    const guestDir = path.join(browserDataRoot, 'guest');

    await fs.mkdir(importsDir, { recursive: true });
    await fs.mkdir(guestDir, { recursive: true });

    if (importProfileId) {
      if (this.browserProfileService) {
        return this.browserProfileService.resolveSessionUserDataDir(null, importProfileId);
      }

      const profile = this.dbService.getBrowserProfileById(importProfileId);
      if (profile?.import_path) {
        await fs.mkdir(profile.import_path, { recursive: true });
        await fs.mkdir(path.join(profile.import_path, 'Default'), { recursive: true });
        return profile.import_path;
      }

      const legacyDir = path.join(importsDir, scenarioId);
      await fs.mkdir(legacyDir, { recursive: true });
      await this._prepareImportedProfile(importProfileId, legacyDir);
      return legacyDir;
    }

    const guestSessionDir = resolveGuestSessionDir(browserDataRoot, scenarioId);
    return guestSessionDir;
  }

  async _prepareImportedProfile(importProfileId, userDataDir) {
    if (!importProfileId) return;

    try {
      const settings = this.dbService.getSettings();
      const importedRoot = settings['browser.importProfileId'] === importProfileId
        ? settings['browser.importUserDataDir']
        : null;
      const importedDefault = importedRoot ? path.join(importedRoot, 'Default') : null;
      if (importedDefault) {
        await this._copyImportItems(importedDefault, path.join(userDataDir, 'Default'));
        return;
      }

      const profile = this.dbService.getBrowserProfileById(importProfileId);
      if (!profile) {
        this.importWarning = 'Khong tim thay browser profile de import.';
        return;
      }

      const sourceDir = path.join(profile.user_data_dir, profile.profile_dir_name);
      const targetDir = path.join(userDataDir, 'Default');
      await this._copyImportItems(sourceDir, targetDir);
    } catch (error) {
      this.importWarning = `Import profile bi bo qua: ${error.message}`;
    }
  }

  _getBrowserUserDataRoot() {
    const settings = this.dbService.getSettings();
    return settings?.['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
  }

  _getScenarioStorageDir(scenarioId) {
    return path.join(this._getBrowserUserDataRoot(), 'storage', 'scenarios', scenarioId);
  }

  async _copyImportItems(sourceDir, targetDir) {
    await fs.mkdir(targetDir, { recursive: true });

    const copyItems = [
      'Preferences',
      'Cookies',
      'Login Data',
      'Web Data',
      'History',
      'Bookmarks',
      'Local Storage',
      'IndexedDB',
      'Session Storage',
      'Network',
    ];

    for (const item of copyItems) {
      await fs.cp(path.join(sourceDir, item), path.join(targetDir, item), {
        recursive: true,
        force: true,
      }).catch(() => {});
    }
  }

  async _installRecordingBridge(page) {
    if (!page || page.isClosed()) return;

    try {
      await page.exposeFunction('onRpaRecordedAction', (payload) => {
        this._handleClientAction(payload);
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!/already|been exposed/i.test(message)) {
        throw error;
      }
    }

    await page.evaluateOnNewDocument(this._getInjectionScriptSource());
    await this._injectRecordingScript(page);

    if (this._recordingFrameHandler) {
      page.off('framenavigated', this._recordingFrameHandler);
    }
    this._recordingFrameHandler = async (frame) => {
      if (!this.isRecording || frame !== page.mainFrame()) return;
      await this._injectRecordingScript(page);
    };
    page.on('framenavigated', this._recordingFrameHandler);
  }

  async _injectRecordingScript(page) {
    if (!page || page.isClosed()) return;
    try {
      const ok = await page.evaluate(this._getInjectionScriptSource());
      if (!ok) {
        console.warn('[Recorder] Recording inject script khong chay duoc tren trang hien tai.');
      }
    } catch (error) {
      console.warn(`[Recorder] Inject recording script that bai: ${error.message}`);
    }
  }

  async _hydrateFramesFromDiskIfNeeded() {
    if (this.frames.length || !this.framesDir) return;

    let entries = [];
    try {
      entries = await fs.readdir(this.framesDir);
    } catch {
      return;
    }

    const frameFiles = entries
      .filter((name) => /^frame_\d+\.(png|jpe?g)$/i.test(name))
      .sort();
    if (!frameFiles.length) return;

    console.warn(`[Recorder] Khoi phuc ${frameFiles.length} frame tu disk (bo nho mat sau disconnect).`);
    this.frames = frameFiles.map((fileName, index) => ({
      timestamp: index * 250,
      fileName,
      filePath: path.join(this.framesDir, fileName),
    }));
    this.frameCounter = frameFiles.length;
  }

  _getInjectionScriptSource() {
    const anchorHelpers = getElementAnchorHelpersScript();
    const widgetConfig = this._recordingWidgetConfig || this._resolveGlobalWidgetConfig();
    const configJson = JSON.stringify(widgetConfig);
    // Concatenate helpers + recorder listeners as one function body.
    // Do not call eval() inside the page — Facebook Trusted Types blocks it.
    // eslint-disable-next-line no-new-func
    return new Function(`
      ${anchorHelpers}

      const __rpaWidgetConfig = ${configJson};

      if (window.__rpaRecorderInjected) return true;
      window.__rpaRecorderInjected = true;

      const send = (payload) => {
        if (typeof window.onRpaRecordedAction === 'function') {
          window.onRpaRecordedAction(payload);
        }
      };

      document.addEventListener('click', (event) => {
        const anchor = getAnchor(event.target);
        send({
          action_type: 'click',
          selector_value: pickSelector(anchor),
          target_anchor: anchor,
          relative_coords: {
            x: Number(((event.clientX / window.innerWidth) * 100).toFixed(4)),
            y: Number(((event.clientY / window.innerHeight) * 100).toFixed(4)),
          },
          pixel_x: event.clientX,
          pixel_y: event.clientY,
          button: event.button,
        });
      }, true);

      document.addEventListener('input', (event) => {
        const target = event.target;
        if (!target || !('value' in target)) return;

        const anchor = getAnchor(target);
        const tagType = (target.getAttribute && target.getAttribute('type')) || target.type || '';
        const isFileInput = String(target.tagName || '').toLowerCase() === 'input' && tagType === 'file';
        send({
          action_type: isFileInput ? 'file' : 'input',
          selector_value: pickSelector(anchor),
          target_anchor: anchor,
          text: target.value || '',
        });
      }, true);

      function findEditableRoot(element) {
        let node = element;
        while (node) {
          if (node.isContentEditable) return node;
          const tag = String(node.tagName || '').toLowerCase();
          if (tag === 'textarea') return node;
          if (tag === 'input') {
            const inputType = String((node.getAttribute && node.getAttribute('type')) || node.type || 'text').toLowerCase();
            if (!['button', 'submit', 'checkbox', 'radio', 'file', 'hidden', 'reset'].includes(inputType)) {
              return node;
            }
          }
          if (node.getAttribute && node.getAttribute('role') === 'textbox') return node;
          node = node.parentElement;
        }
        return null;
      }

      function readEditableText(target) {
        if (!target) return '';
        if ('value' in target && typeof target.value === 'string') return target.value;
        if (target.isContentEditable) return target.innerText || target.textContent || '';
        return '';
      }

      const debounceKeydown = __rpaWidgetConfig.debounce_keydown || {};
      const debounceMs = Math.max(50, Math.min(5000, Number(debounceKeydown.debounce_ms) || 300));
      let keydownTimer = null;
      let keydownTarget = null;

      document.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Tab' || event.key === 'Escape') return;

        const editable = findEditableRoot(event.target);
        if (!editable) return;

        keydownTarget = editable;
        if (keydownTimer) window.clearTimeout(keydownTimer);
        keydownTimer = window.setTimeout(() => {
          const target = keydownTarget || document.activeElement;
          keydownTarget = null;
          const activeEditable = findEditableRoot(target);
          if (!activeEditable) return;

          const text = readEditableText(activeEditable);
          if (!text) return;

          const anchor = getAnchor(activeEditable);
          send({
            action_type: 'input',
            selector_value: pickSelector(anchor),
            target_anchor: anchor,
            text,
            source: 'debounce_keydown',
          });
        }, debounceMs);
      }, true);

      let scrollTimer = null;
      window.addEventListener('scroll', () => {
        if (scrollTimer) window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(() => {
          send({
            action_type: 'scroll',
            scroll_x: window.scrollX,
            scroll_y: window.scrollY,
            target_anchor: {},
          });
        }, 180);
      }, true);

      return true;
    `);
  }

  // Keep old name used by any historical call sites.
  _getInjectionScript() {
    return this._getInjectionScriptSource();
  }

  async _cleanupBrowser() {
    this.cdpSession = null;

    if (this._recordingFrameHandler && this.page) {
      this.page.off('framenavigated', this._recordingFrameHandler);
      this._recordingFrameHandler = null;
    }

    if (this._screenshotTimer) {
      clearInterval(this._screenshotTimer);
      this._screenshotTimer = null;
    }

    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch {
      // Browser may already be closed by user.
    }

    try {
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
      }
    } catch {
      // Browser may already be closed by user.
    }

    this.page = null;
    this.browser = null;
  }

  _getViewportFromSettings(settings = {}, fallbackViewport = DEFAULT_VIEWPORT) {
    const width = Number(settings?.['browser.viewportWidth']);
    const height = Number(settings?.['browser.viewportHeight']);
    return {
      width: width > 0 ? width : fallbackViewport.width || DEFAULT_VIEWPORT.width,
      height: height > 0 ? height : fallbackViewport.height || DEFAULT_VIEWPORT.height,
    };
  }

  async _releaseBrowserTopMost(browser = this.browser) {
    if (process.platform !== 'win32') return;

    const pid = browser?.process()?.pid;
    if (!pid) return;

    const script = `
$signature = @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
Add-Type $signature -ErrorAction SilentlyContinue
$targetPid = ${pid}
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
$notTopMost = New-Object IntPtr(-2)
$flags = 0x0001 -bor 0x0002 -bor 0x0010
[Win32]::EnumWindows({
  param($hWnd, $lParam)
  [uint32]$windowPid = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ($targetPids.Contains($windowPid) -and [Win32]::IsWindowVisible($hWnd)) {
    [void][Win32]::SetWindowPos($hWnd, $notTopMost, 0, 0, 0, 0, $flags)
  }
  return $true
}, [IntPtr]::Zero)
`;

    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    }).catch(() => {});
  }

  _resetSession() {
    if (this._screenshotTimer) {
      clearInterval(this._screenshotTimer);
      this._screenshotTimer = null;
    }
    this._screenshotInProgress = false;
    this._lastScreenshotPromise = null;
    this.recordedEvents = [];
    this.frames = [];
    this.startTime = 0;
    this.lastEventTime = 0;
    this.frameCounter = 0;
    this.scenario = null;
    this.mode = 'replace';
    this.previewWarning = null;
    this.usedUserDataDir = null;
    this.lastImportProfileId = null;
    this._stopping = false;
    this._recordingFrameHandler = null;
  }
}

function toCacheUrl(filePath) {
  return `rpa-cache://file/${Buffer.from(filePath).toString('base64url')}`;
}

function randomRuntimeDelay(baseMs = DEFAULT_ACTION_DELAY_MS, minMs = 120, maxMs = 1500) {
  const base = Math.max(1, Number(baseMs) || DEFAULT_ACTION_DELAY_MS);
  const factor = 0.7 + Math.random() * 1.1;
  return Math.round(Math.max(minMs, Math.min(maxMs, base * factor)));
}

function normalizeScenarioType(value) {
  const normalized = String(value || 'action').trim().toLowerCase();
  if (normalized === 'prepare' || normalized === 'crawl' || normalized === 'action' || normalized === 'request_catching') {
    return normalized;
  }
  return 'action';
}

function hasDomCheckAnchor(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(
    String(value.selector_value || '').trim()
    || String(value.action_config?.selector || '').trim(),
  );
}

function escapeConcatPath(filePath) {
  // Windows ffmpeg concat demuxer can xu ly forward-slash path tot hon.
  // Chuyen backslashes -> forward slashes, escape dau nhay don.
  const normalized = filePath.replace(/\\/g, '/');
  // Neu path co dau cach hoac ky tu dac biet, bao bang nhay don
  if (/[\s']/.test(normalized)) {
    return `'${normalized.replace(/'/g, "'\\''")}'`;
  }
  return normalized;
}

let recorderInstance = null;

function initRecorderService(options) {
  recorderInstance = new RecorderService(options);
  return recorderInstance;
}

function getRecorderService() {
  if (!recorderInstance) {
    throw new Error('[Recorder] RecorderService chua duoc khoi tao.');
  }
  return recorderInstance;
}

export { RecorderService, initRecorderService, getRecorderService };
