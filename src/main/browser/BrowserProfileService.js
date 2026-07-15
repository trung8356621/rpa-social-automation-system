import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { resolveGuestSessionDir, resolveSessionStartUrl } from './BrowserSessionPaths.js';
import { resolveScenarioTargetUrl } from '../rpa/VariableResolver.js';
import {
  getBrowserZoomService,
  resolveBrowserZoomPercent,
} from '../rpa/BrowserZoomService.js';

const BROWSER_DEFINITIONS = [
  {
    browser_key: 'chrome',
    browser_name: 'Google Chrome',
    userDataDir: ['Google', 'Chrome', 'User Data'],
    executablePaths: [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ],
  },
  {
    browser_key: 'edge',
    browser_name: 'Microsoft Edge',
    userDataDir: ['Microsoft', 'Edge', 'User Data'],
    executablePaths: [
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ],
  },
  {
    browser_key: 'brave',
    browser_name: 'Brave',
    userDataDir: ['BraveSoftware', 'Brave-Browser', 'User Data'],
    executablePaths: [
      ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ],
  },
  {
    browser_key: 'coccoc',
    browser_name: 'Coc Coc',
    userDataDir: ['CocCoc', 'Browser', 'User Data'],
    executablePaths: [
      ['CocCoc', 'Browser', 'Application', 'browser.exe'],
    ],
  },
];

class BrowserProfileService {
  constructor({ dbService, appDataPath }) {
    this.dbService = dbService;
    this.appDataPath = appDataPath;
    this.wpUsernameCache = new Map();
  }

  scanInstalledBrowserProfiles() {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];

    if (!localAppData) {
      return this.dbService.upsertBrowserProfiles([]);
    }

    const foundProfiles = [];
    const skipped = [];
    const scannedAt = new Date().toISOString();

    for (const browser of BROWSER_DEFINITIONS) {
      const userDataDir = path.join(localAppData, ...browser.userDataDir);
      if (!fs.existsSync(userDataDir)) {
        skipped.push({ browser_key: browser.browser_key, reason: 'missing_user_data_dir', path: userDataDir });
        continue;
      }

      const executablePath = this.findExecutable(browser, {
        localAppData,
        programFiles,
        programFilesX86,
      });

      if (!executablePath) {
        skipped.push({ browser_key: browser.browser_key, reason: 'missing_executable', path: userDataDir });
        continue;
      }

      const profileDirs = this.findProfileDirs(userDataDir);
      if (profileDirs.length === 0) {
        skipped.push({ browser_key: browser.browser_key, reason: 'missing_profiles', path: userDataDir });
      }

      for (const profileDirName of profileDirs) {
        const profileName = this.readProfileName(userDataDir, profileDirName);
        foundProfiles.push({
          browser_key: browser.browser_key,
          browser_name: browser.browser_name,
          profile_name: profileName,
          executable_path: executablePath,
          user_data_dir: userDataDir,
          profile_dir_name: profileDirName,
          display_name: `${browser.browser_name} - ${profileName}`,
          source: 'scan',
          status: 'active',
          last_scanned_at: scannedAt,
        });
      }
    }

