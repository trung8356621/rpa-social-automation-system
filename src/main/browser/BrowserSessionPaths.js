import fs from 'node:fs';
import path from 'node:path';

export function resolveSessionStartUrl(startUrl) {
  const url = String(startUrl || '').trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('wp-login.php')) {
      return `${parsed.origin}/wp-admin/`;
    }
    return url;
  } catch {
    return url;
  }
}

export function resolveGuestSessionDir(browserDataRoot, scenarioId, variableProfileId = null) {
  const base = path.join(browserDataRoot, 'guest', 'sessions', scenarioId);
  const sessionDir = variableProfileId
    ? path.join(base, String(variableProfileId))
    : base;
  fs.mkdirSync(path.join(sessionDir, 'Default'), { recursive: true });
  return sessionDir;
}

export async function ensureRememberMeChecked(page) {
  if (!page || page.isClosed()) return;

  const url = page.url();
  if (!url.includes('wp-login.php')) return;

  await page.evaluate(() => {
    const selectors = ['#rememberme', 'input[name="rememberme"]'];
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input instanceof HTMLInputElement && input.type === 'checkbox' && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }).catch(() => {});
}

export async function isCheckboxAlreadyChecked(page, { selectors = [], coords = null, viewport = null } = {}) {
  if (!page || page.isClosed()) return false;

  for (const selector of selectors) {
    if (!selector) continue;
    const state = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return 'missing';
      if (!(element instanceof HTMLInputElement)) return 'not-checkbox';
      if (element.type !== 'checkbox' && element.type !== 'radio') return 'not-checkbox';
      return element.checked ? 'checked' : 'unchecked';
    }, selector).catch(() => 'missing');

    if (state === 'checked') return true;
    if (state === 'unchecked') return false;
  }

  if (coords?.x !== undefined && coords?.y !== undefined && viewport) {
    const x = Math.round((coords.x / 100) * viewport.width);
    const y = Math.round((coords.y / 100) * viewport.height);
    const state = await page.evaluate((px, py) => {
      const target = document.elementFromPoint(px, py);
      if (!target) return 'missing';

      const input = target instanceof HTMLInputElement
        ? target
        : target.closest('input[type="checkbox"], input[type="radio"]');
      if (!(input instanceof HTMLInputElement)) return 'not-checkbox';
      if (input.type !== 'checkbox' && input.type !== 'radio') return 'not-checkbox';
      return input.checked ? 'checked' : 'unchecked';
    }, x, y).catch(() => 'missing');

    if (state === 'checked') return true;
    if (state === 'unchecked') return false;
  }

  return false;
}
