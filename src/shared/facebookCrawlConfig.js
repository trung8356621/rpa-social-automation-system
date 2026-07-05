/**
 * Facebook crawl settings, system variable profiles, and URL helpers.
 */

export const FACEBOOK_CRAWL_GROUP_PROFILE_ID = 'c7f8a901-2b3c-4d5e-8f67-000000000001';

export const FACEBOOK_CRAWL_GROUP_PROFILE_NAME = '__system:facebook-crawl-group';

export const FACEBOOK_CRAWL_GROUP_VARIABLES = ['group_id', 'post_limit'];

export const FACEBOOK_CRAWL_SETTINGS = {
  groupScenarioId: 'facebook.crawlGroupScenarioId',
  scrollSettleSeconds: 'facebook.crawlScrollSettleSeconds',
  crawlBrowserProfileId: 'facebook.crawlBrowserProfileId',
  crawlProxyId: 'facebook.crawlProxyId',
};

export const DEFAULT_FACEBOOK_CRAWL_SCROLL_SETTLE_SECONDS = 4;

export function readFacebookCrawlLaunchOptions(settings = {}) {
  const browserProfileId = String(settings[FACEBOOK_CRAWL_SETTINGS.crawlBrowserProfileId] || '').trim();
  const proxyId = String(settings[FACEBOOK_CRAWL_SETTINGS.crawlProxyId] || '').trim();
  return {
    browserProfileId: browserProfileId || null,
    proxyId: proxyId || null,
  };
}

export function readFacebookCrawlScrollSettleMs(settings = {}) {
  const seconds = Number(settings[FACEBOOK_CRAWL_SETTINGS.scrollSettleSeconds]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_FACEBOOK_CRAWL_SCROLL_SETTLE_SECONDS * 1000;
  }
  return Math.max(1000, Math.min(120000, Math.round(seconds * 1000)));
}

export function applyFacebookCrawlSettingsToMeta(crawlMeta = {}, settings = {}) {
  const settleMs = readFacebookCrawlScrollSettleMs(settings);
  return {
    ...crawlMeta,
    infinity_scroll: {
      ...(crawlMeta.infinity_scroll || {}),
      settle_ms: settleMs,
    },
  };
}


export function readVariableSampleValue(samples = [], key = '', preferredName = 'Default') {
  if (!Array.isArray(samples) || !key) return '';
  const sample = samples.find((item) => item?.name === preferredName) || samples[0];
  const entry = (sample?.variables || []).find((item) => item?.key === key);
  return String(entry?.value ?? '').trim();
}

export const SYSTEM_FACEBOOK_VARIABLE_PROFILES = [
  {
    id: FACEBOOK_CRAWL_GROUP_PROFILE_ID,
    name: FACEBOOK_CRAWL_GROUP_PROFILE_NAME,
    keys: FACEBOOK_CRAWL_GROUP_VARIABLES,
  },
];

export const SYSTEM_VARIABLE_PROFILE_IDS = new Set(
  SYSTEM_FACEBOOK_VARIABLE_PROFILES.map((profile) => profile.id),
);

export function isSystemVariableProfile(profileId) {
  return SYSTEM_VARIABLE_PROFILE_IDS.has(String(profileId || '').trim());
}

export function buildFacebookGroupUrl(groupId = '') {
  const slug = String(groupId || '').trim();
  if (!slug) return '';
  return `https://www.facebook.com/groups/${slug}/?sorting_setting=CHRONOLOGICAL`;
}

export function buildFacebookPostLink(postId, groupId = '') {
  const id = String(postId || '').trim();
  const slug = String(groupId || '').trim();
  if (!id || !slug) return '';
  return `https://www.facebook.com/groups/${slug}/posts/${id}/`;
}

function readVariableValue(variables, key) {
  if (!variables || !key) return '';

  if (variables instanceof Map) {
    return String(variables.get(key) ?? '').trim();
  }

  if (Array.isArray(variables)) {
    const item = variables.find((entry) => (entry.key || entry.name) === key);
    return String(item?.value ?? '').trim();
  }

  if (typeof variables === 'object') {
    return String(variables[key] ?? '').trim();
  }

  return '';
}

/**
 * Resolve group_id from scenario variables and/or target URL.
 */
export function resolveFacebookCrawlContext(options = {}) {
  const groupId = readVariableValue(options.variables, 'group_id')
    || String(options.groupId || options.groupSlug || '').trim()
    || parseFacebookGroupLink(options.targetUrl || '').group_id;

  return {
    group_id: groupId,
    post_id: readVariableValue(options.variables, 'post_id') || String(options.postId || '').trim(),
  };
}

/**
 * Fill missing group_id / post_link on parsed crawl results using scenario variables.
 */
export function enrichFacebookCrawlPosts(posts, options = {}) {
  const context = resolveFacebookCrawlContext(options);
  if (!context.group_id) {
    return Array.isArray(posts) ? posts : [];
  }

  return (Array.isArray(posts) ? posts : []).map((post) => {
    const postId = post?.post_id || null;
    const groupId = post?.group_id || post?._group_slug || context.group_id || null;
    const postLink = post?.post_link
      || (postId && groupId ? buildFacebookPostLink(postId, groupId) : '');

    return {
      ...post,
      group_id: groupId,
      post_link: postLink,
      ...(groupId ? { _group_slug: groupId } : {}),
    };
  });
}

