/**
 * Shared stop-condition helpers for crawl / request-catching infinity scroll.
 */

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
 * Stop infinity scroll only when every parsed post in the batch matches the condition.
 * Avoids stopping after the first batch when the feed mixes new and old posts.
 */
export function crawlConditionShouldStopScroll(parsedItems = [], condition = {}) {
  const field = String(condition?.field || '').trim();
  if (!field || !Array.isArray(parsedItems) || !parsedItems.length) return false;

  const candidates = parsedItems
    .map((item) => normalizeConditionItem(item))
    .filter((data) => data && typeof data === 'object' && !Array.isArray(data))
    .filter((data) => data[field] != null && (data.post_id || data.post_content || data.post_date));

  if (!candidates.length) return false;

  return candidates.every((data) => (
    compareCrawlValues(data[field], condition.operator, condition.value)
  ));
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
  const dateText = text.includes('/') && !text.includes('-')
    ? text.split('/').reverse().join('-')
    : text;
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
