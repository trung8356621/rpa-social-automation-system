/**
 * Facebook crawl date helpers — UI uses dd-MM-yyyy, crawl variables use YYYY-MM-DD.
 */

const DD_MM_YYYY_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function isoToDdMmYyyy(value = '') {
  const text = String(value || '').trim();
  const match = text.match(ISO_DATE_PATTERN);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${pad2(day)}-${pad2(month)}-${year}`;
}

export function ddMmYyyyToIso(value = '') {
  const text = String(value || '').trim();
  const match = text.match(DD_MM_YYYY_PATTERN);
  if (!match) return '';

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return '';
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return '';
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatDateToDdMmYyyy(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function parseDdMmYyyyToDate(value = '') {
  const iso = ddMmYyyyToIso(value);
  if (!iso) return null;
  const match = iso.match(ISO_DATE_PATTERN);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeFacebookCrawlDateInput(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  const fromDdMm = ddMmYyyyToIso(text);
  if (fromDdMm) return fromDdMm;

  const isoMatch = text.match(ISO_DATE_PATTERN);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return ddMmYyyyToIso(`${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`);
  }

  return '';
}

export function toFacebookCrawlDateDisplay(value = '') {
  const normalized = normalizeFacebookCrawlDateInput(value);
  return normalized ? isoToDdMmYyyy(normalized) : String(value || '').trim();
}
