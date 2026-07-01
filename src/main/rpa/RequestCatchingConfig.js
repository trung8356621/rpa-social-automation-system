/**
 * Platform presets for request_catching scenarios.
 * Users only pick platform + URL; filters are applied automatically at runtime.
 */

export const REQUEST_CATCHING_PLATFORM_CONFIG = {
  facebook: {
    urlIncludes: ['facebook.com/api/graphql'],
    postDataIncludes: [
      'GroupCometFeedRegularStoriesQuery',
      'ProfileCometContextualProfileRootQuery',
      'groupID',
    ],
    requestHeaders: {},
  },
  tiktok: {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  },
  instagram: {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  },
  youtube: {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  },
  linkedin: {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  },
  custom: {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  },
};

export function getRequestCatchingPlatformConfig(platform) {
  const key = String(platform || 'facebook').trim().toLowerCase();
  return REQUEST_CATCHING_PLATFORM_CONFIG[key] || REQUEST_CATCHING_PLATFORM_CONFIG.facebook;
}

export function resolveRequestCatchingConfig(platform, customFilters = {}) {
  const base = getRequestCatchingPlatformConfig(platform);
  const custom = customFilters && typeof customFilters === 'object' ? customFilters : {};

  return {
    urlIncludes: Array.isArray(custom.urlIncludes) && custom.urlIncludes.length
      ? custom.urlIncludes
      : base.urlIncludes,
    postDataIncludes: Array.isArray(custom.postDataIncludes) && custom.postDataIncludes.length
      ? custom.postDataIncludes
      : base.postDataIncludes,
    requestHeaders: custom.requestHeaders && typeof custom.requestHeaders === 'object'
      ? custom.requestHeaders
      : {},
  };
}

export function hasCustomRequestCatchingFilters(customFilters = {}) {
  const custom = customFilters && typeof customFilters === 'object' ? customFilters : {};
  const headerCount = custom.requestHeaders ? Object.keys(custom.requestHeaders).length : 0;
  const postCount = Array.isArray(custom.postDataIncludes) ? custom.postDataIncludes.length : 0;
  const urlCount = Array.isArray(custom.urlIncludes) ? custom.urlIncludes.length : 0;
  return headerCount > 0 || postCount > 0 || urlCount > 0;
}

export function matchesRequestCatchingUrl(url = '', config = {}) {
  const urlIncludes = Array.isArray(config.urlIncludes) ? config.urlIncludes : [];
  if (!urlIncludes.length) return false;
  return urlIncludes.some((part) => url.includes(part));
}

export function normalizeRequestHeaders(headers = {}) {
  const normalized = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    normalized[String(key).toLowerCase()] = String(value ?? '');
  });
  return normalized;
}

export function matchesRequestCatchingHeaders(requestHeaders = {}, config = {}) {
  const required = config.requestHeaders && typeof config.requestHeaders === 'object'
    ? config.requestHeaders
    : {};
  const entries = Object.entries(required);
  if (!entries.length) return true;

  const normalized = normalizeRequestHeaders(requestHeaders);
  return entries.every(([key, value]) => {
    const actual = normalized[String(key).toLowerCase()];
    if (actual === undefined) return false;
    return actual.includes(String(value));
  });
}

export function matchesRequestCatchingFilter({ url = '', postData = '', requestHeaders = {} }, config = {}) {
  if (!matchesRequestCatchingUrl(url, config)) return false;

  const hasHeaderRules = config.requestHeaders && Object.keys(config.requestHeaders).length > 0;
  if (hasHeaderRules) {
    return matchesRequestCatchingHeaders(requestHeaders, config);
  }

  const postDataIncludes = Array.isArray(config.postDataIncludes) ? config.postDataIncludes : [];
  if (!postDataIncludes.length) return true;

  const payload = String(postData || '');
  if (!payload) return false;

  return postDataIncludes.some((keyword) => payload.includes(keyword));
}

export function extractQueryNameFromPostData(postData = '') {
  const text = String(postData || '');
  if (!text) return '';

  const friendlyMatch = text.match(/fb_api_req_friendly_name[=:]([^&\s"']+)/i);
  if (friendlyMatch) return decodeURIComponent(friendlyMatch[1]);

  const jsonFriendlyMatch = text.match(/"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/);
  if (jsonFriendlyMatch) return jsonFriendlyMatch[1];

  try {
    const parsed = JSON.parse(text);
    if (parsed?.fb_api_req_friendly_name) return String(parsed.fb_api_req_friendly_name);
    if (parsed?.doc_id) return `doc_id:${parsed.doc_id}`;
  } catch {
    // Not JSON.
  }

  return '';
}

export function getDiscoveryLabel(capture = {}) {
  const headers = capture.requestHeaders || {};
  const normalized = normalizeRequestHeaders(headers);
  return normalized['x-fb-friendly-name']
    || extractQueryNameFromPostData(capture.postData)
    || capture.url?.split('?')[0]?.split('/').pop()
    || 'GraphQL request';
}

export function shouldCaptureRequestCatching(
  { url = '', postData = '', requestHeaders = {} },
  platform,
  customFilters = {},
) {
  const config = resolveRequestCatchingConfig(platform, customFilters);
  if (!hasCustomRequestCatchingFilters(customFilters)) {
    return matchesRequestCatchingUrl(url, config);
  }
  return matchesRequestCatchingFilter({ url, postData, requestHeaders }, config);
}

export function extractFilterFromCapture(capture = {}) {
  const url = String(capture.url || '');
  const postData = String(capture.postData || '');
  const requestHeaders = capture.requestHeaders || {};
  const normalized = normalizeRequestHeaders(requestHeaders);

  const filter = {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  };

  if (url.includes('facebook.com/api/graphql')) {
    filter.urlIncludes = ['facebook.com/api/graphql'];
  } else if (url) {
    try {
      const parsed = new URL(url);
      filter.urlIncludes = [`${parsed.hostname}${parsed.pathname}`];
    } catch {
      filter.urlIncludes = [url.slice(0, 120)];
    }
  }

  const friendlyName = normalized['x-fb-friendly-name'];
  if (friendlyName) {
    filter.requestHeaders['x-fb-friendly-name'] = friendlyName;
    return filter;
  }

  const queryName = extractQueryNameFromPostData(postData);
  if (queryName) {
    filter.postDataIncludes = [queryName];
  }

  return filter;
}

/**
 * Facebook GraphQL often returns newline-delimited JSON (NDJSON).
 */
export function parseNdjsonResponseText(text) {
  if (!text || typeof text !== 'string') return [];

  const objects = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        objects.push(parsed);
      }
    } catch {
      // Skip invalid JSON lines.
    }
  }

  if (!objects.length) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (item && typeof item === 'object') objects.push(item);
          });
        } else if (parsed && typeof parsed === 'object') {
          objects.push(parsed);
        }
      } catch {
        // Ignore non-JSON payloads.
      }
    }
  }

  return objects;
}
