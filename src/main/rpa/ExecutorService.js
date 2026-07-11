import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { getCrawlExtractionScript } from './CardExtractorScript.js';
import {
  buildFacebookPostLink,
  applyFacebookCrawlSettingsToMeta,
  buildFacebookGroupUrl,
  buildFacebookCrawlNavigationError,
  FACEBOOK_CRAWL_URL_GUARD_SKIP_MESSAGE,
  isFacebookCrawlUrlGuardMatch,
  parseFacebookGroupLink,
  parseFacebookPostLink,
  shouldSkipFacebookCrawlRequest,
  validateFacebookCrawlNavigation,
} from '../../shared/facebookCrawlConfig.js';
import {
  parseFacebookGraphQLBatch,
} from '../../shared/parseFacebookGraphQL.js';
import { crawlConditionShouldStopScroll } from '../../shared/crawlStopCondition.js';
import {
  isCrawlScrollAtBottom,
  isCrawlScrollStuck,
  resolveCrawlScrollContext,
  resolveCrawlScrollLoopConfig,
  runCrawlScrollStep,
  shouldStopCrawlScrollEarly,
} from '../../shared/crawlScroll.js';
import {
  mergeRequestCatchingRawObjects,
  RequestCatchingPuppeteerCapture,
} from './RequestCatchingPuppeteerCapture.js';
import { CrawlRequestDumpService } from './CrawlRequestDumpService.js';
import { resolveScenarioTargetUrl, resolveVariableTemplate } from './VariableResolver.js';
import { ensureRememberMeChecked, isCheckboxAlreadyChecked, resolveGuestSessionDir, resolveSessionStartUrl } from '../browser/BrowserSessionPaths.js';

const DEFAULT_ACTION_DELAY_MS = 300;
const DEFAULT_BROWSER_CLOSE_DELAY_MS = 5000;
const MIN_BROWSER_CLOSE_DELAY_MS = 1000;
const MAX_BROWSER_CLOSE_DELAY_MS = 120000;

function buildPuppeteerProxyLaunchArgs(proxy) {
  if (!proxy?.ip || !proxy?.port) return [];
  const protocol = String(proxy.protocol || 'http').replace(/:$/, '');
  return [`--proxy-server=${protocol}://${proxy.ip}:${proxy.port}`];
}

async function applyPageProxyAuth(page, proxy) {
  if (!proxy?.username || !page) return;
  await page.authenticate({
    username: proxy.username,
    password: proxy.password || '',
  });
}

