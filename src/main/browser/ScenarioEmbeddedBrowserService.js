import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserView, session } from 'electron';
import { resolveScenarioTargetUrl } from '../rpa/VariableResolver.js';
import {
  getClearHighlightScript,
  getDesignModeActivateScript,
  getDesignModeDeactivateScript,
  getDesignModeInjectionScript,
  getHighlightAnchorScript,
  getPromoteToParentScript,
} from '../rpa/DesignModeScript.js';
import { getCrawlExtractionScript } from '../rpa/CardExtractorScript.js';
import { buildPreviewPartition, invalidateProfileCookieCache, syncProfileCookiesToSession } from './ProfileCookieSync.js';
import { RequestCatchingPreviewBridge } from './RequestCatchingPreviewBridge.js';
import { RequestCatchingDumpService } from '../rpa/RequestCatchingDumpService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CRAWL_DESIGN_PRELOAD = path.join(__dirname, '..', '..', 'preload', 'crawl-design-preload.cjs');

class ScenarioEmbeddedBrowserService {
  constructor({ getMainWindow, dbService, browserProfileService } = {}) {
    this.getMainWindow = getMainWindow;
    this.dbService = dbService;
    this.browserProfileService = browserProfileService || null;
    this.view = null;
    this.sessionKey = null;
    this.userDataDir = null;
    this.partition = null;
    this.lastBounds = null;
    this.resizeHandler = null;
    this.designModeEnabled = false;
    this.designParentAnchor = null;
    this.zoomFactor = 1;
    this._pageLoading = false;
    this._didFinishLoadHandler = null;
    this._keyboardInputHandler = null;
    this._onStartLoading = null;
    this._onStopLoading = null;
    this.requestCatchingBridge = new RequestCatchingPreviewBridge();
    this.requestCatchingAutoConfig = null;
    this._requestCatchingPageUrl = '';
    this._onRequestCatchingNavigateHandler = null;
  }

