/**
 * Extract content image URLs from Facebook GraphQL attachment/media nodes.
 */

const PROFILE_THUMB_PATTERN = /ctp=s(?:24|32|34|40|50)x\d+/i;
const EXCLUDED_URL_PATTERN = /profile_picture|keyframes|emoji|reaction_asset|sticker/i;

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
}

export function isLikelyContentImageUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  if (!/fbcdn\.net|facebook\.com\/photo/i.test(normalized)) return false;
  if (EXCLUDED_URL_PATTERN.test(normalized)) return false;
  if (PROFILE_THUMB_PATTERN.test(normalized)) return false;
  return true;
}

function readMediaUri(media = {}) {
  const candidates = [
    media?.photo_image?.uri,
    media?.viewer_image?.uri,
    media?.image?.uri,
    media?.large_share_image?.uri,
    media?.blurred_image?.uri,
  ];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (isLikelyContentImageUrl(url)) return url;
  }

  return '';
}

function readAttachmentUri(attachment = {}) {
  const direct = [
    attachment?.media?.photo_image?.uri,
    attachment?.media?.viewer_image?.uri,
    attachment?.media?.image?.uri,
    attachment?.style_type_renderer?.attachment?.media?.image?.uri,
    attachment?.style_type_renderer?.attachment?.media?.photo_image?.uri,
    attachment?.styles?.attachment?.media?.photo_image?.uri,
    attachment?.styles?.attachment?.media?.image?.uri,
  ];

  for (const candidate of direct) {
    const url = normalizeUrl(candidate);
    if (isLikelyContentImageUrl(url)) return url;
  }

  const mediaUrl = readMediaUri(attachment?.media || {});
  if (mediaUrl) return mediaUrl;

  const styledMedia = attachment?.style_type_renderer?.attachment?.media
    || attachment?.styles?.attachment?.media;
  return readMediaUri(styledMedia);
}

export function extractFacebookMediaUrls(node = {}) {
  if (!node || typeof node !== 'object') return [];

  const urls = [];
  const pushUrl = (value) => {
    const url = normalizeUrl(value);
    if (!isLikelyContentImageUrl(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };

  if (Array.isArray(node.attachments)) {
    node.attachments.forEach((attachment) => {
      pushUrl(readAttachmentUri(attachment));
    });
  }

  if (Array.isArray(node.all_subattachments?.nodes)) {
    node.all_subattachments.nodes.forEach((attachment) => {
      pushUrl(readAttachmentUri(attachment));
    });
  }

  if (Array.isArray(node.subattachments)) {
    node.subattachments.forEach((attachment) => {
      pushUrl(readAttachmentUri(attachment));
    });
  }

  pushUrl(readMediaUri(node.media));
  pushUrl(readAttachmentUri(node));

  return urls;
}

export function serializeFacebookMediaUrls(urls = []) {
  const normalized = (Array.isArray(urls) ? urls : [])
    .map((item) => normalizeUrl(item))
    .filter((item) => isLikelyContentImageUrl(item));

  return normalized.length ? JSON.stringify(normalized) : '';
}

export function parseFacebookMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUrl(item)).filter(Boolean);
  }

  const text = String(value).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeUrl(item)).filter(Boolean);
    }
  } catch {
    // Fall through to single URL.
  }

  return isLikelyContentImageUrl(text) ? [text] : [];
}

export function mergeFacebookMediaUrls(existing = [], incoming = []) {
  const merged = [...parseFacebookMediaUrls(existing)];
  parseFacebookMediaUrls(incoming).forEach((url) => {
    if (!merged.includes(url)) merged.push(url);
  });
  return merged;
}

export function estimateFacebookImageUrlArea(url = '') {
  const text = String(url || '');
  const patterns = [
    /cstp=mx(\d+)x(\d+)/i,
    /cstp=(\d+)x(\d+)/i,
    /[?&]ctp=[^&]*?(\d{2,4})x(\d{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match?.[2]) {
      return Number(match[1]) * Number(match[2]);
    }
  }

  return /fbcdn\.net/i.test(text) ? 1_000_000 : 0;
}

export function upgradeFacebookImageUrlToMaxQuality(url = '') {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';

  let upgraded = normalized
    .replace(/([?&])ctp=[^&]*/gi, '$1')
    .replace(/\?&/g, '?')
    .replace(/&&+/g, '&')
    .replace(/[?&]$/, '');

  if (/fbcdn\.net/i.test(upgraded) && !/cstp=mx/i.test(upgraded)) {
    upgraded += upgraded.includes('?') ? '&' : '?';
    upgraded += 'cstp=mx2048x2048';
  }

  return upgraded;
}

export function pickHighestQualityFacebookImageUrl(urls = []) {
  const list = (Array.isArray(urls) ? urls : parseFacebookMediaUrls(urls))
    .map((url) => normalizeUrl(url))
    .filter(Boolean);

  if (!list.length) return '';

  const ranked = list
    .map((url) => ({
      url: upgradeFacebookImageUrlToMaxQuality(url),
      area: estimateFacebookImageUrlArea(url),
    }))
    .sort((left, right) => right.area - left.area);

  return ranked[0]?.url || '';
}
