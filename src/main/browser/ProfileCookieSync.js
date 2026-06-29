import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const syncCache = new Map();

function hashUserDataDir(userDataDir) {
  return crypto.createHash('sha256').update(String(userDataDir)).digest('hex').slice(0, 16);
}

function getCookiesMtime(userDataDir) {
  const candidates = [
    path.join(userDataDir, 'Default', 'Network', 'Cookies'),
    path.join(userDataDir, 'Default', 'Cookies'),
  ];
  let max = 0;
  for (const candidate of candidates) {
    try {
      max = Math.max(max, fs.statSync(candidate).mtimeMs);
    } catch {
      // Ignore missing cookie DB files.
    }
  }
  return max;
}

async function copyProfileSnapshot(userDataDir) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpa-cookie-sync-'));
  const defaultSrc = path.join(userDataDir, 'Default');
  const defaultDest = path.join(tempRoot, 'Default');

  const relativeFiles = [
    'Cookies',
    'Network/Cookies',
    'Preferences',
  ];

  await fsp.mkdir(path.join(defaultDest, 'Network'), { recursive: true });

  for (const relativeFile of relativeFiles) {
    const src = path.join(defaultSrc, relativeFile);
    const dest = path.join(defaultDest, relativeFile);
    try {
      await fsp.copyFile(src, dest);
    } catch {
      // Optional file.
    }
  }

  try {
    await fsp.copyFile(path.join(userDataDir, 'Local State'), path.join(tempRoot, 'Local State'));
  } catch {
    // Optional file.
  }

  return tempRoot;
}

function buildCookieUrl(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const protocol = cookie.secure ? 'https:' : 'http:';
  const cookiePath = cookie.path || '/';
  return `${protocol}//${domain}${cookiePath}`;
}

function mapSameSite(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'none') return 'no_restriction';
  if (normalized === 'lax') return 'lax';
  if (normalized === 'strict') return 'strict';
  return 'unspecified';
}

export function buildPreviewPartition(userDataDir) {
  return `persist:rpa-preview-${hashUserDataDir(userDataDir)}`;
}

export async function syncProfileCookiesToSession(electronSession, userDataDir) {
  if (!electronSession || !userDataDir || !fs.existsSync(userDataDir)) {
    return { synced: 0, cached: false };
  }

  const mtime = getCookiesMtime(userDataDir);
  if (!mtime) {
    return { synced: 0, cached: false };
  }

  if (syncCache.get(userDataDir) === mtime) {
    return { synced: 0, cached: true };
  }

  let tempRoot = null;
  let browser = null;

  try {
    tempRoot = await copyProfileSnapshot(userDataDir);
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: tempRoot,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = (await browser.pages())[0] || await browser.newPage();
    const client = await page.createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    let synced = 0;
    for (const cookie of cookies || []) {
      if (!cookie?.name) continue;
      try {
        await electronSession.cookies.set({
          url: buildCookieUrl(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
          sameSite: mapSameSite(cookie.sameSite),
        });
        synced += 1;
      } catch {
        // Skip invalid cookie rows.
      }
    }

    syncCache.set(userDataDir, mtime);
    return { synced, cached: false };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function invalidateProfileCookieCache(userDataDir) {
  if (userDataDir) syncCache.delete(userDataDir);
}