  _normalizePreviewUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '') || '';
  }

  _emitRequestCatchingReset(url = '') {
    const win = this._getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('request-catching:reset', {
        url: url || '',
        timestamp: new Date().toISOString(),
      });
    }
  }

  _getWindow() {
    const win = this.getMainWindow?.();
    if (!win || win.isDestroyed()) return null;
    return win;
  }

  _resolveUrl(rawUrl, scenarioId) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return 'about:blank';

    if (scenarioId && this.dbService) {
      const variableMap = this.dbService.buildVariableMap(scenarioId, null);
      return resolveScenarioTargetUrl(trimmed, variableMap) || trimmed;
    }

    return trimmed;
  }

  _resolveUserDataDir(scenarioId, browserProfileId) {
    if (!this.browserProfileService) return null;

    try {
      return this.browserProfileService.resolveSessionUserDataDir(
        scenarioId || 'draft',
        browserProfileId || null,
      );
    } catch {
      return null;
    }
  }

  _buildSessionKey(userDataDir, scenarioId, browserProfileId) {
    if (userDataDir) return userDataDir;
    return `${scenarioId || 'draft'}:${browserProfileId || 'guest'}`;
  }

  async _syncSessionCookies(partition, userDataDir) {
    if (!userDataDir) return { synced: 0, cached: false };

    const electronSession = session.fromPartition(partition);
    return syncProfileCookiesToSession(electronSession, userDataDir);
  }

  _setupNavigationHooks() {
    if (!this.view) return;

    if (!this._didFinishLoadHandler) {
      this._didFinishLoadHandler = async () => {
        await this._injectDesignMode();
        if (this.designModeEnabled) {
          await this._applyDesignModeState();
        }
        await this._handleRequestCatchingPageReady();
      };
      this.view.webContents.on('did-finish-load', this._didFinishLoadHandler);
    }

    if (!this._onRequestCatchingNavigateHandler) {
      this._onRequestCatchingNavigateHandler = (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame === false) return;
        void this._handleRequestCatchingNavigationStart(_url);
      };
      this.view.webContents.on('did-start-navigation', this._onRequestCatchingNavigateHandler);
    }
  }

  async _handleRequestCatchingNavigationStart(nextUrl) {
    if (!this.requestCatchingAutoConfig?.enabled || !this.view) return;

    const normalized = this._normalizePreviewUrl(nextUrl);
    if (!normalized || normalized === 'about:blank') return;

    this._requestCatchingPageUrl = normalized;
    this.requestCatchingAutoConfig.paused = false;
    await this.requestCatchingBridge.stop(this.view.webContents);
    this._emitRequestCatchingReset(normalized);
  }

  async _handleRequestCatchingPageReady() {
    const cfg = this.requestCatchingAutoConfig;
    console.log('[RC] _handleRequestCatchingPageReady called, cfg=', cfg?.enabled, 'paused=', cfg?.paused, 'view=', Boolean(this.view));
    if (!cfg?.enabled || cfg?.paused || !this.view) return;

    const pageUrl = this.view.webContents.getURL() || '';
    const normalized = this._normalizePreviewUrl(pageUrl);
    console.log('[RC] page url=', normalized);
    if (!normalized || normalized === 'about:blank') return;

    this._requestCatchingPageUrl = normalized;

    try {
      await this.startRequestCatching({
        listenOnly: true,
        platform: cfg.platform,
        scenarioId: cfg.scenarioId,
        crawlMeta: cfg.crawlMeta,
        requestCatchingFilters: cfg.requestCatchingFilters || {},
      });
    } catch (error) {
      console.warn('[RC] auto-start failed:', error.message);
    }
  }

  async setRequestCatchingAuto(payload = {}) {
    console.log('[RC] setRequestCatchingAuto', payload);
    if (!payload.enabled) {
      this.requestCatchingAutoConfig = null;
      this._requestCatchingPageUrl = '';
      await this.stopRequestCatching();
      return { enabled: false };
    }

    this.requestCatchingAutoConfig = {
      enabled: true,
      paused: Boolean(payload.paused),
      platform: payload.platform || 'facebook',
      scenarioId: payload.scenarioId || null,
      crawlMeta: payload.crawlMeta || {},
      requestCatchingFilters: payload.requestCatchingFilters || {},
    };

    if (this.requestCatchingAutoConfig.paused) {
      await this.stopRequestCatching();
      return { enabled: true, paused: true, platform: this.requestCatchingAutoConfig.platform };
    }

    if (this.view && !this.view.webContents.isDestroyed()) {
      this._setupNavigationHooks();
      const isLoading = this.view.webContents.isLoading();
      console.log('[RC] view exists, isLoading=', isLoading);
      // Always try to start — bridge.start() is idempotent for the same webContents.
      // If page is loading, did-finish-load will trigger _handleRequestCatchingPageReady.
      // If page is already loaded, start immediately.
      await this._handleRequestCatchingPageReady();
    } else {
      console.log('[RC] view not ready yet — will auto-start on did-finish-load');
    }

    return { enabled: true, platform: this.requestCatchingAutoConfig.platform };
  }

  _setupLoadingStateHooks() {
    if (!this.view || this._onStartLoading) return;

    const { webContents } = this.view;
    this._pageLoading = webContents.isLoading();

    this._onStartLoading = () => {
      this._pageLoading = true;
    };
    this._onStopLoading = () => {
      this._pageLoading = false;
    };

    webContents.on('did-start-loading', this._onStartLoading);
    webContents.on('did-stop-loading', this._onStopLoading);
  }

  _teardownLoadingStateHooks() {
    if (!this.view) return;

    const { webContents } = this.view;
    if (this._onStartLoading) {
      webContents.removeListener('did-start-loading', this._onStartLoading);
      this._onStartLoading = null;
    }
    if (this._onStopLoading) {
      webContents.removeListener('did-stop-loading', this._onStopLoading);
      this._onStopLoading = null;
    }
    this._pageLoading = false;
  }

  _waitForMainFrameReady(webContents, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!webContents || webContents.isDestroyed()) {
        resolve(false);
        return;
      }
      if (!webContents.isLoading()) {
        resolve(true);
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        webContents.removeListener('did-finish-load', onLoad);
        webContents.removeListener('did-stop-loading', onStop);
        resolve(true);
      };

      const onLoad = () => finish();
      const onStop = () => {
        if (!webContents.isLoading()) finish();
      };
      const timer = setTimeout(finish, timeoutMs);

      webContents.once('did-finish-load', onLoad);
      webContents.once('did-stop-loading', onStop);
    });
  }

  _setupKeyboardHooks() {
    if (!this.view || this._keyboardInputHandler) return;

    this._keyboardInputHandler = (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
      const key = String(input.key || '').toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        const win = this._getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('crawl:open-find-bar');
        }
        return;
      }
      if (key === '-' || key === '_') {
        event.preventDefault();
        this.zoomOut();
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        this.zoomIn();
        return;
      }
      if (key === '0') {
        event.preventDefault();
        this.setZoomFactor(1);
      }
    };
    this.view.webContents.on('before-input-event', this._keyboardInputHandler);
  }

  setZoomFactor(factor) {
    if (!this.view) {
      return { zoomFactor: this.zoomFactor, attached: false };
    }

    this.zoomFactor = Math.min(3, Math.max(0.5, Math.round(Number(factor) * 100) / 100));
    this.view.webContents.setZoomFactor(this.zoomFactor);
    const state = { zoomFactor: this.zoomFactor, attached: true };
    const win = this._getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('crawl:preview-state', this.getState());
    }
    return state;
  }

  zoomIn() {
    return this.setZoomFactor(this.zoomFactor + 0.1);
  }

  zoomOut() {
    return this.setZoomFactor(this.zoomFactor - 0.1);
  }

  async findInPage(text, options = {}) {
    if (!this.view) {
      return { matches: 0, activeMatchOrdinal: 0, attached: false };
    }

    const query = String(text || '').trim();
    if (!query) {
      this.stopFindInPage();
      return { matches: 0, activeMatchOrdinal: 0, attached: true };
    }

    const forward = options.forward !== false;
    const findNext = Boolean(options.findNext);

    return new Promise((resolve) => {
      const { webContents } = this.view;
      const onFound = (_event, result) => {
        if (!result.finalUpdate) return;
        webContents.removeListener('found-in-page', onFound);
        resolve({
          matches: result.matches,
          activeMatchOrdinal: result.activeMatchOrdinal,
          attached: true,
        });
      };
      webContents.on('found-in-page', onFound);
      webContents.findInPage(query, { forward, findNext, matchCase: false });
    });
  }

  stopFindInPage() {
    if (!this.view) {
      return { stopped: false, attached: false };
    }
    this.view.webContents.stopFindInPage('clearSelection');
    return { stopped: true, attached: true };
  }

  async _injectDesignMode() {
    if (!this.view) return false;
    const { webContents } = this.view;

    await this._waitForMainFrameReady(webContents);

    try {
      const alreadyReady = await webContents.executeJavaScript(
        'Boolean(window.__rpaDesignPromoteToParent && window.__rpaDesignHighlightAnchor && window.__rpaDesignSetActive)',
      );
      if (alreadyReady) return true;

      await webContents.executeJavaScript(getDesignModeInjectionScript());
      return webContents.executeJavaScript(
        'Boolean(window.__rpaDesignPromoteToParent && window.__rpaDesignHighlightAnchor && window.__rpaDesignSetActive)',
      );
    } catch (error) {
      console.warn('[EmbeddedBrowser] Design mode inject failed:', error.message);
      return false;
    }
  }

  async _applyDesignModeState() {
    if (!this.view) return;
    const script = this.designModeEnabled
      ? getDesignModeActivateScript(this.designParentAnchor)
      : getDesignModeDeactivateScript();
    try {
      await this.view.webContents.executeJavaScript(script);
    } catch {
      // Ignore pages that block script execution.
    }
  }

  async attach(payload = {}) {
    const win = this._getWindow();
    if (!win) {
      throw new Error('Main window is not available');
    }

    const userDataDir = this._resolveUserDataDir(payload.scenarioId, payload.browserProfileId);
    const sessionKey = this._buildSessionKey(userDataDir, payload.scenarioId, payload.browserProfileId);
    const partition = userDataDir
      ? buildPreviewPartition(userDataDir)
      : `persist:rpa-preview-${sessionKey.replace(/[^a-zA-Z0-9:_-]/g, '-')}`;
    const url = this._resolveUrl(payload.url, payload.scenarioId);
    const bounds = payload.bounds || this.lastBounds;

    if (this.view && this.sessionKey === sessionKey) {
      if (bounds) this.setBounds(bounds);
      await this._syncSessionCookies(partition, userDataDir);
      const currentUrl = this.view.webContents.getURL() || '';
      if (url && url !== 'about:blank' && url !== currentUrl) {
        await this.navigate({ url, scenarioId: payload.scenarioId });
      }
      if (this.designModeEnabled) {
        void this._injectDesignMode().then(() => this._applyDesignModeState());
      }
      this._setupKeyboardHooks();
      // If request-catching auto is configured and page is ready, ensure bridge is started.
      if (this.requestCatchingAutoConfig?.enabled && !this.view.webContents.isLoading()) {
        void this._handleRequestCatchingPageReady();
      }
      return this.getState();
    }

    this.detach();

    this.sessionKey = sessionKey;
    this.userDataDir = userDataDir;
    this.partition = partition;
    this._designPickBound = false;

    this.view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition,
        preload: CRAWL_DESIGN_PRELOAD,
      },
    });

    win.addBrowserView(this.view);
    if (bounds) this.setBounds(bounds);

    this.resizeHandler = () => {
      if (this.lastBounds) this.setBounds(this.lastBounds);
    };
    win.on('resize', this.resizeHandler);

    this._setupNavigationHooks();
    this._setupLoadingStateHooks();
    this._setupKeyboardHooks();

    await this._syncSessionCookies(partition, userDataDir);
    await this.view.webContents.loadURL(url);

    void this._injectDesignMode().then(() => {
      if (this.designModeEnabled) {
        return this._applyDesignModeState();
      }
      return undefined;
    });

    // did-finish-load also triggers this, but call explicitly when page is already idle.
    if (this.requestCatchingAutoConfig?.enabled && !this.view.webContents.isLoading()) {
      void this._handleRequestCatchingPageReady();
    }

    return this.getState();
  }

  async highlightAnchor(anchor = null) {
    if (!this.view) {
      return { found: false, matchCount: 0, attached: false };
    }

    await this._injectDesignMode();
    try {
      const result = await this.view.webContents.executeJavaScript(getHighlightAnchorScript(anchor));
      return { ...(result || {}), attached: true };
    } catch (error) {
      return { found: false, matchCount: 0, attached: true, error: error.message };
    }
  }

  async clearHighlight() {
    if (!this.view) {
      return { cleared: false, attached: false };
    }

    await this._injectDesignMode();
    try {
      const result = await this.view.webContents.executeJavaScript(getClearHighlightScript());
      return { ...(result || {}), attached: true };
    } catch (error) {
      return { cleared: false, attached: true, error: error.message };
    }
  }

  async extractCrawlSample(anchor = null, maxCards = 100) {
    if (!this.view) {
      return { ok: false, error: 'not_attached' };
    }

    try {
      const result = await this.view.webContents.executeJavaScript(getCrawlExtractionScript(anchor || {}, maxCards));
      return result || { ok: false, error: 'empty_result' };
    } catch (error) {
      return { ok: false, error: 'crawl_extract_failed', message: error.message };
    }
  }

  async promoteSelectorToParent(anchor = null) {
    if (!this.view) {
      return { error: 'not_attached' };
    }

    const ready = await this._injectDesignMode();
    if (!ready) {
      return { error: 'design_script_not_ready' };
    }

    try {
      const result = await this.view.webContents.executeJavaScript(getPromoteToParentScript(anchor));
      return result || { error: 'empty_result' };
    } catch (error) {
      return { error: 'promote_failed', message: error.message };
    }
  }

  async setDesignMode(enabled, pickContext = {}) {
    this.designModeEnabled = Boolean(enabled);
    this.designParentAnchor = pickContext?.parentAnchor || null;

    if (!this.view) {
      return { designMode: this.designModeEnabled };
    }

    await this._injectDesignMode();
    await this._applyDesignModeState();
    return { designMode: this.designModeEnabled };
  }

  openDevTools() {
    if (!this.view) return { opened: false };
    this.view.webContents.openDevTools({ mode: 'detach' });
    return { opened: true };
  }

  async startRequestCatching(payload = {}) {
    if (!this.view) {
      throw new Error('Embedded browser is not attached');
    }

    const platform = payload.platform
      || this.requestCatchingAutoConfig?.platform
      || 'facebook';
    const listenOnly = payload.listenOnly === true;
    const win = this._getWindow();

    const result = await this.requestCatchingBridge.start(
      this.view.webContents,
      platform,
      {
        customFilters: payload.requestCatchingFilters
          || this.requestCatchingAutoConfig?.requestCatchingFilters
          || {},
        onDiscover: async (record) => {
          if (!win || win.isDestroyed()) return;
          const scenarioId = payload.scenarioId
            || this.requestCatchingAutoConfig?.scenarioId
            || null;
          if (scenarioId) {
            try {
              await RequestCatchingDumpService.appendDiscovered(scenarioId, record);
            } catch {
              // Disk write failure should not block live preview.
            }
          }
          if (!win.isDestroyed()) {
            win.webContents.send('request-catching:discovered', {
              ...record,
              timestamp: record.timestamp || new Date().toISOString(),
            });
          }
        },
        onCapture: async (items, meta) => {
          if (!win || win.isDestroyed()) return;
          const scenarioId = payload.scenarioId
            || this.requestCatchingAutoConfig?.scenarioId
            || null;
          if (scenarioId) {
            try {
              await RequestCatchingDumpService.appendCaptured(scenarioId, items);
            } catch {
              // Disk write failure should not block live preview.
            }
          }
          if (!win.isDestroyed()) {
            win.webContents.send('request-catching:captured', {
              items,
              url: meta?.url || '',
              itemCount: meta?.itemCount || items.length,
              label: meta?.label || '',
              timestamp: new Date().toISOString(),
            });
          }
        },
      },
    );

    if (!listenOnly && payload.url) {
      const targetUrl = this._resolveUrl(payload.url, payload.scenarioId);
      const currentUrl = this._normalizePreviewUrl(this.view.webContents.getURL());
      const normalizedTarget = this._normalizePreviewUrl(targetUrl);

      if (normalizedTarget && currentUrl === normalizedTarget) {
        await this.reload();
      } else {
        await this.navigate({
          url: payload.url,
          scenarioId: payload.scenarioId,
        });
      }
    }

    await this._runPreviewAutoscroll(
      payload.crawlMeta || this.requestCatchingAutoConfig?.crawlMeta || {},
    );

    return {
      ...result,
      attached: true,
    };
  }

  async _runPreviewAutoscroll(crawlMeta = {}) {
    if (!this.view) return;

    const autoscroll = crawlMeta.autoscroll || {};
    const infinite = crawlMeta.infinity_scroll || {};
    const shouldScroll = autoscroll.enabled || infinite.enabled;
    if (!shouldScroll) return;

    const scrollDistance = Math.max(100, Number(autoscroll.distance_px) || 600);
    const scrollDelay = Math.max(100, Number(autoscroll.delay_ms) || 500);
    const maxScrolls = infinite.enabled
      ? Math.max(1, Math.min(30, Number(infinite.max_scrolls) || 10))
      : 5;
    const timeoutMs = Math.max(1000, Number(infinite.timeout_ms) || 30000);
    const startedAt = Date.now();

    const { webContents } = this.view;
    await webContents.executeJavaScript('window.scrollTo(0, 0)').catch(() => {});
    await new Promise((resolve) => { setTimeout(resolve, scrollDelay); });

    for (let index = 0; index < maxScrolls; index += 1) {
      if (infinite.enabled && Date.now() - startedAt >= timeoutMs) break;

      await webContents.executeJavaScript(`window.scrollBy(0, ${scrollDistance})`).catch(() => {});
      await new Promise((resolve) => { setTimeout(resolve, scrollDelay); });
    }
  }

  async stopRequestCatching() {
    if (!this.view) {
      await this.requestCatchingBridge.stop();
      return { active: false, attached: false };
    }

    const result = await this.requestCatchingBridge.stop(this.view.webContents);
    return {
      ...result,
      attached: true,
    };
  }

  setBounds(bounds) {
    const win = this._getWindow();
    if (!win || !this.view || !bounds) return;

    this.lastBounds = bounds;
    const width = Math.max(0, Math.round(Number(bounds.width) || 0));
    const height = Math.max(0, Math.round(Number(bounds.height) || 0));

    if (width < 8 || height < 8) {
      this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    this.view.setBounds({
      x: Math.round(Number(bounds.x) || 0),
      y: Math.round(Number(bounds.y) || 0),
      width,
      height,
    });
  }

  async navigate(payload = {}) {
    if (!this.view) {
      throw new Error('Embedded browser is not attached');
    }

    const url = this._resolveUrl(payload.url, payload.scenarioId);
    if (!url || url === 'about:blank') return this.getState();

    const currentUrl = this.view.webContents.getURL() || '';
    if (url === currentUrl) return this.getState();

    this.view.webContents.loadURL(url);
    return this.getState();
  }

  async reload() {
    if (!this.view) return this.getState();

    if (this.view.webContents.isLoading()) {
      this.view.webContents.stop();
      return this.getState();
    }

    if (this.userDataDir && this.partition) {
      invalidateProfileCookieCache(this.userDataDir);
      await this._syncSessionCookies(this.partition, this.userDataDir);
    }

    this.view.webContents.reload();
    return this.getState();
  }

  goBack() {
    if (!this.view?.webContents.canGoBack()) return this.getState();
    this.view.webContents.goBack();
    return this.getState();
  }

  goForward() {
    if (!this.view?.webContents.canGoForward()) return this.getState();
    this.view.webContents.goForward();
    return this.getState();
  }

  getState() {
    if (!this.view) {
      return {
        attached: false,
        url: '',
        title: '',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        designMode: this.designModeEnabled,
        zoomFactor: this.zoomFactor,
        requestCatchingActive: this.requestCatchingBridge.isActive(),
      };
    }

    const { webContents } = this.view;
    return {
      attached: true,
      url: webContents.getURL() || '',
      title: webContents.getTitle() || '',
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      isLoading: this._pageLoading,
      designMode: this.designModeEnabled,
      zoomFactor: this.zoomFactor,
      requestCatchingActive: this.requestCatchingBridge.isActive(),
    };
  }

  detach() {
    const win = this._getWindow();
    if (win && this.resizeHandler) {
      win.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.view && this._didFinishLoadHandler) {
      this.view.webContents.removeListener('did-finish-load', this._didFinishLoadHandler);
      this._didFinishLoadHandler = null;
    }

    if (this.view && this._onRequestCatchingNavigateHandler) {
      this.view.webContents.removeListener('did-start-navigation', this._onRequestCatchingNavigateHandler);
      this._onRequestCatchingNavigateHandler = null;
    }

    this._teardownLoadingStateHooks();

    if (this.view && this._keyboardInputHandler) {
      this.view.webContents.removeListener('before-input-event', this._keyboardInputHandler);
      this._keyboardInputHandler = null;
    }

    this.stopFindInPage();
    // Preserve requestCatchingAutoConfig — detach() runs during attach() recycle;
    // clearing here breaks auto-start on did-finish-load.
    this._requestCatchingPageUrl = '';
    void this.requestCatchingBridge.stop(this.view?.webContents || null);

    if (win && this.view) {
      win.removeBrowserView(this.view);
    }

    if (this.view) {
      this.view.webContents.close();
      this.view = null;
    }

    this.sessionKey = null;
    this.userDataDir = null;
    this.partition = null;
    this.lastBounds = null;
    this.zoomFactor = 1;
    this._designPickBound = false;
  }
}

export { ScenarioEmbeddedBrowserService };