// Module-level lock: prevents two executors from launching Chrome against the
// same userDataDir simultaneously. Maps dir → resolve-fn of the pending lock.
const userDataDirLocks = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ExecutorService {
  constructor({ dbService, browserProfileService, sendTelemetry, cacheRoot, appDataPath, platformCrawledDataService } = {}) {
    if (!dbService) {
      throw new Error('[Executor] dbService is required.');
    }

    this.dbService = dbService;
    this.browserProfileService = browserProfileService || null;
    this.platformCrawledDataService = platformCrawledDataService || null;
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
    this._currentExecutionId = null;
    this._crawlDumpFolderId = null;
    this._executionViewport = null;
    this._releaseDirLock = null;
    this._crawlResults = [];
    this._requestCatchingCapture = null;
  }

  async startScenario(scenarioId, options = {}) {
    if (this.isRunning) {
      throw new Error('[Executor] Instance nay dang chay. Dung instance khac de chay song song.');
    }

    this.isRunning = true;
    const executionId = options.executionId || crypto.randomUUID();
    this._currentExecutionId = executionId;
    this._crawlDumpFolderId = null;
    const startTime = Date.now();
    this._currentBrowserProfileId = options.browserProfileId ?? null;
    this._currentSampleId = options.sampleId
      ? String(options.sampleId).trim() || null
      : null;
    this._variableMap = null;
    this._crawlResults = [];
    const stepResults = [];

    try {
      const scenario = this.dbService.getScenarioById(scenarioId);
      if (!scenario) {
        throw new Error(`[Executor] Khong tim thay scenario: ${scenarioId}`);
      }
      const scenarioType = normalizeScenarioType(scenario.scenario_type);
      const isRequestCatching = scenarioType === 'request_catching';
      const totalSteps = isRequestCatching ? 1 : (scenario.steps?.length || 0);

      if (!isRequestCatching && totalSteps === 0) {
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
      if (Array.isArray(options.runtimeVariables)) {
        options.runtimeVariables.forEach((item) => {
          const key = String(item?.key || '').trim();
          if (!key) return;
          this._variableMap.set(key, item?.value ?? '');
        });
      }
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
        totalSteps,
        timestamp: new Date().toISOString(),
      });

      await this.dbService.createExecutionLog({
        id: executionId,
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        browser_profile_id: this._currentBrowserProfileId,
        variable_profile_id: variableProfileId,
        variable_profile_name: variableProfileName,
        variable_sample_id: this._currentSampleId,
        variable_sample_name: variableSampleName,
        status: 'running',
        total_steps: totalSteps,
        started_at: this._executionStartedAt,
      });

      await this._launchBrowser(scenario, options);

      if (!isRequestCatching && scenarioType !== 'prepare') {
        await this._ensureSessionReady(scenario, executionId);
      }

      if (isRequestCatching) {
        const stepStartedAt = new Date().toISOString();
        const stepStartTime = Date.now();

        this._sendTelemetry({
          type: 'step:started',
          executionId,
          stepIndex: 1,
          totalSteps,
          stepId: null,
          actionType: 'request_catching',
          timestamp: new Date().toISOString(),
        });

        try {
          const output = await this._executeRequestCatching(scenario);
          stepResults.push({
            index: 1,
            step_id: null,
            action_type: 'request_catching',
            status: 'completed',
            started_at: stepStartedAt,
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - stepStartTime,
            output: output || null,
          });
        } catch (stepError) {
          this._failedStepIndex = 1;
          stepResults.push({
            index: 1,
            step_id: null,
            action_type: 'request_catching',
            status: 'failed',
            started_at: stepStartedAt,
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - stepStartTime,
            error: stepError.message,
          });
          this._sendTelemetry({
            type: 'step:failed',
            executionId,
            stepIndex: 1,
            totalSteps,
            stepId: null,
            actionType: 'request_catching',
            error: stepError.message,
            timestamp: new Date().toISOString(),
          });
          throw stepError;
        }

        this._sendTelemetry({
          type: 'step:completed',
          executionId,
          stepIndex: 1,
          totalSteps,
          stepId: null,
          actionType: 'request_catching',
          completedSteps: 1,
          timestamp: new Date().toISOString(),
        });
      }

      for (let index = 0; index < (isRequestCatching ? 0 : scenario.steps.length); index += 1) {
        if (!this.isRunning) break;

        const step = scenario.steps[index];
        const stepIndex = index + 1;
        const stepStartedAt = new Date().toISOString();
        const stepStartTime = Date.now();

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
          const output = await this._executeStep(step, stepIndex);
          stepResults.push({
            index: stepIndex,
            step_id: step.id,
            action_type: step.action_type,
            status: 'completed',
            started_at: stepStartedAt,
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - stepStartTime,
            output: output || null,
          });
        } catch (stepError) {
          this._failedStepIndex = stepIndex;
          stepResults.push({
            index: stepIndex,
            step_id: step.id,
            action_type: step.action_type,
            status: 'failed',
            started_at: stepStartedAt,
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - stepStartTime,
            error: stepError.message,
          });
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
      const resultJson = buildExecutionResult({
        success: true,
        executionId,
        scenario,
        status: 'completed',
        totalSteps,
        completedSteps: totalSteps,
        failedSteps: 0,
        durationMs,
        startedAt: this._executionStartedAt,
        finishedAt,
        stepResults,
        browserProfileId: this._currentBrowserProfileId,
        variableSampleId: this._currentSampleId,
        pageUrl: this.page && !this.page.isClosed() ? this.page.url() : null,
        crawlResults: this._crawlResults,
      });

      this.dbService.finishExecutionLog(executionId, {
        status: 'completed',
        completed_steps: totalSteps,
        failed_steps: 0,
        duration_ms: durationMs,
        finished_at: finishedAt,
        result_json: resultJson,
      });

      this._sendTelemetry({
        type: 'execution:completed',
        executionId,
        scenarioId,
        scenarioName: scenario.name,
        totalSteps,
        completedSteps: totalSteps,
        failedSteps: 0,
        durationMs,
        errors: [],
        resultJson,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        executionId,
        completedSteps: totalSteps,
        totalSteps,
        failedSteps: 0,
        durationMs,
        errors: [],
        resultJson,
      };
    } catch (error) {
      const failedScenarioType = normalizeScenarioType(this.currentScenario?.scenario_type);
      const totalSteps = failedScenarioType === 'request_catching'
        ? 1
        : (this.currentScenario?.steps?.length || 0);
      const completedSteps = Math.max(0, (this._failedStepIndex || 1) - 1);
      const finishedAt = new Date().toISOString();
      const resultJson = buildExecutionResult({
        success: false,
        executionId,
        scenario: this.currentScenario || { id: scenarioId },
        status: 'failed',
        totalSteps,
        completedSteps,
        failedSteps: 1,
        failedStepIndex: this._failedStepIndex,
        durationMs: Date.now() - startTime,
        startedAt: this._executionStartedAt || new Date(startTime).toISOString(),
        finishedAt,
        stepResults,
        error: error.message,
        browserProfileId: this._currentBrowserProfileId,
        variableSampleId: this._currentSampleId,
        pageUrl: this.page && !this.page.isClosed() ? this.page.url() : null,
        crawlResults: this._crawlResults,
      });

      this.dbService.finishExecutionLog(executionId, {
        status: 'failed',
        total_steps: totalSteps,
        completed_steps: completedSteps,
        failed_steps: 1,
        failed_step_index: this._failedStepIndex,
        error_message: error.message,
        finished_at: finishedAt,
        result_json: resultJson,
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
        resultJson,
        startedAt: this._executionStartedAt || new Date(startTime).toISOString(),
        timestamp: finishedAt,
      });
      throw error;
    } finally {
      await this._cleanupBrowser();
      this.isRunning = false;
      this.currentScenario = null;
      this._executionViewport = null;
      this._crawlResults = [];
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
    const proxyId = options.proxyId ?? null;
    const proxyConfig = proxyId ? this.dbService.getProxyById?.(proxyId) : null;
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${viewport.width},${viewport.height}`,
      ...buildPuppeteerProxyLaunchArgs(proxyConfig),
    ];
    this.browser = await puppeteer.launch({
      headless,
      userDataDir,
      defaultViewport: viewport,
      args: launchArgs,
    });

    const existingPages = await this.browser.pages();
    this.page = existingPages[0] || await this.browser.newPage();
    for (const extraPage of existingPages.slice(1)) {
      await extraPage.close().catch(() => {});
    }

    if (proxyConfig) {
      await applyPageProxyAuth(this.page, proxyConfig);
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
    if (startUrl && normalizeScenarioType(scenario.scenario_type) !== 'request_catching') {
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
    if (scenarioUrl) {
      const map = this._variableMap || this.dbService.buildVariableMap(
        scenario?.id,
        this._currentSampleId,
      );
      return resolveScenarioTargetUrl(scenarioUrl, map);
    }

    const firstNavigate = (scenario?.steps || []).find((step) => step.action_type === 'navigate');
    if (!firstNavigate) return null;

    const anchor = firstNavigate.target_anchor || {};
    const config = anchor.action_config || {};
    const url = String(config.url || anchor.url || '').trim();
    if (!url) return null;

    const map = this._variableMap || this.dbService.buildVariableMap(
      scenario?.id,
      this._currentSampleId,
    );
    return resolveScenarioTargetUrl(url, map);
  }

  _resolveRequestCatchingTargetUrl(scenario, map) {
    const scenarioUrl = String(scenario?.target_url || '').trim();
    const resolvedScenarioUrl = scenarioUrl
      ? resolveScenarioTargetUrl(scenarioUrl, map)
      : '';
    const platform = String(scenario?.platform || 'facebook').trim().toLowerCase();
    if (platform !== 'facebook') {
      return resolvedScenarioUrl || this.page?.url?.() || '';
    }

    const groupId = String(map?.get?.('group_id') || '').trim();
    const postId = String(map?.get?.('post_id') || '').trim();
    if (groupId && postId) {
      return buildFacebookPostLink(postId, groupId);
    }
    if (groupId) {
      return buildFacebookGroupUrl(groupId);
    }

    return resolvedScenarioUrl || this.page?.url?.() || '';
  }

  async _navigateToScenarioStart(scenario, targetUrlOverride = '') {
    const startUrl = String(targetUrlOverride || '').trim() || this._resolveStartUrl(scenario);
    if (!startUrl || !this.page || this.page.isClosed()) return;

    await this.page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await ensureRememberMeChecked(this.page);
    await this._sleep(400);
    await this._verifyFacebookGroupNavigation(scenario, startUrl);
  }

  async _verifyFacebookGroupNavigation(scenario, expectedUrl) {
    const platform = String(scenario?.platform || '').trim().toLowerCase();
    if (platform !== 'facebook' || !this.page || this.page.isClosed()) return;

    const map = this._variableMap || this.dbService.buildVariableMap(
      scenario?.id,
      this._currentSampleId,
    );
    const expectedGroupId = String(
      map.get('group_id')
      || parseFacebookGroupLink(expectedUrl).group_id
      || '',
    ).trim();

    const actualUrl = this.page.url() || '';
    const validation = validateFacebookCrawlNavigation(expectedUrl, actualUrl);
    if (!validation.ok) {
      throw new Error(buildFacebookCrawlNavigationError(validation, expectedUrl, actualUrl));
    }

    if (expectedGroupId) {
      const actualGroupId = parseFacebookGroupLink(actualUrl).group_id;
      if (actualGroupId && actualGroupId.toLowerCase() !== expectedGroupId.toLowerCase()) {
        throw new Error(buildFacebookCrawlNavigationError({
          ok: false,
          reason: 'group_mismatch',
          expected: { group_id: expectedGroupId },
          actual: { group_id: actualGroupId },
        }, expectedUrl, actualUrl));
      }
    }
  }

  async _guardFacebookCrawlPageUrl(targetUrl = '', options = {}) {
    if (!targetUrl || !this.page || this.page.isClosed()) {
      return { ok: true, currentUrl: '' };
    }

    try {
      const recover = options.recover !== false;
      let currentUrl = this.page.url() || '';
      if (isFacebookCrawlUrlGuardMatch(targetUrl, { pageUrl: currentUrl })) {
        return { ok: true, currentUrl };
      }

      if (!recover) {
        console.warn(`[Executor] URL Guard: trinh duyet da di lac (${currentUrl}). Dung scroll hien tai.`);
        return {
          ok: false,
          currentUrl,
          reason: 'url_mismatch',
        };
      }

      console.warn(
        `[Executor] URL Guard: trinh duyet da di lac (${currentUrl}). Thu goBack...`,
      );

      try {
        await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await this._sleep(800);
        currentUrl = this.page.url() || '';
        if (isFacebookCrawlUrlGuardMatch(targetUrl, { pageUrl: currentUrl })) {
          console.log(`[Executor] URL Guard: da quay lai trang crawl (${currentUrl})`);
          return { ok: true, currentUrl, recovered: true };
        }
      } catch (error) {
        console.warn('[Executor] URL Guard goBack failed:', error?.message || error);
      }

      throw new Error(
        `URL Guard: trinh duyet da roi khoi trang crawl va khong the quay lai. `
        + `Mong muon: ${targetUrl}. Hien tai: ${currentUrl}`,
      );
    } catch (error) {
      if (String(error?.message || '').startsWith('URL Guard:')) {
        throw error;
      }
      console.warn('[Executor] URL Guard check failed:', error?.message || error);
      return { ok: true, currentUrl: this.page?.url?.() || '' };
    }
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
    const map = this._variableMap || this.dbService.buildVariableMap(
      scenario?.id,
      this._currentSampleId,
    );
    const requestCatchingTargetUrl = isRequestCatchingScenario(scenario)
      ? this._resolveRequestCatchingTargetUrl(scenario, map)
      : '';
    await this._navigateToScenarioStart(scenario, requestCatchingTargetUrl);

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
        return this._executeClick(step);
      case 'input':
      case 'type':
      case 'keypress':
        await this._executeType(step);
        break;
      case 'file':
        await this._executeFile(step);
        break;
      case 'scroll':
        await this._executeScroll(step);
        break;
      case 'wait':
        await this._sleep(randomRuntimeDelay(step.target_anchor?.action_config?.duration || step.delay_ms || DEFAULT_ACTION_DELAY_MS));
        break;
      case 'crawl':
        return this._executeCrawl(step, stepIndex);
      default:
        console.warn(`[Executor] Unsupported action type at step ${stepIndex}: ${step.action_type}`);
        break;
    }
    return null;
  }

  async _executeCrawl(step, stepIndex) {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Trang browser khong san sang de crawl.');
    }

    const anchor = {
      ...(step.target_anchor || {}),
      action_config: {
        ...((step.target_anchor || {}).action_config || {}),
        ...(step.action_config || {}),
      },
    };
    const config = anchor.action_config || {};
    const maxCards = config.max_cards || config.limit || 100;
    const crawlMeta = getCrawlMeta(this.currentScenario?.scenario_meta);
    const result = await this._extractCrawlWithScroll(anchor, maxCards, crawlMeta);

    if (!result?.ok) {
      throw new Error(result?.message || 'Khong extract duoc crawl widget.');
    }

    const cards = Array.isArray(result.sample_dump) ? result.sample_dump : [];
    const payload = {
      step_index: stepIndex,
      step_id: step.id,
      widget_label: config.label || '',
      selector: result.selector || config.parent_container_selector || anchor.selector_value || '',
      match_count: Number(result.match_count) || 0,
      cards,
      sample_dump: cards,
    };

    this._crawlResults.push(payload);
    return payload;
  }

  async _executeRequestCatching(scenario) {
    return this._executeRequestCatchingLive(scenario);
  }

  async _executeRequestCatchingLive(scenario) {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Trang browser khong san sang cho request_catching.');
    }

    const platform = String(scenario?.platform || 'facebook').trim().toLowerCase() || 'facebook';
    const map = this._variableMap || this.dbService.buildVariableMap(
      scenario?.id,
      this._currentSampleId,
    );
    const targetUrl = this._resolveRequestCatchingTargetUrl(scenario, map);
    const isSinglePostCrawl = Boolean(
      String(map?.get?.('post_id') || '').trim()
      || parseFacebookPostLink(targetUrl).post_id,
    );
    const crawlMeta = applyFacebookCrawlSettingsToMeta(
      getCrawlMeta(scenario?.scenario_meta),
      this.dbService.getSettings(),
    );
    const infinite = crawlMeta.infinity_scroll || {};
    const postLimit = resolveFacebookPostLimit(map?.get?.('post_limit'));
    const capturedPostIds = new Set();
    const resolvedCondition = {
      ...infinite.condition,
      value: this._resolveVariables(String(infinite.condition?.value ?? '')),
    };
    const customFilters = scenario?.scenario_meta?.request_catching?.filters || {};
    const rawCaptured = [];
    let conditionStopPending = false;
    const scrollProgress = { completedBatches: 0 };
    const emptyBatchProgress = {
      lastRawCount: 0,
      consecutive: 0,
    };
    const MAX_EMPTY_SCROLL_BATCHES = 5;
    const shouldCheckStopCondition = infinite.enabled
      && infinite.stop_mode === 'condition'
      && !postLimit
      && !isSinglePostCrawl;
    const shouldCheckPostLimit = postLimit > 0 && !isSinglePostCrawl;

    this._crawlDumpFolderId = CrawlRequestDumpService.resolveFolderId({
      targetUrl,
      variables: map,
      scenarioId: scenario?.id,
      executionId: this._currentExecutionId,
    });

    if (CrawlRequestDumpService.isEnabled()) {
      await CrawlRequestDumpService.writeMeta(this._crawlDumpFolderId, {
        targetUrl,
        scenarioId: scenario?.id || '',
        executionId: this._currentExecutionId || '',
        scenarioName: scenario?.name || '',
      });
      console.log(
        `[Executor] Crawl request dump enabled: ${CrawlRequestDumpService.resolveDumpDir(this._crawlDumpFolderId)}`,
      );
    }

    const capture = new RequestCatchingPuppeteerCapture();
    this._requestCatchingCapture = capture;

    try {
      await capture.start(this.page, platform, {
        customFilters,
        onCapture: (items, meta = {}) => {
          try {
            const pageUrl = this.page && !this.page.isClosed() ? this.page.url() : '';
            if (shouldSkipFacebookCrawlRequest({
              targetUrl,
              pageUrl,
              referer: meta?.referer,
              requestHeaders: meta?.requestHeaders,
            })) {
              console.warn(`[Executor] ${FACEBOOK_CRAWL_URL_GUARD_SKIP_MESSAGE}`);
              return;
            }
          } catch (error) {
            console.warn('[Executor] URL Guard request filter failed:', error?.message || error);
          }

          const annotatedItems = annotateFacebookGraphQLRawObjects(items, meta);
          const merged = mergeRequestCatchingRawObjects(rawCaptured, annotatedItems);
          rawCaptured.length = 0;
          rawCaptured.push(...merged);

          if (CrawlRequestDumpService.isEnabled() && this._crawlDumpFolderId) {
            void CrawlRequestDumpService.appendCapture(this._crawlDumpFolderId, annotatedItems, meta);
          }

          if ((!shouldCheckStopCondition && !shouldCheckPostLimit) || conditionStopPending) return;

          const parsedBatch = parseFacebookGraphQLBatch(annotatedItems, { targetUrl, variables: map });
          addFacebookPostIds(capturedPostIds, parsedBatch);
          if (shouldCheckPostLimit && capturedPostIds.size >= postLimit) {
            conditionStopPending = true;
            console.log(`[Executor] Post limit reached (${capturedPostIds.size}/${postLimit}) - finishing current scroll batch before stopping`);
            return;
          }
          if (shouldCheckStopCondition && crawlConditionShouldStopScroll(parsedBatch, resolvedCondition)) {
            conditionStopPending = true;
            console.log('[Executor] Stop condition matched — finishing current scroll batch before stopping');
          }
        },
      });

      await this._navigateToScenarioStart(scenario, targetUrl);
      await this._sleep(1500);
      if (isSinglePostCrawl) {
        const initialStateItems = await extractFacebookInitialStateJson(this.page, {
          targetUrl,
          variables: map,
        });
        if (initialStateItems.length) {
          const annotatedItems = annotateFacebookGraphQLRawObjects(initialStateItems, {
            url: targetUrl,
            friendlyName: 'FacebookInitialStateJson',
            source: 'initial_state_json',
          });
          const merged = mergeRequestCatchingRawObjects(rawCaptured, annotatedItems);
          rawCaptured.length = 0;
          rawCaptured.push(...merged);
          emptyBatchProgress.lastRawCount = rawCaptured.length;

          if (CrawlRequestDumpService.isEnabled() && this._crawlDumpFolderId) {
            void CrawlRequestDumpService.appendCapture(this._crawlDumpFolderId, annotatedItems, {
              url: targetUrl,
              friendlyName: 'FacebookInitialStateJson',
              source: 'initial_state_json',
            });
          }
          console.log(`[Executor] Initial state JSON captured ${initialStateItems.length} object(s)`);
        } else {
          console.warn('[Executor] Initial state JSON did not contain usable post JSON');
        }
      }
      await this._runRequestCatchingScroll(
        crawlMeta,
        () => false,
        targetUrl,
        (loopConfig) => (
          conditionStopPending
            && scrollProgress.completedBatches >= (loopConfig?.minBatchesBeforeConditionStop || 1)
        ),
        scrollProgress,
        null,
        false,
        () => {
          const rawCount = rawCaptured.length;
          if (rawCount > emptyBatchProgress.lastRawCount) {
            emptyBatchProgress.lastRawCount = rawCount;
            emptyBatchProgress.consecutive = 0;
            return false;
          }

          emptyBatchProgress.consecutive += 1;
          console.log(
            `[Executor] Empty GraphQL scroll batch ${emptyBatchProgress.consecutive}/${MAX_EMPTY_SCROLL_BATCHES}`,
          );
          return emptyBatchProgress.consecutive >= MAX_EMPTY_SCROLL_BATCHES;
        },
      );
      await this._waitForRequestCatchingSettle();
    } finally {
      await capture.stop();
      this._requestCatchingCapture = null;
    }

    if (!rawCaptured.length) {
      throw new Error(
        'Khong bat duoc GraphQL nao trong phien chay. Kiem tra URL dich, dang nhap Facebook, va bo loc request.',
      );
    }

    if (CrawlRequestDumpService.isEnabled() && this._crawlDumpFolderId) {
      const savedDump = await CrawlRequestDumpService.saveSession(this._crawlDumpFolderId, {
        targetUrl,
        actualUrl: this.page && !this.page.isClosed() ? this.page.url() : '',
        executionId: this._currentExecutionId || '',
        scenarioId: scenario?.id || '',
        rawCaptured,
      });
      console.log(
        `[Executor] Crawl request dump saved: ${savedDump?.raw_object_count || 0} objects -> ${savedDump?.dumpPath || ''}`,
      );
    }

    let cleaned = parseFacebookGraphQLBatch(rawCaptured, { targetUrl, variables: map });
    if (isSinglePostCrawl) {
      const targetPostId = String(map?.get?.('post_id') || parseFacebookPostLink(targetUrl).post_id || '').trim();
      cleaned = mergeSinglePostParsedResults(cleaned, {
        postId: targetPostId,
        groupId: String(map?.get?.('group_id') || parseFacebookPostLink(targetUrl).group_id || '').trim(),
        targetUrl,
      });
      const hasTargetPost = cleaned.some((post) => (
        String(post?.post_id || '') === targetPostId
        && post._comments_only !== true
        && post._feedback_only !== true
      ));
      if (!hasTargetPost) {
        throw new Error('Initial state JSON did not capture the target post JSON.');
      }
    }

    let facebookDbSave = null;
    if (platform === 'facebook' && this.platformCrawledDataService) {
      const groupMeta = isSinglePostCrawl
        ? { groupName: '', groupType: 'Private' }
        : await readFacebookGroupMeta(this.page);
      const saveCandidates = cleaned.filter((post) => (
        post?.post_id
        && post._comments_only !== true
        && post._feedback_only !== true
      ));
      facebookDbSave = await this.platformCrawledDataService.saveFacebookPostsBatch(
        saveCandidates,
        {
          group_link: targetUrl,
          group_name: groupMeta.groupName,
          group_type: groupMeta.groupType,
        },
        {
          platform: 'facebook',
          supplement: false,
          requireExistingPostForCommentOnly: true,
        },
      );
      console.log(
        `[Executor] Facebook DB save: ${facebookDbSave.saved} saved, ${facebookDbSave.failed} failed`
        + (facebookDbSave.errors?.length ? `, errors: ${JSON.stringify(facebookDbSave.errors)}` : ''),
      );
    }

    const payload = {
      step_index: 1,
      widget_label: 'request_catching',
      platform,
      source: 'live_browser',
      page_url: this.page && !this.page.isClosed() ? this.page.url() : targetUrl,
      raw_object_count: rawCaptured.length,
      raw_captured: rawCaptured,
      capture_count: cleaned.length,
      crawledData: cleaned,
      facebook_db_save: facebookDbSave,
      scroll_stopped_by_condition: conditionStopPending,
      post_limit: postLimit || null,
      post_limit_reached: Boolean(postLimit && capturedPostIds.size >= postLimit),
      cards: cleaned.map((item, index) => ({
        card_index: index,
        data: item,
      })),
    };

    this._crawlResults.push(payload);
    return payload;
  }

  async _waitForScrollBatchSettle(settleMs = 4000) {
    const waitMs = Math.max(3000, Number(settleMs) || 4000);
    const startedAt = Date.now();

    if (!this.page || this.page.isClosed()) {
      await this._sleep(waitMs);
      return;
    }

    try {
      await this.page.waitForNetworkIdle({ idleTime: 900, timeout: waitMs });
    } catch {
      // Ignore network-idle timeout — minimum wait below still applies.
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < waitMs) {
      await this._sleep(waitMs - elapsed);
    }
  }

  async _waitForRequestCatchingSettle() {
    if (!this.page || this.page.isClosed()) return;

    try {
      await Promise.race([
        this.page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }),
        this._sleep(8000),
      ]);
    } catch {
      await this._sleep(6000);
    }
  }

  async _runRequestCatchingScroll(
    crawlMeta = {},
    shouldStop = () => false,
    targetUrl = '',
    shouldStopAfterSettle = () => false,
    scrollProgress = null,
    forcedScrollContext = null,
    disableEarlyScrollStop = false,
    onBatchSettled = null,
  ) {
    if (!this.page || this.page.isClosed()) return;

    const autoscroll = crawlMeta.autoscroll || {};
    const infinite = crawlMeta.infinity_scroll || {};
    const shouldScroll = autoscroll.enabled || infinite.enabled;
    const scrollContext = forcedScrollContext || resolveCrawlScrollContext(targetUrl || this.page.url());

    if (!shouldScroll) {
      await this._sleep(Math.max(2000, Number(autoscroll.delay_ms) || 500) * 2);
      return;
    }

    const loop = resolveCrawlScrollLoopConfig(crawlMeta, scrollContext);

    let previousState = scrollContext === 'comments'
      ? await this.page.evaluate(runCrawlScrollStep, 0, 'reset', scrollContext)
      : await this.page.evaluate(runCrawlScrollStep, 0, 'read', scrollContext);
    await this._sleep(loop.initialDelayMs);

    const startedAt = Date.now();
    let totalScrolls = 0;
    let urlGuardStopped = false;

    for (let batchIndex = 0; batchIndex < loop.maxBatches; batchIndex += 1) {
      if (shouldStop()) break;
      if (loop.infiniteEnabled && Date.now() - startedAt >= loop.timeoutMs) break;

      if (targetUrl) {
        const guard = await this._guardFacebookCrawlPageUrl(targetUrl, {
          recover: batchIndex === 0 && scrollContext !== 'comments',
        });
        if (guard?.ok === false) {
          urlGuardStopped = true;
          break;
        }
      }

      const remainingScrolls = loop.maxScrolls - totalScrolls;
      const batchSize = Math.min(loop.scrollsPerBatch, remainingScrolls);
      if (batchSize <= 0) break;

      let nextState = previousState;
      let movedInBatch = 0;
      for (let scrollIndex = 0; scrollIndex < batchSize; scrollIndex += 1) {
        if (shouldStop()) break;

        if (targetUrl) {
          const currentUrl = this.page.url() || '';
          if (!isFacebookCrawlUrlGuardMatch(targetUrl, { pageUrl: currentUrl })) {
            const guard = await this._guardFacebookCrawlPageUrl(targetUrl, { recover: false });
            if (guard?.ok === false) {
              urlGuardStopped = true;
              break;
            }
          }
        }

        if (urlGuardStopped) break;

        nextState = await this.page.evaluate(
          runCrawlScrollStep,
          loop.scrollDistance,
          'scroll',
          scrollContext,
        );
        totalScrolls += 1;
        const moved = !await this.page.evaluate(isCrawlScrollStuck, previousState, nextState);
        if (moved) movedInBatch += 1;
        previousState = nextState;

        if (scrollIndex < batchSize - 1) {
          await this._sleep(loop.betweenScrollMs);
        }
      }

      if (urlGuardStopped) break;
      if (shouldStop()) break;

      console.log(
        `[Executor] Scroll batch ${batchIndex + 1}/${loop.maxBatches}: moved ${movedInBatch}/${batchSize}`
        + ` (${scrollContext}, top ${Math.round(Number(nextState?.scrollTop) || 0)})`,
      );

      await this._waitForScrollBatchSettle(loop.settleMs);

      if (scrollProgress) {
        scrollProgress.completedBatches += 1;
      }

      const stopAfterSettle = shouldStopAfterSettle(loop);
      const stopFromBatchHook = onBatchSettled
        ? await Promise.resolve(onBatchSettled(loop, { nextState, previousState }))
        : false;

      if (shouldStop() || stopAfterSettle || stopFromBatchHook) break;

      const atBottom = await this.page.evaluate(isCrawlScrollAtBottom, nextState);
      const didNotMove = await this.page.evaluate(isCrawlScrollStuck, previousState, nextState);
      if (!disableEarlyScrollStop && shouldStopCrawlScrollEarly({
        infiniteEnabled: loop.infiniteEnabled,
        atBottom,
        didNotMove,
      })) break;

      previousState = nextState;
    }
  }

  async _extractCrawlWithScroll(anchor, maxCards, crawlMeta = {}) {
    const autoscroll = crawlMeta.autoscroll || {};
    const infinite = crawlMeta.infinity_scroll || {};
    const scrollDistance = Math.max(100, Number(autoscroll.distance_px) || 600);
    const scrollDelay = Math.max(100, Number(autoscroll.delay_ms) || 500);
    const shouldScroll = autoscroll.enabled || infinite.enabled;

    if (shouldScroll) {
      await this.page.evaluate(runCrawlScrollStep, 0, 'reset');
      await this._sleep(scrollDelay);
    }

    let latest = await this.page.evaluate(getCrawlExtractionScript(anchor, maxCards));
    const accumulatedCards = createCrawlCardAccumulator();
    accumulatedCards.add(latest?.sample_dump);
    if (!shouldScroll) return latest;

    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, Number(infinite.timeout_ms) || 30000);
    const maxScrolls = infinite.enabled
      ? Math.max(1, Math.min(200, Number(infinite.max_scrolls) || 30))
      : 200;
    let previousState = await this.page.evaluate(runCrawlScrollStep, 0, 'reset');

    for (let scrollIndex = 0; scrollIndex < maxScrolls; scrollIndex += 1) {
      if (infinite.stop_mode === 'condition' && crawlConditionMatched(latest?.sample_dump, infinite.condition)) {
        break;
      }
      if (infinite.enabled && Date.now() - startedAt >= timeoutMs) {
        break;
      }

      const nextState = await this.page.evaluate(runCrawlScrollStep, scrollDistance, 'scroll');
      await this._sleep(scrollDelay);

      latest = await this.page.evaluate(getCrawlExtractionScript(anchor, maxCards));
      accumulatedCards.add(latest?.sample_dump);

      const atBottom = await this.page.evaluate(isCrawlScrollAtBottom, nextState);
      const didNotMove = await this.page.evaluate(isCrawlScrollStuck, previousState, nextState);
      if (shouldStopCrawlScrollEarly({
        infiniteEnabled: infinite.enabled,
        atBottom,
        didNotMove,
      })) {
        break;
      }
      previousState = nextState;
    }

    latest = {
      ...(latest || {}),
      match_count: Math.max(Number(latest?.match_count) || 0, accumulatedCards.cards.length),
      sample_dump: accumulatedCards.cards.map((card, index) => ({
        ...card,
        card_index: index,
      })),
    };

    return latest;
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
    let coordinateAttempt = null;
    let coordinateError = null;

    if (config.skip_if_checked) {
      const alreadyChecked = await isCheckboxAlreadyChecked(this.page, {
        selectors,
        coords: anchor.relative_coords,
        viewport,
      });
      if (alreadyChecked) {
        return {
          click_method: 'skipped_checked',
          reason: 'checkbox_already_checked',
          selector: selectors[0] || null,
          coords_percent: anchor.relative_coords || null,
          viewport,
        };
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
        if (alreadyChecked) {
          return {
            click_method: 'skipped_checked',
            reason: 'checkbox_already_checked',
            coords_percent: coords,
            viewport,
          };
        }
      }

      const x = Math.round((coords.x / 100) * viewport.width);
      const y = Math.round((coords.y / 100) * viewport.height);
      coordinateAttempt = {
        x,
        y,
        coords_percent: {
          x: Number(coords.x),
          y: Number(coords.y),
        },
        viewport,
      };
      try {
        await this.page.mouse.move(x, y, { steps: 5 });
        await this.page.mouse.click(x, y, { button: 'left' });
        await this._waitAfterClick();
        console.log(`[Executor] Click by coordinates x=${x}, y=${y} (${coords.x}%, ${coords.y}%)`);
        return {
          click_method: 'coordinates',
          ...coordinateAttempt,
        };
      } catch (error) {
        coordinateError = error;
        console.warn(`[Executor] Coordinate click failed x=${x}, y=${y}; falling back to selector. ${error.message}`);
      }
    }

    for (const item of selectors) {
      try {
        await this.page.waitForSelector(item, { timeout: 5000, visible: true });
        await this.page.click(item);
        await this._waitAfterClick();
        if (coordinateAttempt) {
          console.log(`[Executor] Click fallback selector="${item}" after coordinate x=${coordinateAttempt.x}, y=${coordinateAttempt.y}`);
        } else {
          console.log(`[Executor] Click by selector="${item}" (no valid coordinates)`);
        }
        return {
          click_method: coordinateAttempt ? 'selector_fallback' : 'selector',
          selector: item,
          coordinate_attempt: coordinateAttempt,
          fallback_reason: coordinateError?.message || null,
        };
      } catch {
        // Try next selector.
      }
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

  async _executeFile(step) {
    await ensureRememberMeChecked(this.page);

    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const variableKey = String(config.variable_key || '').trim();
    const rawPath = variableKey
      ? this._resolveVariables(`{{${variableKey}}}`)
      : this._resolveVariables(config.text || '');
    if (!rawPath) {
      throw new Error(variableKey
        ? `File step thiếu giá trị cho biến {{${variableKey}}}.`
        : 'File step thiếu biến file hoặc đường dẫn.');
    }
    if (/^C:\\fakepath\\/i.test(rawPath)) {
      throw new Error('Đường dẫn file không hợp lệ (C:\\fakepath). Gán biến type=file trong Variables.');
    }

    const filePaths = String(rawPath)
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!filePaths.length) {
      throw new Error('File step không có file hợp lệ.');
    }

    validateFilePathsForUpload(filePaths, {
      accept: config.accept || anchor.accept || '',
      maxSizeMb: config.max_size_mb,
    });

    const selector = this._resolveSelector(anchor, config);
    const viewport = this._getExecutionViewport();
    const focused = await this._focusTarget(anchor, config, selector);

    if (!focused) {
      const coords = anchor.relative_coords;
      if (coords?.x !== undefined && coords?.y !== undefined) {
        const x = Math.round((coords.x / 100) * viewport.width);
        const y = Math.round((coords.y / 100) * viewport.height);
        await this.page.mouse.click(x, y);
      }
    }

    if (selector) {
      const handle = await this.page.$(selector).catch(() => null);
      if (handle) {
        await handle.uploadFile(...filePaths);
        return;
      }
    }

    const fallbackSelectors = [
      anchor.selector_value,
      anchor.id ? `#${anchor.id}` : '',
      anchor.name ? `[name="${anchor.name}"]` : '',
      anchor.ariaLabel ? `[aria-label="${anchor.ariaLabel}"]` : '',
    ].filter(Boolean);

    for (const item of fallbackSelectors) {
      const handle = await this.page.$(item).catch(() => null);
      if (!handle) continue;
      await handle.uploadFile(...filePaths);
      return;
    }

    throw new Error('Không tìm thấy input file để upload.');
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

    if (this._requestCatchingCapture) {
      await this._requestCatchingCapture.stop().catch(() => {});
      this._requestCatchingCapture = null;
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
  if (
    normalized === 'prepare'
    || normalized === 'crawl'
    || normalized === 'action'
    || normalized === 'request_catching'
  ) {
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

const FILE_EXT_CATEGORY = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
};

function fileMatchesAccept(filePath, acceptRaw) {
  const accept = String(acceptRaw || '').trim();
  if (!accept) return true;

  const ext = path.extname(filePath).toLowerCase();
  const parts = accept.split(',').map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('.')) {
      if (ext === part.toLowerCase()) return true;
      continue;
    }
    if (part.endsWith('/*')) {
      const category = part.slice(0, -2);
      if (FILE_EXT_CATEGORY[ext] === category) return true;
      continue;
    }
    if (part.includes('/')) {
      const extGuess = ext.replace(/^\./, '');
      if (part.endsWith(`/${extGuess}`)) return true;
    }
  }
  return false;
}

function validateFilePathsForUpload(filePaths, { accept, maxSizeMb } = {}) {
  const maxBytes = Number(maxSizeMb) > 0 ? Number(maxSizeMb) * 1024 * 1024 : 0;
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File không tồn tại: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error(`Đường dẫn không phải file: ${filePath}`);
    }
    if (maxBytes && stat.size > maxBytes) {
      throw new Error(`File vượt giới hạn ${Number(maxSizeMb)}MB: ${path.basename(filePath)}`);
    }
    if (!fileMatchesAccept(filePath, accept)) {
      throw new Error(`File không đúng loại (${accept}): ${path.basename(filePath)}`);
    }
  }
}

