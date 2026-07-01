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
