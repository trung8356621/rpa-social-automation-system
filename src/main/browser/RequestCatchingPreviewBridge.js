import {
  getDiscoveryLabel,
  getRequestCatchingPlatformConfig,
  matchesRequestCatchingUrl,
  parseNdjsonResponseText,
} from '../rpa/RequestCatchingConfig.js';

/**
 * CDP Network listener for embedded BrowserView request-catching preview.
 */
export class RequestCatchingPreviewBridge {
  constructor() {
    this._handler = null;
    this._requestMeta = new Map();
    this._pendingResponses = new Map();
    this._webContents = null;
    this._onCapture = null;
    this._onDiscover = null;
    this._active = false;
    this._platform = 'facebook';
    this._customFilters = {};
  }

  isActive() {
    return this._active;
  }

  async _resolveRequestPostData(dbg, requestId, cachedPostData = '') {
    if (cachedPostData) return cachedPostData;

    try {
      const result = await dbg.sendCommand('Network.getRequestPostData', { requestId });
      return result?.postData || '';
    } catch {
      return '';
    }
  }

  async _flushPendingResponse(dbg, requestId) {
    const pending = this._pendingResponses.get(requestId);
    if (!pending) return;
    this._pendingResponses.delete(requestId);

    const meta = this._requestMeta.get(requestId) || {};
    this._requestMeta.delete(requestId);

    try {
      const postData = await this._resolveRequestPostData(dbg, requestId, pending.postData || meta.postData);
      const requestHeaders = pending.requestHeaders || meta.requestHeaders || {};

      let text = '';
      let parsed = [];
      try {
        const bodyResult = await dbg.sendCommand('Network.getResponseBody', { requestId });
        text = bodyResult?.base64Encoded
          ? Buffer.from(bodyResult.body || '', 'base64').toString('utf8')
          : String(bodyResult?.body || '');
        parsed = parseNdjsonResponseText(text);
      } catch (error) {
        console.warn('[RC Bridge] Response body read failed:', error?.message || error);
      }

      const discoveryRecord = {
        id: `${requestId}-${Date.now()}`,
        requestId,
        url: pending.url,
        requestHeaders,
        postData: postData.slice(0, 8000),
        postDataPreview: postData.slice(0, 240),
        responsePreview: text.slice(0, 4000),
        objectCount: parsed.length,
        items: parsed,
        label: getDiscoveryLabel({ url: pending.url, postData, requestHeaders }),
        timestamp: new Date().toISOString(),
      };

      if (this._onDiscover) {
        this._onDiscover(discoveryRecord);
      }

      if (parsed.length && this._onCapture) {
        this._onCapture(parsed, {
          url: pending.url,
          itemCount: parsed.length,
          label: discoveryRecord.label,
          requestHeaders,
        });
      }
    } catch (error) {
      console.warn('[RC Bridge] Flush failed:', error?.message || error);
    }
  }

  async start(webContents, platform, options = {}) {
    if (!webContents || webContents.isDestroyed()) {
      throw new Error('Browser preview is not ready.');
    }

    await this.stop(webContents);

    this._webContents = webContents;
    this._onCapture = typeof options.onCapture === 'function' ? options.onCapture : null;
    this._onDiscover = typeof options.onDiscover === 'function' ? options.onDiscover : null;
    this._platform = String(platform || 'facebook').trim().toLowerCase() || 'facebook';
    this._customFilters = options.customFilters && typeof options.customFilters === 'object'
      ? options.customFilters
      : {};
    this._requestMeta = new Map();
    this._pendingResponses = new Map();

    const dbg = webContents.debugger;
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3');
        console.log('[RC Bridge] Debugger attached');
      } catch (err) {
        console.error('[RC Bridge] Debugger attach FAILED:', err?.message || err);
        throw err;
      }
    }

    const platformConfig = getRequestCatchingPlatformConfig(this._platform);

    this._handler = async (_event, method, params) => {
      try {
        if (method === 'Network.requestWillBeSent') {
          const requestId = params?.requestId;
          const url = params?.request?.url || '';
          const postData = params?.request?.postData || '';
          const requestHeaders = params?.request?.headers || {};

          if (requestId) {
            this._requestMeta.set(requestId, {
              url,
              postData,
              requestHeaders,
            });
          }
          return;
        }

        if (method === 'Network.responseReceived') {
          const requestId = params?.requestId;
          const url = params?.response?.url || '';

          if (requestId && matchesRequestCatchingUrl(url, platformConfig)) {
            const meta = this._requestMeta.get(requestId) || {};
            this._pendingResponses.set(requestId, {
              url,
              postData: meta.postData || '',
              requestHeaders: meta.requestHeaders || {},
            });
          }
          return;
        }

        if (method === 'Network.loadingFinished') {
          const requestId = params?.requestId;
          if (requestId && this._pendingResponses.has(requestId)) {
            await this._flushPendingResponse(dbg, requestId);
          }
        }
      } catch (error) {
        console.warn('[RC Bridge] Capture failed:', error?.message || error);
      }
    };

    dbg.on('message', this._handler);
    try {
      await dbg.sendCommand('Network.enable', {
        maxTotalBufferSize: 100000000,
        maxResourceBufferSize: 50000000,
      });
      console.log(`[RC Bridge] Network.enable OK, platform=${this._platform}`);
    } catch (err) {
      console.error('[RC Bridge] Network.enable FAILED:', err?.message || err);
      throw err;
    }

    this._active = true;
    return { active: true, platform: this._platform };
  }

  async stop(webContents = this._webContents) {
    this._active = false;
    this._onCapture = null;
    this._onDiscover = null;
    this._customFilters = {};
    this._requestMeta.clear();
    this._pendingResponses.clear();

    if (!webContents || webContents.isDestroyed()) {
      this._webContents = null;
      this._handler = null;
      return { active: false };
    }

    const dbg = webContents.debugger;
    if (this._handler) {
      dbg.removeListener('message', this._handler);
      this._handler = null;
    }

    try {
      if (dbg.isAttached()) {
        await dbg.sendCommand('Network.disable');
      }
    } catch {
      // Debugger may already be detached.
    }

    if (webContents === this._webContents) {
      this._webContents = null;
    }

    return { active: false };
  }
}