function randomRuntimeDelay(baseMs = DEFAULT_ACTION_DELAY_MS, minMs = 120, maxMs = 1500) {
  const base = Math.max(1, Number(baseMs) || DEFAULT_ACTION_DELAY_MS);
  const factor = 0.7 + Math.random() * 1.1;
  return Math.round(Math.max(minMs, Math.min(maxMs, base * factor)));
}

function buildExecutionResult({
  success,
  executionId,
  scenario,
  status,
  totalSteps,
  completedSteps,
  failedSteps,
  failedStepIndex = null,
  durationMs,
  startedAt,
  finishedAt,
  stepResults = [],
  error = null,
  browserProfileId = null,
  variableSampleId = null,
  pageUrl = null,
  crawlResults = [],
}) {
  if (isRequestCatchingScenario(scenario)) {
    return buildRequestCatchingExecutionResult(scenario, crawlResults);
  }

  if (isCrawlScenario(scenario)) {
    return buildCrawlExecutionResult(crawlResults, normalizeScenarioResultType(scenario?.result_type));
  }

  return {
    success: Boolean(success),
    status,
    execution_id: executionId,
    scenario_id: scenario?.id || null,
    scenario_name: scenario?.name || null,
    scenario_type: normalizeScenarioType(scenario?.scenario_type),
    result_type: normalizeScenarioResultType(scenario?.result_type),
    browser_profile_id: browserProfileId,
    variable_sample_id: variableSampleId,
    total_steps: totalSteps || 0,
    completed_steps: completedSteps || 0,
    failed_steps: failedSteps || 0,
    failed_step_index: failedStepIndex,
    duration_ms: durationMs || 0,
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    page_url: pageUrl,
    error,
    data: {
      crawl: Array.isArray(crawlResults) ? crawlResults : [],
    },
    steps: stepResults,
  };
}