/**
 * Parse group_id from a Facebook group URL.
 * @param {string} url - e.g. https://www.facebook.com/groups/295931577185665/
 * @returns {{ group_id: string }}
 */
export function parseFacebookGroupLink(url = '') {
  const text = String(url || '').trim();
  const match = text.match(/facebook\.com\/groups\/([^/?#]+)/i);
  return {
    group_id: match?.[1] ? String(match[1]).trim() : '',
  };
}

/**
 * Parse group_id and post_id from a Facebook group post URL.
 * Used for saved post links and isolated JSON-only Single Post crawl.
 * @param {string} url
 * @returns {{ group_id: string, post_id: string }}
 */
export function parseFacebookPostLink(url = '') {
  const text = String(url || '').trim();
  const match = text.match(/facebook\.com\/groups\/([^/?#]+)\/posts\/(\d+)/i);
  const multiPermalinkMatch = text.match(/facebook\.com\/groups\/([^/?#]+)\/?\?(?:[^#]*&)?multi_permalinks=(\d+)/i);
  const resolved = match || multiPermalinkMatch;
  return {
    group_id: resolved?.[1] ? String(resolved[1]).trim() : '',
    post_id: resolved?.[2] ? String(resolved[2]).trim() : '',
  };
}

/**
 * Build variable entries for a Facebook group crawl run.
 * @param {{ groupId?: string, postLimit?: string|number }} params
 */
export function buildFacebookGroupCrawlVariables({ groupId = '', postLimit = '' } = {}) {
  return [
    { key: 'group_id', value: String(groupId || '').trim() },
    { key: 'post_limit', value: normalizeFacebookPostLimit(postLimit) },
  ];
}

export function normalizeFacebookPostLimit(value = '') {
  const limit = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(limit) || limit <= 0) return '';
  return String(Math.floor(limit));
}

export function buildFacebookSinglePostCrawlVariables({ postLink = '', groupId = '', postId = '' } = {}) {
  const parsed = parseFacebookPostLink(postLink);
  return [
    { key: 'group_id', value: String(groupId || parsed.group_id || '').trim() },
    { key: 'post_id', value: String(postId || parsed.post_id || '').trim() },
  ];
}

export const FACEBOOK_CRAWL_URL_GUARD_SKIP_MESSAGE = 'URL Guard: skipped request outside expected Facebook group';

function normalizeFacebookGroupId(value = '') {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function readHeaderValue(headers = {}, key = '') {
  const expected = String(key || '').toLowerCase();
  if (!headers || typeof headers !== 'object' || !expected) return '';

  const foundKey = Object.keys(headers).find((item) => String(item).toLowerCase() === expected);
  return foundKey ? String(headers[foundKey] || '') : '';
}

export function isFacebookCrawlUrlGuardMatch(targetUrl = '', options = {}) {
  const expectedGroupId = normalizeFacebookGroupId(parseFacebookGroupLink(targetUrl).group_id);
  if (!expectedGroupId) return true;

  const candidates = [
    options.pageUrl,
    options.referer,
    options.url,
  ].map((value) => normalizeFacebookGroupId(parseFacebookGroupLink(value || '').group_id))
    .filter(Boolean);

  if (!candidates.length) return true;
  return candidates.some((groupId) => groupId === expectedGroupId);
}

export function shouldSkipFacebookCrawlRequest({
  targetUrl = '',
  pageUrl = '',
  referer = '',
  requestHeaders = {},
} = {}) {
  const resolvedReferer = referer || readHeaderValue(requestHeaders, 'referer');
  return !isFacebookCrawlUrlGuardMatch(targetUrl, {
    pageUrl,
    referer: resolvedReferer,
  });
}

export function validateFacebookCrawlNavigation(expectedUrl = '', actualUrl = '') {
  const expectedGroupId = normalizeFacebookGroupId(parseFacebookGroupLink(expectedUrl).group_id);
  const actualGroupId = normalizeFacebookGroupId(parseFacebookGroupLink(actualUrl).group_id);

  if (!expectedGroupId || !actualGroupId) {
    return { ok: true, expected: { group_id: expectedGroupId }, actual: { group_id: actualGroupId } };
  }

  if (expectedGroupId !== actualGroupId) {
    return {
      ok: false,
      reason: 'group_mismatch',
      expected: { group_id: expectedGroupId },
      actual: { group_id: actualGroupId },
    };
  }

  return { ok: true, expected: { group_id: expectedGroupId }, actual: { group_id: actualGroupId } };
}

export function buildFacebookCrawlNavigationError(validation = {}, expectedUrl = '', actualUrl = '') {
  const reason = validation.reason || 'url_mismatch';
  const expectedGroupId = validation.expected?.group_id || parseFacebookGroupLink(expectedUrl).group_id || '';
  const actualGroupId = validation.actual?.group_id || parseFacebookGroupLink(actualUrl).group_id || '';
  return [
    `Facebook crawl navigation guard failed: ${reason}.`,
    expectedGroupId ? `Expected group: ${expectedGroupId}.` : '',
    actualGroupId ? `Actual group: ${actualGroupId}.` : '',
    `Expected URL: ${expectedUrl || '(empty)'}.`,
    `Actual URL: ${actualUrl || '(empty)'}.`,
  ].filter(Boolean).join(' ');
}
