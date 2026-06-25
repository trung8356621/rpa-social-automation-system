import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ExecutorService {
  constructor({ dbService, sendTelemetry, cacheRoot } = {}) {
    if (!dbService) {
      throw new Error('[Executor] dbService is required.');
    }

    this.dbService = dbService;
    this.sendTelemetry = sendTelemetry || (() => {});
    this.cacheRoot = cacheRoot || path.join(__dirname, '..', '..', '..', 'cache');
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.currentScenario = null;
  }

  async startScenario(scenarioId, options = {}) {
    if (this.isRunning) {
      throw new Error('[Executor] Dang co tien trinh thuc thi dang chay.');
    }

    this.isRunning = true;
    const executionId = options.executionId || crypto.randomUUID();
    const startTime = Date.now();

    try {
      const scenario = this.dbService.getScenarioById(scenarioId);
      if (!scenario) {
        throw new Error(`[Executor] Khong tim thay scenario: ${scenarioId}`);
      }
      if (!scenario.steps || scenario.steps.length === 0) {
        throw new Error('[Executor] Kich ban chua co buoc nao. Hay Record truoc khi Play.');
      }

      this.currentScenario = scenario;
      this._sendTelemetry({
        type: 'execution:started',
        executionId,
        scenarioId,
        scenarioName: scenario.name,
        totalSteps: scenario.steps.length,
        timestamp: new Date().toISOString(),
      });

      await this._launchBrowser(scenario, options);

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

        await this._executeStep(step, stepIndex);

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

      const durationMs = Date.now() - startTime;
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
      this._sendTelemetry({
        type: 'execution:failed',
        executionId,
        scenarioId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      await this._cleanupBrowser();
      this.isRunning = false;
      this.currentScenario = null;
    }
  }

  async _launchBrowser(scenario, options) {
    const viewport = options.viewport || {
      width: scenario.recorded_width || 1280,
      height: scenario.recorded_height || 720,
    };

    const errorsDir = path.join(this.cacheRoot, 'errors');
    if (!fs.existsSync(errorsDir)) {
      fs.mkdirSync(errorsDir, { recursive: true });
    }

    this.browser = await puppeteer.launch({
      headless: false,
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

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(60000);
    await this.page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: scenario.device_pixel_ratio || 1,
    });
  }

  async _executeStep(step, stepIndex) {
    const delayMs = Math.max(0, Number(step.delay_ms) || 0);
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
      case 'type':
      case 'keypress':
        await this._executeType(step);
        break;
      case 'scroll':
        await this._executeScroll(step);
        break;
      case 'wait':
        await this._sleep(Number(step.target_anchor?.action_config?.duration || step.delay_ms || 1000));
        break;
      default:
        console.warn(`[Executor] Unsupported action type at step ${stepIndex}: ${step.action_type}`);
        break;
    }
  }

  async _executeNavigate(step) {
    const url = step.target_anchor?.action_config?.url || step.target_url || this.currentScenario?.target_url;
    if (!url) return;

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  }

  async _executeClick(step) {
    const anchor = step.target_anchor || {};
    const coords = anchor.relative_coords;

    if (coords?.x !== undefined && coords?.y !== undefined) {
      const viewport = this.page.viewport();
      const x = Math.round((coords.x / 100) * viewport.width);
      const y = Math.round((coords.y / 100) * viewport.height);
      await this.page.mouse.move(x, y, { steps: 5 });
      await this.page.mouse.click(x, y, { button: 'left' });
      return;
    }

    const focused = await this._focusBySelectorOrAnchor(anchor);
    if (!focused) {
      throw new Error('Click step khong co toa do hoac target hop le.');
    }
    await this.page.keyboard.press('Enter');
  }

  async _executeType(step) {
    const anchor = step.target_anchor || {};
    const config = anchor.action_config || {};
    const text = this._resolveVariables(config.text || step.key || '');

    if (!text) return;

    const focused = await this._focusBySelectorOrAnchor(anchor);
    if (!focused) {
      throw new Error('Khong tim thay input de nhap text.');
    }

    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('A');
    await this.page.keyboard.up('Control');
    await this.page.keyboard.type(text, { delay: config.delay || 50 });
  }

  _resolveVariables(value) {
    if (!value || !this.currentScenario?.id) return value;

    const variables = this.dbService.getScenarioVariables(this.currentScenario.id);
    const variableMap = new Map(variables.map((item) => [item.name, item.value || '']));

    return String(value).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name) => (
      variableMap.has(name) ? variableMap.get(name) : match
    ));
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

  async _focusBySelectorOrAnchor(anchor) {
    const selector = anchor?.selector_value || anchor?.action_config?.selector;
    if (selector) {
      try {
        await this.page.waitForSelector(selector, { timeout: 5000 });
        await this.page.focus(selector);
        return true;
      } catch {
        // Try semantic anchors next.
      }
    }

    return this._focusByAnchor(anchor);
  }

  async _focusByAnchor(anchor = {}) {
    const selectors = [];
    if (anchor.testId) selectors.push(`[data-testid="${anchor.testId}"]`);
    if (anchor.id) selectors.push(`#${anchor.id}`);
    if (anchor.name) selectors.push(`[name="${anchor.name}"]`);
    if (anchor.ariaLabel) selectors.push(`[aria-label="${anchor.ariaLabel}"]`);
    if (anchor.placeholder) selectors.push(`[placeholder="${anchor.placeholder}"]`);
    if (anchor.title) selectors.push(`[title="${anchor.title}"]`);

    for (const selector of selectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 2000 });
        await this.page.focus(selector);
        return true;
      } catch {
        // Continue.
      }
    }

    if (anchor.xpath) {
      try {
        return await this.page.evaluate((xpath) => {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const element = result.singleNodeValue;
          if (!element) return false;
          element.focus();
          return true;
        }, anchor.xpath);
      } catch {
        // Ignore invalid xpath.
      }
    }

    return false;
  }

  async cancelExecution() {
    this.isRunning = false;
    await this._cleanupBrowser();
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

  async _cleanupBrowser() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch {
      // Ignore cleanup failures.
    }

    try {
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
      }
    } catch {
      // Ignore cleanup failures.
    }

    this.page = null;
    this.browser = null;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let executorInstance = null;

function initExecutorService({ dbService, mainWindow, cacheRoot } = {}) {
  if (!executorInstance) {
    executorInstance = new ExecutorService({
      dbService,
      sendTelemetry: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rpa:execution-status', payload);
        }
      },
      cacheRoot,
    });
  }
  return executorInstance;
}

function getExecutorService() {
  if (!executorInstance) {
    throw new Error('[Executor] ExecutorService is not initialized.');
  }
  return executorInstance;
}

export { ExecutorService, initExecutorService, getExecutorService };