function isCrawlScenario(scenario) {
  return normalizeScenarioType(scenario?.scenario_type) === 'crawl';
}

function isRequestCatchingScenario(scenario) {
  return normalizeScenarioType(scenario?.scenario_type) === 'request_catching';
}

function buildRequestCatchingExecutionResult(scenario, crawlResults = []) {
  const results = Array.isArray(crawlResults) ? crawlResults : [];
  const rawGraphQlObjects = [];
  const parsedPosts = [];
  let rawObjectCount = 0;

  results.forEach((result) => {
    rawObjectCount += Number(result?.raw_object_count) || 0;

    const crawledItems = Array.isArray(result?.crawledData) ? result.crawledData : [];
    const alreadyParsed = crawledItems.length > 0 && isParsedFacebookPost(crawledItems[0]);

    if (alreadyParsed) {
      parsedPosts.push(...crawledItems);
      return;
    }

    if (Array.isArray(result?.raw_captured)) {
      rawGraphQlObjects.push(...result.raw_captured);
    }

    crawledItems.forEach((item) => {
      if (isParsedFacebookPost(item)) {
        parsedPosts.push(item);
      } else {
        rawGraphQlObjects.push(item);
      }
    });
  });

  const targetUrl = results.map((result) => result?.page_url).find(Boolean)
    || scenario?.target_url
    || '';

  const parsedFromRaw = parseFacebookGraphQLBatch(rawGraphQlObjects, {
    targetUrl,
  });

  const crawledData = mergeParsedFacebookPosts(parsedPosts, parsedFromRaw);

  if (!rawObjectCount) {
    rawObjectCount = rawGraphQlObjects.length || crawledData.length;
  }

  const facebookDbSave = results.map((result) => result?.facebook_db_save).find(Boolean) || null;

  return {
    scenario_type: 'request_catching',
    platform: scenario?.platform || 'facebook',
    capture_count: crawledData.length,
    raw_object_count: rawObjectCount,
    crawledData,
    facebook_db_save: facebookDbSave,
  };
}

