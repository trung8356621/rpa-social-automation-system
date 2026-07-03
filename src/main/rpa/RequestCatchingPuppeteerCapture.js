import {
  getRequestCatchingPlatformConfig,
  matchesRequestCatchingUrl,
  parseNdjsonResponseText,
} from './RequestCatchingConfig.js';

/**
 * CDP Network capture for Puppeteer request_catching execution.
 */
export class RequestCatchingPuppeteerCapture {
  constructor() {
    this._client = null;
    this._page = null;
    this._requestMeta = new Map();
    this._pendingResponses = new Map();
    this._onCapture = null;
    this._platform = 'facebook';
    this._active = false;
  }

  isActive() {
    return this._active;
  }

  async _resolveRequestPostData(requestId, cachedPostData = '') {
    if (cachedPostData || !this._client) return cachedPostData;

    try {
      const result = await this._client.send('Network.getRequestPostData', { requestId });
      return result?.postData || '';
    } catch {
      return '';
    }
  }

  async _flushPendingResponse(requestId) {
    const pending = this._pendingResponses.get(requestId);
    if (!pending || !this._client) return;
    this._pendingResponses.delete(requestId);

    const meta = this._requestMeta.get(requestId) || {};
    this._requestMeta.delete(requestId);

    try {
      const postData = await this._resolveRequestPostData(requestId, pending.postData || meta.postData);
      let text = '';

      try {
        const bodyResult = await this._client.send('Network.getResponseBody', { requestId });
        text = bodyResult?.base64Encoded
          ? Buffer.from(bodyResult.body || '', 'base64').toString('utf8')
          : String(bodyResult?.body || '');
      } catch (error) {
        console.warn('[RC Puppeteer] Response body read failed:', error?.message || error);
      }

      const parsed = parseNdjsonResponseText(text);
      if (parsed.length && this._onCapture) {
        const requestHeaders = pending.requestHeaders || meta.requestHeaders || {};
        this._onCapture(parsed, {
          url: pending.url,
          itemCount: parsed.length,
          postData,
          requestHeaders,
          referer: requestHeaders.Referer || requestHeaders.referer || '',
        });
      }
    } catch (error) {
      console.warn('[RC Puppeteer] Flush failed:', error?.message || error);
    }
  }

  async start(page, platform, options = {}) {
    if (!page || page.isClosed()) {
      throw new Error('Browser page is not ready for request catching.');
    }

    await this.stop();

    this._page = page;
    this._onCapture = typeof options.onCapture === 'function' ? options.onCapture : null;
    this._platform = String(platform || 'facebook').trim().toLowerCase() || 'facebook';
    this._requestMeta = new Map();
    this._pendingResponses = new Map();

    const client = await page.createCDPSession();
    this._client = client;

    const platformConfig = getRequestCatchingPlatformConfig(this._platform);

    client.on('Network.requestWillBeSent', (params) => {
      const requestId = params?.requestId;
      if (!requestId) return;
      this._requestMeta.set(requestId, {
        url: params?.request?.url || '',
        postData: params?.request?.postData || '',
        requestHeaders: params?.request?.headers || {},
      });
    });

    client.on('Network.responseReceived', (params) => {
      const requestId = params?.requestId;
      const url = params?.response?.url || '';
      if (!requestId || !matchesRequestCatchingUrl(url, platformConfig)) return;

      const meta = this._requestMeta.get(requestId) || {};
      this._pendingResponses.set(requestId, {
        url,
        postData: meta.postData || '',
        requestHeaders: meta.requestHeaders || {},
      });
    });

    client.on('Network.loadingFinished', (params) => {
      const requestId = params?.requestId;
      if (requestId && this._pendingResponses.has(requestId)) {
        void this._flushPendingResponse(requestId);
      }
    });

    await client.send('Network.enable', {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000,
    });

    this._active = true;
    return { active: true, platform: this._platform };
  }

  async stop() {
    this._active = false;
    this._onCapture = null;
    this._requestMeta.clear();
    this._pendingResponses.clear();

    if (this._client) {
      try {
        await this._client.send('Network.disable');
      } catch {
        // Session may already be detached.
      }
      try {
        await this._client.detach();
      } catch {
        // Ignore detach errors.
      }
      this._client = null;
    }

    this._page = null;
    return { active: false };
  }
}

export function mergeRequestCatchingRawObjects(previous = [], incoming = []) {
  const items = Array.isArray(incoming) ? incoming : [];
  if (!items.length) return previous || [];

  const seen = new Set((previous || []).map((item) => JSON.stringify(item)));
  const next = [...(previous || [])];

  items.forEach((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(item);
  });

  return next;
}
