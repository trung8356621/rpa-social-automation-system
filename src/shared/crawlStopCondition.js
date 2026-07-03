/**
 * Shared stop-condition helpers for crawl / request-catching infinity scroll.
 */

import { normalizeFacebookCrawlDateInput } from './facebookDateFormat.js';

const DEFAULT_CONSECUTIVE_STOP_MATCHES = 7;

export function normalizeConditionItem(item = {}) {
  if (item?.data !== undefined) return item.data;
  if (item?.html !== undefined) return item.html;
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) return item;
  return item ?? '';
}

export function crawlConditionMatched(items = [], condition = {}) {
  const field = String(condition?.field || '').trim();
  if (!field || !Array.isArray(items)) return false;

  return items.some((item) => {
    const data = normalizeConditionItem(item);
    const value = data && typeof data === 'object' && !Array.isArray(data)
      ? data[field]
      : undefined;
    return compareCrawlValues(value, condition.operator, condition.value);
  });
}

/**
 * Stop infinity scroll only after enough consecutive parsed posts match the
 * condition. Facebook group feeds can mix pinned/recently-active old posts with
 * newer posts, so a single old post must not stop the crawl.
 */
export function crawlConditionShouldStopScroll(parsedItems = [], condition = {}) {
  const field = String(condition?.field || '').trim();
  if (!field || !Array.isArray(parsedItems) || !parsedItems.length) return false;

  const candidates = parsedItems
    .map((item) => normalizeConditionItem(item))
    .filter((data) => data && typeof data === 'object' && !Array.isArray(data))
    .filter((data) => data[field] != null && (data.post_id || data.post_content || data.post_date));

  if (!candidates.length) return false;

  const tolerance = resolveConsecutiveStopTolerance(condition);
  condition.__consecutiveStopMatches = Number(condition.__consecutiveStopMatches) || 0;

  for (const data of candidates) {
    const matched = compareCrawlValues(data[field], condition.operator, condition.value);
    if (matched) {
      condition.__consecutiveStopMatches += 1;
      if (condition.__consecutiveStopMatches >= tolerance) return true;
    } else {
      condition.__consecutiveStopMatches = 0;
    }
  }

  return false;
}

function resolveConsecutiveStopTolerance(condition = {}) {
  const explicit = Number(condition.consecutive_matches || condition.consecutiveMatches);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.floor(explicit));
  return DEFAULT_CONSECUTIVE_STOP_MATCHES;
}

export function compareCrawlValues(left, operator = '<', right) {
  if (left === undefined || left === null || right === undefined || right === null || right === '') {
    return false;
  }

  const leftComparable = toComparableValue(left);
  const rightComparable = toComparableValue(right);

  switch (operator) {
    case '<': return leftComparable < rightComparable;
    case '<=': return leftComparable <= rightComparable;
    case '>': return leftComparable > rightComparable;
    case '>=': return leftComparable >= rightComparable;
    case '!=': return leftComparable !== rightComparable;
    case '=':
    default:
      return leftComparable === rightComparable;
  }
}

export function toComparableValue(value) {
  const text = String(value).trim();
  const normalizedDate = normalizeFacebookCrawlDateInput(text);
  const dateText = normalizedDate
    || (text.includes('/') && !text.includes('-')
      ? text.split('/').reverse().join('-')
      : text);
  const timestamp = Date.parse(dateText);
  if (!Number.isNaN(timestamp) && /^\d{4}-\d{2}-\d{2}/.test(dateText)) {
    return timestamp;
  }
  if (!Number.isNaN(timestamp) && /[/-]\d{1,2}[/-]/.test(text)) {
    return timestamp;
  }
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(number) && text !== '') return number;
  return text.toLowerCase();
}