function isParsedFacebookPost(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (item.data && typeof item.data === 'object') return false;
  return Boolean(item.post_id || item.post_content || item.post_author);
}

function mergeParsedFacebookPosts(primary = [], secondary = []) {
  const merged = new Map();

  [...primary, ...secondary].forEach((post) => {
    if (!post || typeof post !== 'object') return;
    const key = post.post_id || `story:${String(post.post_content || '').slice(0, 120)}`;
    if (!key || key === 'story:') return;

    if (!merged.has(key)) {
      merged.set(key, { ...post, comments: [...(post.comments || [])] });
      return;
    }

    const existing = merged.get(key);
    if (!existing.post_content && post.post_content) existing.post_content = post.post_content;
    if (!existing.post_author && post.post_author) existing.post_author = post.post_author;
    if (!existing.author_link && post.author_link) existing.author_link = post.author_link;
    if (!existing.post_link && post.post_link) existing.post_link = post.post_link;
    if (!existing.post_date && post.post_date) existing.post_date = post.post_date;
    if (!existing.post_id && post.post_id) existing.post_id = post.post_id;

    const seen = new Set(
      (existing.comments || []).map((comment) => comment.comment_id
        || `${comment.comment_author || ''}::${comment.comment_content || ''}`),
    );
    (post.comments || []).forEach((comment) => {
      const dedupeKey = comment.comment_id
        || `${comment.comment_author || ''}::${comment.comment_content || ''}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      existing.comments.push(comment);
    });
  });

  return Array.from(merged.values());
}

function readFacebookGraphQLFriendlyName(postData = '') {
  const body = String(postData || '');
  if (!body) return '';

  try {
    const params = new URLSearchParams(body);
    return String(
      params.get('fb_api_req_friendly_name')
        || params.get('friendly_name')
        || params.get('operationName')
        || '',
    ).trim();
  } catch {
    const match = body.match(/(?:fb_api_req_friendly_name|friendly_name|operationName)=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
  }
}

function annotateFacebookGraphQLRawObjects(items = [], meta = {}) {
  const friendlyName = readFacebookGraphQLFriendlyName(meta?.postData);
  if (!friendlyName) return Array.isArray(items) ? items : [];

  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    return {
      ...item,
      __request: {
        ...(item.__request || {}),
        friendlyName,
        url: meta?.url || '',
      },
    };
  });
}

function buildCrawlExecutionResult(crawlResults = [], resultType = 'simple') {
  return resultType === 'list'
    ? buildMergedCrawlListResult(crawlResults)
    : buildSampleCardDataDumpResult(crawlResults);
}

function normalizeCrawlCardData(card = {}) {
  const data = card?.data !== undefined ? card.data : card?.html;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data ?? '';
  }

  const keys = Object.keys(data);
  if (keys.length === 1 && (keys[0] === 'text' || keys[0] === 'html')) {
    return data[keys[0]];
  }

  return data;
}

function normalizeCrawlCard(card = {}) {
  const { page_y: _pageY, ...publicCard } = card || {};
  return {
    ...publicCard,
    data: normalizeCrawlCardData(card),
  };
}

function buildSampleCardDataDumpResult(crawlResults = []) {
  const results = Array.isArray(crawlResults) ? crawlResults : [];
  return results.reduce((merged, result, index) => {
    const key = String(result?.widget_label || `widget_${index + 1}`).trim() || `widget_${index + 1}`;
    const cards = result?.sample_dump || result?.cards || [];
    merged[key] = Array.isArray(cards) ? cards.map(normalizeCrawlCard) : [];
    return merged;
  }, {});
}

function buildMergedCrawlListResult(crawlResults = []) {
  const results = Array.isArray(crawlResults) ? crawlResults : [];
  const rows = new Map();

  results.forEach((result, resultIndex) => {
    const label = String(result?.widget_label || `widget_${resultIndex + 1}`).trim() || `widget_${resultIndex + 1}`;
    const cards = result?.sample_dump || result?.cards || [];
    if (!Array.isArray(cards)) return;

    cards.forEach((card, cardIndex) => {
      const rowIndex = Number.isFinite(Number(card?.card_index)) ? Number(card.card_index) : cardIndex;
      const row = rows.get(rowIndex) || {};
      const value = normalizeCrawlCardData(card);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(row, value);
      } else {
        row[label] = value;
      }

      rows.set(rowIndex, row);
    });
  });

  return Array.from(rows.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, row]) => row);
}

function createCrawlCardAccumulator() {
  const seen = new Set();
  const cards = [];

  return {
    cards,
    add(nextCards = []) {
      if (!Array.isArray(nextCards)) return;
      nextCards.forEach((card) => {
        const signature = getCrawlCardSignature(card);
        if (!signature || seen.has(signature)) return;
        seen.add(signature);
        cards.push(card);
      });
    },
  };
}

function getCrawlCardSignature(card = {}) {
  const content = card?.data !== undefined
    ? card.data
    : (card?.html !== undefined ? card.html : card);
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const strongKey = content.permalink
      || content.link
      || content.href
      || content.url
      || content.post_title
      || content.title
      || content.keyword;
    if (strongKey) return `strong:${String(strongKey).trim()}`;
  }
  if (Number.isFinite(Number(card?.page_y))) {
    return `page_y:${Math.round(Number(card.page_y))}`;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content || '');
  }
}

function getCrawlMeta(meta = {}) {
  const crawl = meta?.crawl || {};
  return {
    autoscroll: {
      enabled: Boolean(crawl.autoscroll?.enabled),
      distance_px: Number(crawl.autoscroll?.distance_px) || 600,
      delay_ms: Number(crawl.autoscroll?.delay_ms) || 500,
    },
    infinity_scroll: {
      enabled: Boolean(crawl.infinity_scroll?.enabled),
      stop_mode: crawl.infinity_scroll?.stop_mode === 'condition' ? 'condition' : 'timeout',
      timeout_ms: Number(crawl.infinity_scroll?.timeout_ms) || 30000,
      max_scrolls: Number(crawl.infinity_scroll?.max_scrolls) || 30,
      condition: {
        field: String(crawl.infinity_scroll?.condition?.field || '').trim(),
        operator: crawl.infinity_scroll?.condition?.operator || '<',
        value: crawl.infinity_scroll?.condition?.value ?? '',
      },
    },
  };
}

const SCENARIO_RESULT_TYPES = new Set(['simple', 'list']);

function normalizeScenarioResultType(value) {
  const normalized = String(value || 'simple').trim().toLowerCase();
  return SCENARIO_RESULT_TYPES.has(normalized) ? normalized : 'simple';
}

function decodeHtmlScriptJson(text = '') {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hasFacebookPostStateNode(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 28) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasFacebookPostStateNode(item, depth + 1));
  }

  const typename = String(value.__typename || value.__isNode || value.__isStory || '');
  if (/^(Story|GroupPostStory)$|Story$/i.test(typename)) return true;
  if (/CometModernPost|CometSinglePost|CometPermalink/i.test(typename)) return true;
  if (value.story && typeof value.story === 'object' && hasFacebookPostStateNode(value.story, depth + 1)) {
    return true;
  }
  if (value.comet_sections && typeof value.comet_sections === 'object' && (
    Array.isArray(value.actors)
    || value.feedback
    || value.creation_time
    || value.post_id
    || value.id
  )) {
    return true;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/CometModernPost|CometSinglePost|CometPermalink/i.test(key)) return true;
    if (!child || typeof child !== 'object') continue;
    if (hasFacebookPostStateNode(child, depth + 1)) return true;
  }
  return false;
}

function isFacebookUnavailableContentHtml(html = '') {
  const text = decodeHtmlScriptJson(html).replace(/\s+/g, ' ');
  return [
    /B[aạ]n hi[eệ]n kh[oô]ng xem [đd][uư][oợ]c n[oộ]i dung n[aà]y/i,
    /This content isn['’]t available right now/i,
    /L[oỗ]i n[aà]y th[uư][oờ]ng do ch[uủ] s[oở] h[uữ]u/i,
    /content isn't available/i,
  ].some((pattern) => pattern.test(text));
}

function resolveFacebookTargetPostId(options = {}, currentUrl = '') {
  const fromVariables = String(options.variables?.get?.('post_id') || '').trim();
  if (fromVariables) return fromVariables;

  const fromTargetUrl = parseFacebookPostLink(options.targetUrl || '').post_id;
  if (fromTargetUrl) return String(fromTargetUrl).trim();

  return String(parseFacebookPostLink(currentUrl || '').post_id || '').trim();
}

function candidateContainsTargetPostId(candidate, targetPostId = '', rawText = '') {
  const id = String(targetPostId || '').trim();
  if (!id) return false;
  if (String(rawText || '').includes(id)) return true;

  try {
    return JSON.stringify(candidate).includes(id);
  } catch {
    return false;
  }
}

function pushFacebookInitialStateCandidate(items, seen, candidate, meta = {}) {
  if (!candidate || typeof candidate !== 'object') return;
  if (!candidateContainsTargetPostId(candidate, meta.targetPostId, meta.rawText)) return;
  if (!hasFacebookPostStateNode(candidate)) return;

  try {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return;
    seen.add(key);
  } catch {
    // If a large object cannot be stringified, still let the parser try it once.
  }

  const item = Array.isArray(candidate) ? [...candidate] : { ...candidate };
  item.__request = {
    friendlyName: 'FacebookInitialStateJson',
    source: 'initial_state_json',
    targetUrl: meta.targetUrl || '',
    targetPostId: meta.targetPostId || '',
    targetGroupId: meta.targetGroupId || '',
  };
  items.push(item);
}

function extractBalancedJsonStrings(source = '', maxCandidates = 80) {
  const text = String(source || '');
  const candidates = [];
  const stack = [];
  let start = -1;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{' || char === '[') {
      if (!stack.length) start = index;
      stack.push(char);
      continue;
    }

    if (char !== '}' && char !== ']') continue;
    if (!stack.length) continue;

    const open = stack[stack.length - 1];
    if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) {
      stack.length = 0;
      start = -1;
      continue;
    }

    stack.pop();
    if (!stack.length && start >= 0) {
      candidates.push(text.slice(start, index + 1));
      if (candidates.length >= maxCandidates) break;
      start = -1;
    }
  }

  return candidates;
}

function tryParseFacebookJsonCandidate(text) {
  try {
    return JSON.parse(decodeHtmlScriptJson(text).trim());
  } catch {
    return null;
  }
}

async function extractFacebookInitialStateJson(page, options = {}) {
  if (!page || page.isClosed()) {
    return [];
  }

  try {
    const html = await page.content();
    if (isFacebookUnavailableContentHtml(html)) {
      console.error('[Executor] Bài viết không tồn tại hoặc bị giới hạn quyền');
      throw new Error('Bài viết không tồn tại hoặc bị giới hạn quyền');
    }

    const items = [];
    const seen = new Set();
    const currentUrl = page && !page.isClosed() ? page.url() : '';
    const targetPostId = resolveFacebookTargetPostId(options, currentUrl);
    const meta = {
      targetUrl: options.targetUrl || '',
      targetPostId,
      targetGroupId: String(options.variables?.get?.('group_id') || parseFacebookPostLink(options.targetUrl || '').group_id || '').trim(),
    };

    if (!targetPostId) {
      console.warn('[Executor] Initial state JSON skipped because target_post_id is missing');
      return [];
    }

    const jsonScriptPattern = /<script\b(?=[^>]*\btype=["']application\/json["'])(?=[^>]*\bdata-sjs\b)[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(jsonScriptPattern)) {
      try {
        const rawText = match?.[1] || '';
        if (!candidateContainsTargetPostId(null, targetPostId, rawText)) continue;
        const parsed = tryParseFacebookJsonCandidate(rawText);
        pushFacebookInitialStateCandidate(items, seen, parsed, { ...meta, rawText });
      } catch (error) {
        console.warn('[Executor] Initial state JSON script parse skipped:', error?.message || error);
      }
    }

    const relayScriptPattern = /<script\b[^>]*>([\s\S]*?requireLazy\(\s*\[\s*["']RelayModern["'][\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(relayScriptPattern)) {
      const scriptText = match?.[1] || '';
      if (!/CometModernPost|CometSinglePost|CometPermalink|__typename["']?\s*:\s*["'](?:\w*Story|Story)["']/i.test(scriptText)) {
        continue;
      }
      try {
        extractBalancedJsonStrings(scriptText).forEach((candidateText) => {
          if (!candidateContainsTargetPostId(null, targetPostId, candidateText)) return;
          const parsed = tryParseFacebookJsonCandidate(candidateText);
          pushFacebookInitialStateCandidate(items, seen, parsed, { ...meta, rawText: candidateText });
        });
      } catch (error) {
        console.warn('[Executor] RelayModern initial state parse skipped:', error?.message || error);
      }
    }

    return items;
  } catch (error) {
    if (error?.message === 'Bài viết không tồn tại hoặc bị giới hạn quyền') {
      throw error;
    }
    console.warn('[Executor] Initial state JSON extraction failed:', error?.message || error);
    return [];
  }
}

function resolveFacebookPostLimit(value = '') {
  const limit = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}

function addFacebookPostIds(targetSet, parsedPosts = []) {
  if (!(targetSet instanceof Set) || !Array.isArray(parsedPosts)) return;
  parsedPosts.forEach((post) => {
    const postId = String(post?.post_id || '').trim();
    if (
      postId
      && post?._comments_only !== true
      && post?._feedback_only !== true
    ) {
      targetSet.add(postId);
    }
  });
}

async function readFacebookGroupMeta(page) {
  const fallback = { groupName: '', groupType: 'Private' };
  if (!page || page.isClosed()) return fallback;

  try {
    const rawTitle = await page.title().catch(() => '');
    const groupName = normalizeFacebookGroupTitle(String(rawTitle || '').split('|')[0]);
    const html = await page.content().catch(() => '');
    const groupType = detectFacebookGroupTypeFromHtml(html);

    return {
      groupName,
      groupType,
    };
  } catch (error) {
    console.warn('[Executor] Facebook group meta detect failed:', error?.message || error);
    return fallback;
  }
}

function normalizeFacebookGroupTitle(value = '') {
  return String(value || '')
    .replace(/\s+-\s+Facebook\s*$/i, '')
    .replace(/^Facebook\s*$/i, '')
    .trim();
}

function detectFacebookGroupTypeFromHtml(html = '') {
  const source = String(html || '');
  if (!source) return 'Private';

  const privatePattern = /"privacy"\s*:\s*"MembersOnly"|"is_group_privacy_private"\s*:\s*true|\bPrivate group\b|Nhóm kín/iu;
  const publicPattern = /"privacy"\s*:\s*"Open"|"is_group_privacy_private"\s*:\s*false|\bPublic group\b|Nhóm công khai/iu;

  if (privatePattern.test(source)) return 'Private';
  if (publicPattern.test(source)) return 'Public';
  return 'Private';
}

function mergeSinglePostParsedResults(parsedPosts = [], options = {}) {
  const posts = Array.isArray(parsedPosts) ? parsedPosts : [];
  const targetPostId = String(options.postId || '').trim();
  if (!targetPostId) return posts;

  const base = posts.find((post) => (
    String(post?.post_id || '') === targetPostId
    && post._comments_only !== true
    && post._feedback_only !== true
  ));
  if (!base) return posts;

  const seen = new Set((base.comments || []).map((comment) => (
    comment.comment_id || `${comment.comment_author || ''}::${comment.comment_content || ''}`
  )));
  posts.forEach((post) => {
    if (post === base || !Array.isArray(post?.comments)) return;
    post.comments.forEach((comment) => {
      const key = comment.comment_id || `${comment.comment_author || ''}::${comment.comment_content || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      base.comments.push(comment);
    });
  });
  base.comment_count = Math.max(Number(base.comment_count) || 0, base.comments.length);
  if (!base.group_id && options.groupId) base.group_id = options.groupId;
  if (!base.post_link && options.targetUrl) base.post_link = options.targetUrl;
  delete base._comments_only;
  delete base._feedback_only;

  return [
    base,
    ...posts.filter((post) => (
      post !== base
      && post._comments_only !== true
      && post._feedback_only !== true
      && String(post?.post_id || '') !== targetPostId
    )),
  ];
}

export { ExecutorService };
