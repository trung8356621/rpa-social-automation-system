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
import { buildPreviewPartition, invalidateProfileCookieCache, syncProfileCookiesToSession } from './ProfileCookieSync.js';

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
    if (!this.view || this._didFinishLoadHandler) return;

    this._didFinishLoadHandler = async () => {
      await this._injectDesignMode();
      if (this.designModeEnabled) {
        await this._applyDesignModeState();
      }
    };
    this.view.webContents.on('did-finish-load', this._didFinishLoadHandler);
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

    this._teardownLoadingStateHooks();

    if (this.view && this._keyboardInputHandler) {
      this.view.webContents.removeListener('before-input-event', this._keyboardInputHandler);
      this._keyboardInputHandler = null;
    }

    this.stopFindInPage();

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
