import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { resolveVariableTemplate } from './VariableResolver.js';
import { ensureRememberMeChecked, isCheckboxAlreadyChecked, resolveGuestSessionDir, resolveSessionStartUrl } from '../browser/BrowserSessionPaths.js';

const DEFAULT_ACTION_DELAY_MS = 300;
const DEFAULT_BROWSER_CLOSE_DELAY_MS = 5000;
const MIN_BROWSER_CLOSE_DELAY_MS = 1000;
const MAX_BROWSER_CLOSE_DELAY_MS = 120000;

// Module-level lock: prevents two executors from launching Chrome against the
// same userDataDir simultaneously. Maps dir → resolve-fn of the pending lock.
const userDataDirLocks = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ExecutorService {
  constructor({ dbService, browserProfileService, sendTelemetry, cacheRoot, appDataPath } = {}) {
    if (!dbService) {
      throw new Error('[Executor] dbService is required.');
    }

    this.dbService = dbService;
    this.browserProfileService = browserProfileService || null;
    this.sendTelemetry = sendTelemetry || (() => {});
    this.cacheRoot = cacheRoot || path.join(__dirname, '..', '..', '..', 'cache');
    this.appDataPath = appDataPath || null;
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.currentScenario = null;
    this._activeUserDataDir = null;
    this._currentSampleId = null;
    this._variableMap = null;
    this._executionViewport = null;
    this._releaseDirLock = null;
  }

  async startScenario(scenarioId, options = {}) {
    if (this.isRunning) {
      throw new Error('[Executor] Instance nay dang chay. Dung instance khac de chay song song.');
    }

    this.isRunning = true;
    const executionId = options.executionId || crypto.randomUUID();
    const startTime = Date.now();
    this._currentBrowserProfileId = options.browserProfileId ?? null;
    this._currentSampleId = options.sampleId
      ? String(options.sampleId).trim() || null
      : null;
    this._variableMap = null;

    try {
      const scenario = this.dbService.getScenarioById(scenarioId);
      if (!scenario) {
        throw new Error(`[Executor] Khong tim thay scenario: ${scenarioId}`);
      }
      if (!scenario.steps || scenario.steps.length === 0) {
        throw new Error('[Executor] Kich ban chua co buoc nao. Hay Record truoc khi Play.');
      }

      let variableSampleName = null;
      let variableProfileId = null;
      let variableProfileName = null;

      if (this._currentSampleId) {
        const sample = this.dbService.getVariableProfileSampleById(this._currentSampleId);
        variableSampleName = sample?.name || null;
        variableProfileId = sample?.profile_id || null;
        variableProfileName = sample?.profile_name || null;
      }

      this.currentScenario = scenario;
      this._executionStartedAt = new Date().toISOString();
      this._failedStepIndex = null;

      this._variableMap = this.dbService.buildVariableMap(scenarioId, this._currentSampleId);
      if (this._currentSampleId) {
        console.log(
          `[Executor] Sample "${variableSampleName || this._currentSampleId}" `
          + `(${this._variableMap.size} bien)`,
        );
      }
      this._sendTelemetry({
        type: 'execution:started',
        executionId,
        scenarioId,
        scenarioName: scenario.name,
        totalSteps: scenario.steps.length,
        timestamp: new Date().toISOString(),
      });

      this.dbService.createExecutionLog({
        id: executionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        browser_profile_id: this._currentBrowserProfileId,
        variable_profile_id: variableProfileId,
        variable_profile_name: variableProfileName,
        variable_sample_id: this._currentSampleId,
        variable_sample_name: variableSampleName,
        status: 'running',
        total_steps: scenario.steps.length,
        started_at: this._executionStartedAt,
      });

      await this._launchBrowser(scenario, options);

      if (normalizeScenarioType(scenario.scenario_type) !== 'prepare') {
        await this._ensureSessionReady(scenario, executionId);
      }

      for (let index = 0; index < scenario.steps.length; index += 1) {
        if (!this.isRunning) break;

        const step = scenario.steps[index];
        const stepIndex = index + 1;

        this._sendTelemetry({
          type: 'step:started',
          executionId,
          stepIndex,
          totalSteps: scenario.steps.length,
          stepId: step.id,
          actionType: step.action_type,
          timestamp: new Date().toISOString(),
        });

        try {
          await this._executeStep(step, stepIndex);
        } catch (stepError) {
          this._failedStepIndex = stepIndex;
          this._sendTelemetry({
            type: 'step:failed',
            executionId,
            stepIndex,
            totalSteps: scenario.steps.length,
            stepId: step.id,
            actionType: step.action_type,
            error: stepError.message,
            timestamp: new Date().toISOString(),
          });
          throw stepError;
        }

        this._sendTelemetry({
          type: 'step:completed',
          executionId,
          stepIndex,
          totalSteps: scenario.steps.length,
          stepId: step.id,
          actionType: step.action_type,
          completedSteps: stepIndex,
          timestamp: new Date().toISOString(),
        });
      }

      await this._settleSessionAfterRun(executionId);

      const durationMs = Date.now() - startTime;
      const finishedAt = new Date().toISOString();

      this.dbService.finishExecutionLog(executionId, {
        status: 'completed',
        completed_steps: scenario.steps.length,
        failed_steps: 0,
        duration_ms: durationMs,
        finished_at: finishedAt,
      });

      this._sendTelemetry({
        type: 'execution:completed',
        executionId,
        scenarioId,
        scenarioName: scenario.name,
        totalSteps: scenario.steps.length,
        completedSteps: scenario.steps.length,
        failedSteps: 0,
        durationMs,
        errors: [],
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        executionId,
        completedSteps: scenario.steps.length,
        totalSteps: scenario.steps.length,
        failedSteps: 0,
        durationMs,
        errors: [],
      };
    } catch (error) {
      const totalSteps = this.currentScenario?.steps?.length || 0;
      const completedSteps = Math.max(0, (this._failedStepIndex || 1) - 1);
      const finishedAt = new Date().toISOString();

      this.dbService.finishExecutionLog(executionId, {
        status: 'failed',
        total_steps: totalSteps,
        completed_steps: completedSteps,
        failed_steps: 1,
        failed_step_index: this._failedStepIndex,
        error_message: error.message,
        finished_at: finishedAt,
      });

      this._sendTelemetry({
        type: 'execution:failed',
        executionId,
        scenarioId: this.currentScenario?.id || scenarioId,
        scenarioName: this.currentScenario?.name || '',
        totalSteps,
        completedSteps,
        stepIndex: this._failedStepIndex,
        error: error.message,
        startedAt: this._executionStartedAt || new Date(startTime).toISOString(),
        timestamp: finishedAt,
      });
      throw error;
    } finally {
      await this._cleanupBrowser();
      this.isRunning = false;
      this.currentScenario = null;
      this._executionViewport = null;
    }
  }

  async _launchBrowser(scenario, options) {
    const recordedViewport = {
      width: scenario.recorded_width || 1280,
      height: scenario.recorded_height || 720,
    };
    const viewport = normalizeExecutionViewport(options.viewport) || recordedViewport;
    this._executionViewport = viewport;

    if (
      viewport.width !== recordedViewport.width
      || viewport.height !== recordedViewport.height
    ) {
      console.log(
        `[Executor] Viewport ${viewport.width}x${viewport.height} `
        + `(recorded ${recordedViewport.width}x${recordedViewport.height}) — `
        + 'relative_coords scaled to execution viewport',
      );
    }

    const errorsDir = path.join(this.cacheRoot, 'errors');
    if (!fs.existsSync(errorsDir)) {
      fs.mkdirSync(errorsDir, { recursive: true });
    }

    const browserProfileId = options.browserProfileId ?? null;
    const userDataDir = await this._resolveExecutionUserDataDir(
      scenario.id,
      browserProfileId,
      this._currentSampleId,
    );
    this._activeUserDataDir = userDataDir;

    // Serialize browser launches against the same userDataDir. Without this,
    // two executors starting nearly simultaneously can both pass the
    // SingletonLock check before Chrome creates the file, then both call
    // puppeteer.launch() — the second one fails with "Failed to launch the
    // browser process!".
    while (userDataDirLocks.has(userDataDir)) {
      await userDataDirLocks.get(userDataDir);
    }
    let releaseDirLock;
    userDataDirLocks.set(
      userDataDir,
      new Promise((resolve) => { releaseDirLock = resolve; }),
    );
    this._releaseDirLock = () => {
      userDataDirLocks.delete(userDataDir);
      releaseDirLock?.();
      this._releaseDirLock = null;
    };

    if (this.browserProfileService) {
      await this.browserProfileService.waitForProfileUnlock(userDataDir);
    }

    const headless = options.headless === true;
    this.browser = await puppeteer.launch({
      headless,
      userDataDir,
      defaultViewport: viewport,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${viewport.width},${viewport.height}`,
      ],
    });

    const existingPages = await this.browser.pages();
    this.page = existingPages[0] || await this.browser.newPage();
    for (const extraPage of existingPages.slice(1)) {
      await extraPage.close().catch(() => {});
    }

    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(60000);
    await this.page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: scenario.device_pixel_ratio || 1,
    });

    // Chromium's userDataDir persists all cookies natively — no JSON restore needed.
    // Prefer wp-admin when target is wp-login so an existing session is reused.
    let startUrl = this._resolveStartUrl(scenario);
    if (startUrl) {
      startUrl = this.browserProfileService?.resolveSessionStartUrl(startUrl)
        || resolveSessionStartUrl(startUrl);
      await this.page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await ensureRememberMeChecked(this.page);
      await this._sleep(400);
    }
  }

  _resolveStartUrl(scenario) {
    const scenarioUrl = String(scenario?.target_url || '').trim();
    if (scenarioUrl) return this._resolveVariables(scenarioUrl);

    const firstNavigate = (scenario?.steps || []).find((step) => step.action_type === 'navigate');
    if (!firstNavigate) return null;

    const anchor = firstNavigate.target_anchor || {};
    const config = anchor.action_config || {};
    const url = String(config.url || anchor.url || '').trim();
    return url ? this._resolveVariables(url) : null;
  }

  async _navigateToScenarioStart(scenario) {
    const startUrl = this._resolveStartUrl(scenario);
    if (!startUrl || !this.page || this.page.isClosed()) return;

    await this.page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await ensureRememberMeChecked(this.page);
    await this._sleep(400);
  }

  async _ensureSessionReady(scenario, executionId) {
    const ready = await this._isDomReady(scenario);
    if (ready) return;

    const parentId = String(scenario.parent_id || '').trim();
    if (!parentId) {
      throw new Error('[Executor] DOM chua san sang. Hay gan parent_id (kich ban prepare/login) cho kich ban nay.');
    }

    console.log(`[Executor] DOM chua san sang — chay kich ban parent: ${parentId}`);
    await this._runParentScenario(parentId, executionId);
    await this._navigateToScenarioStart(scenario);

    const readyAfterParent = await this._isDomReady(scenario);
    if (!readyAfterParent) {
      throw new Error('[Executor] DOM van chua san sang sau khi chay kich ban parent.');
    }
  }

  async _runParentScenario(parentId, executionId) {
    const parent = this.dbService.getScenarioById(parentId);
    if (!parent) {
      throw new Error(`[Executor] Khong tim thay kich ban parent: ${parentId}`);
    }
    if (!parent.steps?.length) {
      throw new Error('[Executor] Kich ban parent chua co buoc nao.');
    }

    const previousScenario = this.currentScenario;
    const previousVariableMap = this._variableMap;

    this.currentScenario = parent;
    this._variableMap = this.dbService.buildVariableMap(parentId, this._currentSampleId);

    this._sendTelemetry({
      type: 'parent:started',
      executionId,
      parentScenarioId: parentId,
      parentScenarioName: parent.name,
      totalSteps: parent.steps.length,
      timestamp: new Date().toISOString(),
    });

    try {
      for (let index = 0; index < parent.steps.length; index += 1) {
        if (!this.isRunning) break;
        await this._executeStep(parent.steps[index], index + 1);
      }
    } finally {
      this.currentScenario = previousScenario;
      this._variableMap = previousVariableMap;
    }

    this._sendTelemetry({
      type: 'parent:completed',
      executionId,
      parentScenarioId: parentId,
      parentScenarioName: parent.name,
      timestamp: new Date().toISOString(),
    });
  }

  _resolveDomCheckAnchor(scenario) {
    const explicit = scenario?.dom_check_anchor;
    if (explicit && typeof explicit === 'object' && Object.keys(explicit).length > 0) {
      return explicit;
    }

    const firstActionStep = (scenario?.steps || []).find(
      (step) => !['navigate', 'wait'].includes(step.action_type),
    );
    return firstActionStep?.target_anchor || null;
  }

  async _isDomReady(scenario) {
    const anchor = this._resolveDomCheckAnchor(scenario);
    if (!anchor) return true;
    if (!this.page || this.page.isClosed()) return false;

    const config = anchor.action_config || {};
    const selector = this._resolveSelector(anchor, config);
    const selectors = this._collectSelectors(anchor, config, selector);

    for (const item of selectors) {
      try {
        await this.page.waitForSelector(item, { timeout: 4000, visible: true });
        return true;
      } catch {
        // Try next selector.
      }
    }

    if (anchor.xpath) {
      try {
        return await this.page.evaluate((xpath) => {
          const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return Boolean(result.singleNodeValue);
        }, anchor.xpath);
      } catch {
        // Ignore invalid xpath.
      }
    }

    return false;
  }

  async _resolveExecutionUserDataDir(scenarioId, browserProfileId, sampleId = null) {
    if (this.browserProfileService) {
      return this.browserProfileService.resolveSessionUserDataDir(
        scenarioId,
        browserProfileId,
        sampleId,
      );
    }

    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir']
      || (this.appDataPath ? path.join(this.appDataPath, 'browser-data') : path.join(this.cacheRoot, 'browser-data'));

    if (browserProfileId) {
      const profile = this.dbService.getBrowserProfileById(browserProfileId);
      if (profile?.import_path) {
        await fsp.mkdir(path.join(profile.import_path, 'Default'), { recursive: true });
        return profile.import_path;
      }
      throw new Error('Không tìm thấy thư mục profile browser trong app');
    }

    return resolveGuestSessionDir(browserDataRoot, scenarioId, sampleId);
  }

  async _executeStep(step, stepIndex) {
    const delayMs = randomRuntimeDelay(step.delay_ms || DEFAULT_ACTION_DELAY_MS);
    if (delayMs) {
      await this._sleep(delayMs);
    }

    switch (step.action_type) {
      case 'navigate':
        await this._executeNavigate(step);
        break;
      case 'click':
        await this._executeClick(step);
        break;
      case 'input':
      case 'type':
      case 'keypress':
        await this._executeType(step);
        break;
      case 'scroll':
        await this._executeScroll(step);
        break;
      case 'wait':
        await this._sleep(randomRuntimeDelay(step.target_anchor?.action_config?.duration || step.delay_ms || DEFAULT_ACTION_DELAY_MS));
        break;
      default:
        console.warn(`[Executor] Unsupported action type at step ${stepIndex}: ${step.action_type}`);
        break;
    }
  }

  async _executeNavigate(step) {
    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const url = this._resolveVariables(
      config.url || anchor.url || step.target_url || this.currentScenario?.target_url,
    );
    if (!url) {
      throw new Error('Bước navigate thiếu URL.');
    }

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await ensureRememberMeChecked(this.page);
    await this._sleep(400);
  }

  async _executeClick(step) {
    await ensureRememberMeChecked(this.page);

    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const selector = this._resolveSelector(anchor, config);
    const viewport = this._getExecutionViewport();
    const selectors = this._collectSelectors(anchor, config, selector);

    if (config.skip_if_checked) {
      const alreadyChecked = await isCheckboxAlreadyChecked(this.page, {
        selectors,
        coords: anchor.relative_coords,
        viewport,
      });
      if (alreadyChecked) return;
    }

    for (const item of selectors) {
      try {
        await this.page.waitForSelector(item, { timeout: 5000, visible: true });
        await this.page.click(item);
        await this._waitAfterClick();
        return;
      } catch {
        // Try next selector.
      }
    }

    const coords = anchor.relative_coords;
    if (coords?.x !== undefined && coords?.y !== undefined) {
      if (config.skip_if_checked) {
        const alreadyChecked = await isCheckboxAlreadyChecked(this.page, {
          selectors: [],
          coords,
          viewport,
        });
        if (alreadyChecked) return;
      }

      const x = Math.round((coords.x / 100) * viewport.width);
      const y = Math.round((coords.y / 100) * viewport.height);
      await this.page.mouse.move(x, y, { steps: 5 });
      await this.page.mouse.click(x, y, { button: 'left' });
      await this._waitAfterClick();
      return;
    }

    throw new Error('Click step không tìm thấy phần tử hoặc tọa độ hợp lệ.');
  }

  async _executeType(step) {
    await ensureRememberMeChecked(this.page);

    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const text = this._resolveVariables(config.text || step.key || '');
    if (!text) return;

    const selector = this._resolveSelector(anchor, config);
    const viewport = this._getExecutionViewport();

    const focused = await this._focusTarget(anchor, config, selector);
    if (!focused) {
      const coords = anchor.relative_coords;
      if (coords?.x !== undefined && coords?.y !== undefined) {
        const x = Math.round((coords.x / 100) * viewport.width);
        const y = Math.round((coords.y / 100) * viewport.height);
        await this.page.mouse.click(x, y);
      } else {
        throw new Error('Không tìm thấy input để nhập text.');
      }
    }

    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('A');
    await this.page.keyboard.up('Control');
    await this.page.keyboard.type(text, { delay: randomRuntimeDelay(config.delay || 50, 25, 120) });
  }

  _getExecutionViewport() {
    const pageViewport = this.page?.viewport?.();
    if (pageViewport?.width && pageViewport?.height) {
      return pageViewport;
    }
    if (this._executionViewport) {
      return this._executionViewport;
    }
    return {
      width: this.currentScenario?.recorded_width || 1280,
      height: this.currentScenario?.recorded_height || 720,
    };
  }

  _resolveSelector(anchor = {}, config = {}) {
    return anchor.selector_value
      || config.selector
      || (anchor.id ? `#${anchor.id}` : '')
      || (anchor.name ? `[name="${anchor.name}"]` : '')
      || (anchor.ariaLabel ? `[aria-label="${anchor.ariaLabel}"]` : '')
      || (anchor.placeholder ? `[placeholder="${anchor.placeholder}"]` : '')
      || anchor.xpath
      || '';
  }

  _collectSelectors(anchor = {}, config = {}, primarySelector = '') {
    return [...new Set([
      primarySelector,
      anchor.selector_value,
      config.selector,
      anchor.id ? `#${anchor.id}` : '',
      anchor.name ? `[name="${anchor.name}"]` : '',
      anchor.ariaLabel ? `[aria-label="${anchor.ariaLabel}"]` : '',
      anchor.placeholder ? `[placeholder="${anchor.placeholder}"]` : '',
    ].filter(Boolean))];
  }

  async _focusTarget(anchor = {}, config = {}, primarySelector = '') {
    const selectors = this._collectSelectors(anchor, config, primarySelector);
    for (const item of selectors) {
      try {
        await this.page.waitForSelector(item, { timeout: 5000, visible: true });
        await this.page.click(item);
        await this.page.focus(item);
        return true;
      } catch {
        // Try next selector.
      }
    }

    if (anchor.xpath) {
      try {
        return await this.page.evaluate((xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          if (!element) return false;
          element.focus();
          element.click?.();
          return true;
        }, anchor.xpath);
      } catch {
        // Ignore invalid xpath.
      }
    }

    return false;
  }

  _resolveVariables(value) {
    if (!value || !this.currentScenario?.id) return value;

    if (!this._variableMap) {
      this._variableMap = this.dbService.buildVariableMap(
        this.currentScenario.id,
        this._currentSampleId,
      );
    }

    return resolveVariableTemplate(value, this._variableMap);
  }

  async _executeScroll(step) {
    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const scrollX = step.scroll_x ?? anchor.scroll_x ?? config.scrollX ?? 0;
    const scrollY = step.scroll_y ?? anchor.scroll_y ?? config.scrollY ?? 0;

    await this.page.evaluate((x, y) => {
      window.scrollTo({ left: x, top: y, behavior: 'smooth' });
    }, scrollX, scrollY);
    await this._sleep(500);
  }

  async cancelExecution() {
    this.isRunning = false;
    await this._cleanupBrowser({ skipDelay: true });
    this._sendTelemetry({
      type: 'execution:cancelled',
      timestamp: new Date().toISOString(),
    });
  }

  _sendTelemetry(payload) {
    try {
      this.sendTelemetry(payload);
    } catch {
      // Telemetry must not break execution.
    }
  }

  async _waitAfterClick() {
    if (!this.page || this.page.isClosed()) return;

    try {
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }),
        this._sleep(1500),
      ]);
    } catch {
      // Ignore navigation wait failures.
    }
  }

  async _settleSessionAfterRun(executionId) {
    if (!this.page || this.page.isClosed()) return;

    // Wait for any in-flight requests / JS to settle before we trigger Chrome flush.
    try {
      await Promise.race([
        this.page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 }),
        this._sleep(3000),
      ]);
    } catch {
      // Ignore — page may have already navigated away.
    }

    this._sendTelemetry({
      type: 'execution:session-check',
      executionId,
      pageUrl: this.page?.isClosed() ? null : this.page?.url(),
      userDataDir: this._activeUserDataDir,
      timestamp: new Date().toISOString(),
    });
  }

  _getBrowserCloseDelayMs() {
    if (this.browserProfileService) {
      return this.browserProfileService.getSessionCloseDelayMs();
    }

    const settings = this.dbService?.getSettings?.() || {};
    const configured = Number(settings['execution.browserCloseDelayMs']);
    if (!Number.isFinite(configured)) return DEFAULT_BROWSER_CLOSE_DELAY_MS;
    return Math.min(
      MAX_BROWSER_CLOSE_DELAY_MS,
      Math.max(MIN_BROWSER_CLOSE_DELAY_MS, Math.round(configured)),
    );
  }

  async _waitBeforeBrowserClose() {
    const delayMs = this._getBrowserCloseDelayMs();
    if (!delayMs || !this.browser?.isConnected?.()) return;

    this._sendTelemetry({
      type: 'execution:closing',
      delayMs,
      message: `Đang lưu session, đóng browser sau ${Math.round(delayMs / 1000)}s...`,
      timestamp: new Date().toISOString(),
    });

    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.evaluate(() => (
          document.readyState === 'complete'
            ? Promise.resolve()
            : new Promise((resolve) => {
              window.addEventListener('load', resolve, { once: true });
            })
        )).catch(() => {});
      }
    } catch {
      // Ignore readiness check failures.
    }

    await this._sleep(delayMs);
  }

  async _cleanupBrowser({ skipDelay = false } = {}) {
    if (!skipDelay) {
      await this._waitBeforeBrowserClose();
    }

    await this._closeBrowserAndWait();

    // Release the per-userDataDir lock so the next queued executor can proceed.
    this._releaseDirLock?.();

    this.page = null;
    this.browser = null;
    this._activeUserDataDir = null;
  }

  async _closeBrowserAndWait() {
    if (!this.browser) return;

    // Close the current page first — this triggers unload handlers so Chrome can
    // flush pending writes (IndexedDB, localStorage, cookies WAL) before exit.
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }

    // Capture the underlying Chrome process before closing the CDP connection.
    const chromeProcess = this.browser.process?.() ?? null;

    try {
      if (this.browser.isConnected()) {
        await this.browser.close();
      }
    } catch {
      // Ignore — browser may already be gone.
    }

    // Wait for the Chrome process to fully exit. This is more reliable than
    // checking SingletonLock: it guarantees Chrome has checkpointed its SQLite
    // WAL (Default/Cookies) before we return, so cookies survive the next open.
    if (chromeProcess) {
      await new Promise((resolve) => {
        if (chromeProcess.exitCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, 15000);
        chromeProcess.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function normalizeScenarioType(value) {
  const normalized = String(value || 'action').trim().toLowerCase();
  if (normalized === 'prepare' || normalized === 'crawl' || normalized === 'action') {
    return normalized;
  }
  return 'action';
}

function normalizeExecutionViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') return null;
  const width = Math.round(Number(viewport.width));
  const height = Math.round(Number(viewport.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 320 || height < 240 || width > 4096 || height > 4096) return null;
  return { width, height };
}

function randomRuntimeDelay(baseMs = DEFAULT_ACTION_DELAY_MS, minMs = 120, maxMs = 1500) {
  const base = Math.max(1, Number(baseMs) || DEFAULT_ACTION_DELAY_MS);
  const factor = 0.7 + Math.random() * 1.1;
  return Math.round(Math.max(minMs, Math.min(maxMs, base * factor)));
}

export { ExecutorService };
