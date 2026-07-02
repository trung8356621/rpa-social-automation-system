/**
 * Facebook crawl settings, system variable profiles, and URL helpers.
 */

export const FACEBOOK_CRAWL_GROUP_PROFILE_ID = 'c7f8a901-2b3c-4d5e-8f67-000000000001';
export const FACEBOOK_CRAWL_COMMENT_PROFILE_ID = 'c7f8a901-2b3c-4d5e-8f67-000000000002';

export const FACEBOOK_CRAWL_GROUP_PROFILE_NAME = '__system:facebook-crawl-group';
export const FACEBOOK_CRAWL_COMMENT_PROFILE_NAME = '__system:facebook-crawl-comment';

export const FACEBOOK_CRAWL_GROUP_VARIABLES = ['group_id', 'last_date'];
export const FACEBOOK_CRAWL_COMMENT_VARIABLES = ['group_id', 'post_id'];

export const FACEBOOK_CRAWL_SETTINGS = {
  groupScenarioId: 'facebook.crawlGroupScenarioId',
  commentScenarioId: 'facebook.crawlCommentScenarioId',
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

/** True when target URL is a single group post (comment crawl). */
export function isFacebookCommentCrawlUrl(url = '') {
  return /\/posts\/\d+/i.test(String(url || '').trim());
}

/**
 * Comment crawls must load every comment — no date stop condition, longer scroll budget.
 */
export function applyFacebookCommentCrawlMetaOverrides(crawlMeta = {}) {
  const autoscroll = crawlMeta.autoscroll || {};
  const infinite = crawlMeta.infinity_scroll || {};

  return {
    ...crawlMeta,
    autoscroll: {
      ...autoscroll,
      enabled: true,
      distance_px: Math.max(400, Number(autoscroll.distance_px) || 600),
      delay_ms: Math.max(300, Number(autoscroll.delay_ms) || 500),
    },
    infinity_scroll: {
      ...infinite,
      enabled: true,
      stop_mode: 'timeout',
      max_scrolls: Math.max(200, Number(infinite.max_scrolls) || 0),
      timeout_ms: Math.max(180000, Number(infinite.timeout_ms) || 0),
      settle_ms: Math.max(4000, Number(infinite.settle_ms) || 0),
      condition: {
        field: '',
        operator: '<',
        value: '',
      },
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
  {
    id: FACEBOOK_CRAWL_COMMENT_PROFILE_ID,
    name: FACEBOOK_CRAWL_COMMENT_PROFILE_NAME,
    keys: FACEBOOK_CRAWL_COMMENT_VARIABLES,
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
  return `https://www.facebook.com/groups/${slug}/`;
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
 * Resolve group_id / post_id from scenario variables and/or target URL.
 */
export function resolveFacebookCrawlContext(options = {}) {
  const fromUrl = parseFacebookPostLink(options.targetUrl || '');
  const groupId = readVariableValue(options.variables, 'group_id')
    || String(options.groupId || options.groupSlug || '').trim()
    || fromUrl.group_id;
  const postId = readVariableValue(options.variables, 'post_id')
    || String(options.postId || '').trim()
    || fromUrl.post_id;

  return {
    group_id: groupId,
    post_id: postId,
  };
}

/**
 * Fill missing post_id / group_id / post_link on parsed crawl results
 * using scenario variables or the resolved target URL.
 */
export function enrichFacebookCrawlPosts(posts, options = {}) {
  const context = resolveFacebookCrawlContext(options);
  if (!context.group_id && !context.post_id) {
    return Array.isArray(posts) ? posts : [];
  }

  return (Array.isArray(posts) ? posts : []).map((post) => {
    const postId = post?.post_id || context.post_id || null;
    const groupId = post?.group_id || post?._group_slug || context.group_id || null;
    const postLink = post?.post_link
      || (postId && groupId ? buildFacebookPostLink(postId, groupId) : '');

    return {
      ...post,
      post_id: postId,
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
 * @param {string} url
 * @returns {{ group_id: string, post_id: string }}
 */
export function parseFacebookPostLink(url = '') {
  const text = String(url || '').trim();
  const match = text.match(/facebook\.com\/groups\/([^/?#]+)\/posts\/(\d+)/i);
  return {
    group_id: match?.[1] ? String(match[1]).trim() : '',
    post_id: match?.[2] ? String(match[2]).trim() : '',
  };
}

/**
 * Build variable entries for a Facebook group crawl run.
 * @param {{ groupId?: string, lastDate?: string }} params
 */
export function buildFacebookGroupCrawlVariables({ groupId = '', lastDate = '' } = {}) {
  return [
    { key: 'group_id', value: String(groupId || '').trim() },
    { key: 'last_date', value: String(lastDate || '').trim() },
  ];
}

/**
 * Build variable entries for a Facebook comment crawl run.
 * @param {{ postLink?: string, groupId?: string, postId?: string }} params
 */
export function buildFacebookCommentCrawlVariables({
  postLink = '',
  groupId = '',
  postId = '',
} = {}) {
  const parsed = parseFacebookPostLink(postLink);
  return [
    { key: 'group_id', value: String(groupId || parsed.group_id || '').trim() },
    { key: 'post_id', value: String(postId || parsed.post_id || '').trim() },
  ];
}