    const items = this.dbService.upsertBrowserProfiles(foundProfiles);
    return {
      items,
      foundCount: foundProfiles.length,
      skipped,
      message: foundProfiles.length
        ? `Đã tìm thấy ${foundProfiles.length} browser profile`
        : 'Không tìm thấy browser profile. Bạn có thể thêm thủ công.',
    };
  }

  openBrowserProfile(profileId) {
    const profile = this.dbService.getBrowserProfileById(profileId);
    if (!profile) {
      throw new Error('Không tìm thấy browser profile');
    }

    if (!fs.existsSync(profile.executable_path)) {
      throw new Error(`Không tìm thấy browser executable: ${profile.executable_path}`);
    }

    const settings = this.dbService.getSettings();
    const args = [
      `--user-data-dir=${profile.user_data_dir}`,
      `--profile-directory=${profile.profile_dir_name}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];

    const viewportWidth = Number(settings['browser.viewportWidth']);
    const viewportHeight = Number(settings['browser.viewportHeight']);
    if (viewportWidth > 0 && viewportHeight > 0) {
      args.push(`--window-size=${viewportWidth},${viewportHeight}`);
    }

    if (settings['browser.headless'] === true) {
      args.push('--headless=new');
    }

    const child = spawn(profile.executable_path, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    return {
      success: true,
      profile,
      pid: child.pid,
    };
  }

  resolveSessionUserDataDir(scenarioId, browserProfileId, variableProfileId = null) {
    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');

    if (browserProfileId) {
      const profile = this.dbService.getBrowserProfileById(browserProfileId);
      if (profile?.import_path) {
        fs.mkdirSync(path.join(profile.import_path, 'Default'), { recursive: true });
        return profile.import_path;
      }
      throw new Error('Không tìm thấy thư mục profile trong app');
    }

    if (!scenarioId) {
      throw new Error('Chọn kịch bản để dùng guest session');
    }

    return resolveGuestSessionDir(browserDataRoot, scenarioId, variableProfileId);
  }

  resolveSessionStartUrl(startUrl) {
    return resolveSessionStartUrl(startUrl);
  }

  async waitForProfileUnlock(userDataDir, maxWaitMs = 30000) {
    if (!userDataDir) return;

    const lockPath = path.join(userDataDir, 'SingletonLock');
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      if (!fs.existsSync(lockPath)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  getSessionCloseDelayMs() {
    const settings = this.dbService.getSettings();
    const configured = Number(settings['execution.browserCloseDelayMs']);
    if (!Number.isFinite(configured)) return 5000;
    return Math.min(120000, Math.max(1000, Math.round(configured)));
  }

  async gracefulCloseBrowser(browser, _userDataDir, page = null) {
    if (!browser?.isConnected?.()) return;

    const delayMs = this.getSessionCloseDelayMs();
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Close the active page to trigger unload/beforeunload so Chrome flushes
    // pending writes (cookies WAL, localStorage, IndexedDB) before exit.
    const activePage = (page && !page.isClosed())
      ? page
      : (await browser.pages().catch(() => []))[0];
    if (activePage && !activePage.isClosed()) {
      await activePage.close().catch(() => {});
    }

    const chromeProcess = browser.process?.() ?? null;

    try {
      await browser.close();
    } catch {
      // Browser may already be closed.
    }

    // Wait for Chrome to fully exit before returning — ensures the SQLite WAL
    // (Default/Cookies) has been checkpointed and data is on disk.
    if (chromeProcess) {
      await new Promise((resolve) => {
        if (chromeProcess.exitCode !== null) { resolve(); return; }
        const timer = setTimeout(resolve, 15000);
        chromeProcess.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async openBrowserSession({ scenarioId, browserProfileId = null, startUrl = null }) {
    const userDataDir = this.resolveSessionUserDataDir(scenarioId, browserProfileId);
    await this.waitForProfileUnlock(userDataDir);
    let effectiveStartUrl = startUrl;
    if (scenarioId && startUrl) {
      const variableMap = this.dbService.buildVariableMap(scenarioId, null);
      effectiveStartUrl = resolveScenarioTargetUrl(startUrl, variableMap);
    } else {
      effectiveStartUrl = this.resolveSessionStartUrl(startUrl);
    }
    const result = await this._launchPuppeteerWithProfile(userDataDir, effectiveStartUrl);
    return {
      ...result,
      browserProfileId: browserProfileId || null,
      scenarioId: scenarioId || null,
      startUrl: effectiveStartUrl,
    };
  }

  async openGuestBrowser() {
    throw new Error('Dùng openBrowserSession với scenarioId thay cho guest browser riêng');
  }

  async openAppBrowserProfile(profile) {
    const userDataDir = profile?.import_path;
    if (!userDataDir || !fs.existsSync(userDataDir)) {
      throw new Error('Không tìm thấy thư mục profile trong app');
    }
    return this._launchPuppeteerWithProfile(userDataDir, null);
  }

  async detectBrowserProfileAccount(profileId) {
    const profile = this.dbService.getBrowserProfileById(profileId);
    if (!profile) throw new Error('Khong tim thay browser profile');

    this._seedWpUsernameCacheFromSummary(profile.account_summary || profile.accountSummary || '');
    const userDataDir = profile.import_path || profile.user_data_dir;
    const profileDirName = profile.import_path ? 'Default' : (profile.profile_dir_name || 'Default');
    const detected = await this.detectProfileAccountOffline(userDataDir, { profileDirName });
    const updatedProfile = this.dbService.updateBrowserProfileAccount(profileId, detected);

    return {
      success: true,
      profile: updatedProfile,
      account: {
        facebookId: detected.facebookId || null,
        hasLinkedIn: Boolean(detected.hasLinkedIn),
        summary: detected.accountSummary || '',
        method: detected.method || 'none',
      },
    };
  }

  async detectProfileAccountByUserDataDir(userDataDir) {
    const profile = this.dbService.getBrowserProfileByUserDataDir(userDataDir);
    if (!profile) return null;
    return this.detectBrowserProfileAccount(profile.id);
  }

  async detectProfileAccountOffline(userDataDir, options = {}) {
    const profileDirName = options.profileDirName || 'Default';
    const result = { facebookId: null, hasLinkedIn: false, accountSummary: '', method: 'none' };
    if (!userDataDir) return result;
    let cookieResult = null;
    console.log(`[BrowserProfileService] Detect account start: userDataDir=${userDataDir}, profileDir=${profileDirName}`);

    try {
      cookieResult = this._detectAccountFromCookieDb(userDataDir, profileDirName);
      console.log('[BrowserProfileService] SQLite detect result:', {
        facebookId: cookieResult.facebookId || null,
        hasLinkedIn: Boolean(cookieResult.hasLinkedIn),
        wpDomains: cookieResult.wpDomains || [],
        summary: cookieResult.accountSummary || '',
      });
      const shouldEnrichOnline = Array.isArray(cookieResult.wpDomains) && cookieResult.wpDomains.length > 0;
      if (!shouldEnrichOnline && (cookieResult.accountSummary || cookieResult.facebookId || cookieResult.hasLinkedIn)) {
        return { ...result, ...cookieResult, method: 'sqlite' };
      }
    } catch (error) {
      console.warn(`[BrowserProfileService] Cookie DB detect failed: ${error.message}`);
    }

    try {
      const browserResult = await this._detectAccountWithHeadlessBrowser(userDataDir, cookieResult || {});
      console.log('[BrowserProfileService] Browser detect result:', {
        facebookId: browserResult.facebookId || null,
        hasLinkedIn: Boolean(browserResult.hasLinkedIn),
        summary: browserResult.accountSummary || '',
        method: browserResult.method || 'puppeteer',
      });
      const mergedResult = this._mergeAccountDetections(cookieResult, browserResult);
      console.log('[BrowserProfileService] Detect merged result:', mergedResult);
      if (mergedResult.accountSummary || mergedResult.facebookId || mergedResult.hasLinkedIn) {
        return { ...result, ...mergedResult, method: browserResult.method || 'puppeteer' };
      }
      if (browserResult.accountSummary || browserResult.facebookId || browserResult.hasLinkedIn) {
        return { ...result, ...browserResult, method: 'puppeteer' };
      }
    } catch (error) {
      console.warn(`[BrowserProfileService] Headless detect failed: ${error.message}`);
    }

    return result;
  }

  _detectAccountFromCookieDb(userDataDir, profileDirName = 'Default') {
    const candidates = [
      path.join(userDataDir, 'Default', 'Network', 'Cookies'),
      path.join(userDataDir, profileDirName, 'Network', 'Cookies'),
      path.join(userDataDir, 'Default', 'Cookies'),
      path.join(userDataDir, profileDirName, 'Cookies'),
    ];
    const cookiesPath = candidates.find((item) => fs.existsSync(item));
    if (!cookiesPath) return { facebookId: null, hasLinkedIn: false, accountSummary: '', wpDomains: [] };
    console.log(`[BrowserProfileService] Reading cookie DB: ${cookiesPath}`);

    const cookieDb = new Database(cookiesPath, { readonly: true, fileMustExist: true });
    try {
      const rows = cookieDb
        .prepare(`
          SELECT host_key, name, value
          FROM cookies
          WHERE name LIKE 'wordpress_logged_in_%'
             OR name IN ('c_user', 'dotcom_user', 'li_at', 'xf_user')
        `)
        .all();
      console.log(`[BrowserProfileService] Cookie rows matched: ${rows.length}`);

      return this._summarizeCookieAccounts(rows);
    } finally {
      cookieDb.close();
    }
  }

  _summarizeCookieAccounts(rows = []) {
    const labels = [];
    const seen = new Set();
    let facebookId = null;
    let hasLinkedIn = false;
    const wpDomains = [];

    const addLabel = (label) => {
      const safeLabel = this._safeCookieText(label, 160);
      if (!safeLabel || seen.has(safeLabel)) return;
      seen.add(safeLabel);
      labels.push(safeLabel);
    };

    for (const row of Array.isArray(rows) ? rows : []) {
      const host = this._normalizeCookieHost(row?.host_key);
      const name = this._safeCookieText(row?.name, 120);
      const value = this._safeCookieText(row?.value, 240);
      if (!name) continue;

      try {
        if (name.startsWith('wordpress_logged_in_')) {
          const username = this._extractWordPressUsername(value);
          if (host && !wpDomains.includes(host)) wpDomains.push(host);
          addLabel(`WP: ${host || 'WordPress'}${username ? ` (${username})` : ''}`);
        } else if (name === 'c_user') {
          facebookId = value || facebookId;
          addLabel(`FB: ${value || 'Active'}`);
        } else if (name === 'dotcom_user') {
          addLabel(`GitHub: ${value || 'Active'}`);
        } else if (name === 'li_at') {
          hasLinkedIn = true;
          addLabel(`LinkedIn: ${host || 'Active'}`);
        } else if (name === 'xf_user') {
          addLabel(`Forum: ${host || 'XenForo'}${value ? ` (${value.split(',')[0]})` : ''}`);
        }
      } catch (error) {
        console.warn(`[BrowserProfileService] Cookie row parse skipped: ${error.message}`);
      }
    }

    return {
      facebookId,
      hasLinkedIn,
      accountSummary: labels.join(' | '),
      wpDomains,
    };
  }

  _safeCookieText(value, maxLength = 200) {
    try {
      return String(value ?? '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxLength);
    } catch {
      return '';
    }
  }

  _normalizeCookieHost(hostKey = '') {
    return this._safeCookieText(hostKey, 180).replace(/^\.+/, '');
  }

  _extractWordPressUsername(value = '') {
    const safeValue = this._safeCookieText(value, 240);
    const firstPart = safeValue.split(/[|:%;,]/)[0] || '';
    const match = firstPart.match(/[a-zA-Z0-9._@-]{2,}/);
    return match?.[0] || '';
  }

  async _detectAccountWithHeadlessBrowser(userDataDir, hints = {}) {
    const debugVisible = this._isAccountDetectDebugVisible();
    console.log(`[BrowserProfileService] Launch account detect browser: headless=${!debugVisible}, wpDomains=${(hints.wpDomains || []).join(', ') || '-'}`);
    const browser = await puppeteer.launch({
      headless: !debugVisible,
      userDataDir,
      defaultViewport: { width: 800, height: 600 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(3000);
      page.setDefaultNavigationTimeout(3000);
      await this._blockHeavyResources(page);

      const labels = [];
      let facebookId = hints.facebookId || null;
      let hasLinkedIn = Boolean(hints.hasLinkedIn);
      const wpDomains = Array.isArray(hints.wpDomains) ? hints.wpDomains : [];

      for (const domain of wpDomains.slice(0, 12)) {
        const safeDomain = this._normalizeCookieHost(domain);
        const cachedUsername = this.wpUsernameCache.get(safeDomain);
        if (cachedUsername) {
          console.log(`[BrowserProfileService] WP profile detect skipped: domain=${safeDomain}, reason=username_cached, cachedUsername=${cachedUsername}`);
          labels.push(`WP: ${safeDomain} (${cachedUsername})`);
          continue;
        }

        const username = await this._detectWordPressUsername(page, domain);
        console.log(`[BrowserProfileService] WP profile detect: domain=${safeDomain}, username=${username || '-'}`);
        if (username) {
          this.wpUsernameCache.set(safeDomain, username);
          labels.push(`WP: ${safeDomain} (${username})`);
        }
      }

      if (facebookId) {
        console.log(`[BrowserProfileService] Facebook /me detect skipped: reason=sqlite_cookie_uid, facebookId=${facebookId}`);
      } else {
        console.log('[BrowserProfileService] Facebook /me detect start');
        await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 3000 }).catch(() => {});
        const fbContent = await page.content().catch(() => '');
        facebookId = this._extractFacebookIdFromHtml(fbContent) || facebookId;
        console.log(`[BrowserProfileService] Facebook /me detect result: ${facebookId || '-'}`);
      }

      console.log('[BrowserProfileService] LinkedIn feed detect start');
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 3000 }).catch(() => {});
      const liContent = await page.content().catch(() => '');
      const liUrl = page.url() || '';
      hasLinkedIn = /"plainId"|"publicIdentifier"|"miniProfile"|voyager|feed/i.test(liContent)
        && !/\/login|uas\/login/i.test(liUrl)
        || hasLinkedIn;

      const summaryParts = [...labels];
      if (facebookId) summaryParts.push(`FB: ${facebookId}`);
      if (hasLinkedIn) summaryParts.push('LinkedIn: Active');

      return { facebookId, hasLinkedIn, accountSummary: summaryParts.join(' | '), method: 'puppeteer' };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  _isAccountDetectDebugVisible() {
    return String(process.env.FACEBOOK_CRAWL_DUMP_REQUESTS || '').trim().toLowerCase() === 'true';
  }

  async _blockHeavyResources(page) {
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const type = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          request.abort().catch(() => {});
          return;
        }
        request.continue().catch(() => {});
      });
    } catch {
      // Continue without request interception if Chromium rejects it.
    }
  }

  async _detectWordPressUsername(page, domain) {
    const safeDomain = this._normalizeCookieHost(domain);
    if (!safeDomain) return '';

    try {
      await page.goto(`https://${safeDomain}/wp-admin/profile.php`, {
        waitUntil: 'domcontentloaded',
        timeout: 3000,
      }).catch(() => {});

      await page.waitForSelector(
        'input#user_login, input[name="user_login"], #wp-admin-bar-my-account .display-name, .user-display-name, .username',
        { timeout: 2500 },
      ).catch(() => {});

      const username = await page.evaluate(() => {
        const clean = (value) => String(value || '')
          .replace(/^(@|Howdy,\s*)/i, '')
          .trim();
        const candidates = [
          () => document.querySelector('input#user_login')?.value,
          () => document.querySelector('input[name="user_login"]')?.value,
          () => document.querySelector('#wp-admin-bar-my-account .display-name')?.textContent,
          () => document.querySelector('#wp-admin-bar-my-account > a')?.textContent,
          () => document.querySelector('.user-display-name')?.textContent,
          () => document.querySelector('.username')?.textContent,
        ];

        for (const read of candidates) {
          const value = clean(read());
          if (value) return value;
        }

        const profileLinks = [...document.querySelectorAll('a[href*="profile.php"], a[href*="user-edit.php"]')];
        for (const link of profileLinks) {
          const text = clean(link.textContent);
          if (text && !/profile|edit|logout|view|dashboard|admin|wordpress/i.test(text)) return text;

          try {
            const url = new URL(link.href, window.location.href);
            const login = url.searchParams.get('user_login') || url.searchParams.get('login') || '';
            if (login) return clean(login);
          } catch {
            // ignore invalid href
          }
        }
        return '';
      }).catch(() => '');
      const pageState = await page.evaluate(() => ({
        title: document.title || '',
        bodySnippet: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        hasUserLoginInput: Boolean(document.querySelector('input#user_login, input[name="user_login"]')),
        hasAdminBarName: Boolean(document.querySelector('#wp-admin-bar-my-account .display-name')),
        profileLinkTexts: [...document.querySelectorAll('a[href*="profile.php"], a[href*="user-edit.php"]')]
          .map((link) => String(link.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 6),
      })).catch(() => ({}));
      console.log('[BrowserProfileService] WP profile page state:', {
        domain: safeDomain,
        url: page.url() || '-',
        username: username || '-',
        ...pageState,
      });

      return this._safeCookieText(username, 120) || '';
    } catch (error) {
      console.warn(`[BrowserProfileService] WP username detect failed for ${safeDomain}: ${error.message}`);
      return '';
    }
  }

  _mergeAccountDetections(cookieResult = {}, browserResult = {}) {
    const labels = [];
    const seen = new Set();
    const wpWithUsername = new Set();
    let facebookLabel = '';
    let linkedInLabel = '';

    const add = (label) => {
      const safeLabel = this._safeCookieText(label, 180);
      if (!safeLabel) return;
      if (/^(FB|Facebook):/i.test(safeLabel)) {
        const value = safeLabel.split(':').slice(1).join(':').trim();
        if (!facebookLabel || /^\d{5,}$/.test(value)) {
          facebookLabel = /^\d{5,}$/.test(value) ? `FB: ${value}` : safeLabel;
        }
        return;
      }
      if (/^LinkedIn:/i.test(safeLabel)) {
        linkedInLabel = linkedInLabel || safeLabel;
        return;
      }
      if (seen.has(safeLabel)) return;
      seen.add(safeLabel);
      labels.push(safeLabel);
    };

    for (const label of String(browserResult?.accountSummary || '').split('|').map((item) => item.trim()).filter(Boolean)) {
      const wpAccount = this._parseWpSummaryLabel(label);
      if (wpAccount?.domain && wpAccount?.username) {
        wpWithUsername.add(wpAccount.domain);
      }
      add(label);
    }

    for (const label of String(cookieResult?.accountSummary || '').split('|').map((item) => item.trim()).filter(Boolean)) {
      const wpAccount = this._parseWpSummaryLabel(label);
      if (wpAccount?.domain && wpWithUsername.has(wpAccount.domain)) {
        console.log(`[BrowserProfileService] Merge skip stale WP cookie label: ${label}`);
        continue;
      }
      add(label);
    }

    if (facebookLabel) labels.unshift(facebookLabel);
    if (linkedInLabel) labels.push(linkedInLabel);

    return {
      facebookId: browserResult?.facebookId || cookieResult?.facebookId || null,
      hasLinkedIn: Boolean(browserResult?.hasLinkedIn || cookieResult?.hasLinkedIn),
      accountSummary: labels.join(' | '),
      wpDomains: cookieResult?.wpDomains || [],
    };
  }

  _parseWpSummaryLabel(label = '') {
    const match = String(label || '').match(/^WP:\s*([^(|]+?)(?:\s*\(([^)]*)\))?\s*$/i);
    if (!match?.[1]) return null;
    return {
      domain: this._normalizeCookieHost(match[1]),
      username: this._safeCookieText(match[2] || '', 120),
    };
  }

  _seedWpUsernameCacheFromSummary(summary = '') {
    for (const label of String(summary || '').split('|').map((item) => item.trim()).filter(Boolean)) {
      const wpAccount = this._parseWpSummaryLabel(label);
      if (wpAccount?.domain && wpAccount?.username) {
        this.wpUsernameCache.set(wpAccount.domain, wpAccount.username);
      }
    }
  }

  _extractFacebookIdFromHtml(html = '') {
    const content = String(html || '');
    const patterns = [
      /"USER_ID"\s*:\s*"(\d{5,})"/i,
      /"ACCOUNT_ID"\s*:\s*"(\d{5,})"/i,
      /"actorID"\s*:\s*"(\d{5,})"/i,
      /"userID"\s*:\s*"(\d{5,})"/i,
      /profile\.php\?id=(\d{5,})/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  async _launchPuppeteerWithProfile(userDataDir, startUrl = null) {
    const settings = this.dbService.getSettings();
    const viewportWidth = Number(settings['browser.viewportWidth']) || 1280;
    const viewportHeight = Number(settings['browser.viewportHeight']) || 720;
    const zoomPercent = resolveBrowserZoomPercent(settings);
    const zoomService = getBrowserZoomService();
    let zoomPrepare = null;
    try {
      zoomPrepare = await zoomService.prepareUserDataDir(userDataDir, zoomPercent);
    } catch (error) {
      console.warn(`[BrowserZoom] prepareUserDataDir failed: ${error.message}`);
    }

    const browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      defaultViewport: { width: viewportWidth, height: viewportHeight },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${viewportWidth},${viewportHeight}`,
      ],
    }).catch((error) => {
      throw new Error(`Không mở được browser: ${error.message}`);
    });

    browser.on('disconnected', () => {
      void this.detectProfileAccountByUserDataDir(userDataDir).catch((error) => {
        console.warn(`[BrowserProfileService] Auto detect on close failed: ${error.message}`);
      });
    });

    try {
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      for (const extraPage of pages.slice(1)) {
        await extraPage.close().catch(() => {});
      }

      // Chromium persists cookies natively via userDataDir — no manual restore needed.
      const url = String(startUrl || '').trim();
      if (url) {
        const effectiveUrl = this.resolveSessionStartUrl(url) || url;
        await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
      await zoomService.applyDefaultZoom({
        page,
        browser,
        userDataDir,
        percent: zoomPercent,
        prepareResult: zoomPrepare,
      }).catch((error) => {
        console.warn(`[BrowserZoom] applyDefaultZoom failed: ${error.message}`);
      });
    } catch {
      // Browser vẫn mở, bỏ qua lỗi điều hướng
    }

    return {
      success: true,
      userDataDir,
      pid: browser.process()?.pid || null,
    };
  }

  importBrowserProfile(profileId) {
    const profile = this.dbService.getBrowserProfileById(profileId);
    if (!profile) {
      throw new Error('Khong tim thay browser profile');
    }

    const sourceDir = path.join(profile.user_data_dir, profile.profile_dir_name);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Khong tim thay thu muc profile: ${sourceDir}`);
    }

    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
    const importRoot = path.join(browserDataRoot, 'imports', profileId);
    const importProfileDir = path.join(importRoot, 'Default');
    fs.mkdirSync(importProfileDir, { recursive: true });

    const copied = [];
    const skipped = [];
    const copyItems = [
      'Preferences',
      'Cookies',
      'Login Data',
      'Web Data',
      'History',
      'Bookmarks',
      'Local Storage',
      'IndexedDB',
      'Session Storage',
      'Network',
    ];

    for (const item of copyItems) {
      const source = path.join(sourceDir, item);
      const target = path.join(importProfileDir, item);
      if (!fs.existsSync(source)) {
        skipped.push(item);
        continue;
      }

      try {
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(source, target, { recursive: true, force: true });
        copied.push(item);
      } catch (error) {
        skipped.push(`${item}: ${error.message}`);
      }
    }

    if (copied.length === 0) {
      throw new Error(`Khong copy duoc du lieu nao tu ${profile.display_name}`);
    }

    const importedAt = new Date().toISOString();
    const updatedProfile = this.dbService.markBrowserProfileImported(profileId, importRoot, importedAt);
    this.dbService.saveSettings({
      'browser.importProfileId': profileId,
      'browser.importUserDataDir': importRoot,
      'browser.importedAt': importedAt,
    });

    return {
      success: true,
      profile: updatedProfile,
      importRoot,
      importProfileDir,
      copied,
      skipped,
      importedAt,
      message: `Da import ${copied.length} nhom du lieu tu ${profile.display_name}`,
    };
  }

  removeImportedBrowserData(profileId) {
    const profile = this.dbService.getBrowserProfileById(profileId);
    if (!profile) {
      throw new Error('Khong tim thay browser profile');
    }

    if (profile.import_path && fs.existsSync(profile.import_path)) {
      fs.rmSync(profile.import_path, { recursive: true, force: true });
    }

    this.dbService.clearBrowserProfileImport(profileId);

    const settings = this.dbService.getSettings();
    if (settings['browser.importProfileId'] === profileId) {
      this.dbService.saveSettings({
        'browser.importProfileId': null,
        'browser.importUserDataDir': null,
        'browser.importedAt': null,
      });
    }

    return {
      success: true,
      profileId,
      message: 'Da xoa data import khoi app',
    };
  }

  setActiveImportProfile(profileId) {
    const profile = this.dbService.getBrowserProfileById(profileId);
    if (!profile?.import_path) {
      throw new Error('Profile chua duoc import vao app');
    }

    this.dbService.saveSettings({
      'browser.importProfileId': profileId,
      'browser.importUserDataDir': profile.import_path,
      'browser.importedAt': profile.imported_at || new Date().toISOString(),
    });

    return {
      success: true,
      profile,
      importRoot: profile.import_path,
    };
  }

  listAppRecordingProfiles() {
    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
    const profilesDir = path.join(browserDataRoot, 'profiles');

    if (!fs.existsSync(profilesDir)) return [];

    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        display_name: `Profile ghi — ${entry.name.slice(0, 8)}…`,
        import_path: path.join(profilesDir, entry.name),
        imported_at: null,
        source: 'record',
      }));
  }

  listAppBrowserProfiles() {
    return this.dbService.getImportedBrowserProfiles();
  }

  createBlankAppProfile(displayName = '') {
    const profileId = crypto.randomUUID();
    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
    const importRoot = path.join(browserDataRoot, 'imports', profileId);
    const defaultDir = path.join(importRoot, 'Default');

    fs.mkdirSync(defaultDir, { recursive: true });

    const shortId = profileId.slice(0, 8);
    const finalName = displayName.trim() || `Profile trống ${shortId}`;

    this.dbService.saveBrowserProfile({
      id: profileId,
      browser_key: 'app',
      browser_name: 'RPA Browser',
      profile_name: finalName,
      executable_path: 'internal://rpa',
      user_data_dir: importRoot,
      profile_dir_name: 'Default',
      display_name: finalName,
      source: 'app',
      status: 'active',
    });

    const profile = this.dbService.markBrowserProfileImported(profileId, importRoot);

    return {
      success: true,
      profile,
      importRoot,
      message: `Đã tạo ${finalName}`,
    };
  }

  deleteAppRecordingProfile(folderId) {
    if (!folderId) {
      throw new Error('Thieu id profile ghi');
    }

    const settings = this.dbService.getSettings();
    const browserDataRoot = settings['browser.userDataDir'] || path.join(this.appDataPath, 'browser-data');
    const profileDir = path.join(browserDataRoot, 'profiles', folderId);

    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }

    return {
      success: true,
      folderId,
      message: 'Da xoa profile ghi',
    };
  }

  deleteAppProfile(profile) {
    if (profile?.source === 'record') {
      return this.deleteAppRecordingProfile(profile.id);
    }
    return this.removeImportedBrowserData(profile.id);
  }

  findExecutable(browser, roots) {
    const candidates = [];

    for (const relPath of browser.executablePaths) {
      if (roots.localAppData) candidates.push(path.join(roots.localAppData, ...relPath));
      if (roots.programFiles) candidates.push(path.join(roots.programFiles, ...relPath));
      if (roots.programFilesX86) candidates.push(path.join(roots.programFilesX86, ...relPath));
    }

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  findProfileDirs(userDataDir) {
    const ignoredDirs = new Set([
      'BrowserMetrics',
      'CertificateRevocation',
      'Crashpad',
      'GrShaderCache',
      'Guest Profile',
      'MEIPreload',
      'PnaclTranslationCache',
      'Safe Browsing',
      'ShaderCache',
      'Subresource Filter',
      'SwReporter',
      'System Profile',
      'WidevineCdm',
      'ZxcvbnData',
    ]);

    const dirs = fs
      .readdirSync(userDataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const preferred = dirs.filter((name) => name === 'Default' || /^Profile \d+$/.test(name));
    const withPreferences = preferred.filter((name) => fs.existsSync(path.join(userDataDir, name, 'Preferences')));

    if (withPreferences.length > 0) return withPreferences;
    if (preferred.length > 0) return preferred;

    return dirs
      .filter((name) => !ignoredDirs.has(name))
      .filter((name) => fs.existsSync(path.join(userDataDir, name)));
  }

  readProfileName(userDataDir, profileDirName) {
    const preferencesPath = path.join(userDataDir, profileDirName, 'Preferences');

    try {
      const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
      return preferences.profile?.name || profileDirName;
    } catch {
      return profileDirName;
    }
  }
}

export default BrowserProfileService;
