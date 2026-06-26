import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

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

  resolveSessionUserDataDir(scenarioId, browserProfileId) {
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

    const sessionDir = path.join(browserDataRoot, 'guest', 'sessions', scenarioId);
    fs.mkdirSync(path.join(sessionDir, 'Default'), { recursive: true });
    return sessionDir;
  }

  resolveSessionStartUrl(startUrl) {
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

  _getSessionStoreDir(userDataDir) {
    return path.join(userDataDir, 'rpa-session');
  }

  _getCookiesStorePath(userDataDir) {
    return path.join(this._getSessionStoreDir(userDataDir), 'cookies.json');
  }

  _normalizeCookieForPuppeteer(cookie) {
    const item = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
    };

    if (cookie.expires && Number.isFinite(cookie.expires) && cookie.expires > 0) {
      item.expires = cookie.expires;
    }

    const sameSite = cookie.sameSite;
    if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
      item.sameSite = sameSite;
    }

    return item;
  }

  _hostnameFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  _cookieMatchesHost(cookie, host) {
    if (!host) return true;

    const cookieDomain = String(cookie?.domain || '').toLowerCase().replace(/^\./, '');
    if (!cookieDomain) return false;

    return host === cookieDomain
      || host.endsWith(`.${cookieDomain}`)
      || cookieDomain.endsWith(host);
  }

  _filterCookiesForHost(cookies, host) {
    return cookies.filter((cookie) => this._cookieMatchesHost(cookie, host));
  }

  _buildCookieUrl(cookie) {
    const domain = String(cookie.domain || '').replace(/^\./, '');
    const path = cookie.path || '/';
    const scheme = cookie.secure ? 'https' : 'http';
    return `${scheme}://${domain}${path}`;
  }

  async _setCookiesViaCdp(page, cookies) {
    if (!cookies.length) return 0;

    const client = await page.createCDPSession();
    await client.send('Network.enable').catch(() => {});

    let applied = 0;
    for (const cookie of cookies) {
      try {
        const result = await client.send('Network.setCookie', {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite,
          expires: cookie.expires,
          url: this._buildCookieUrl(cookie),
        });
        if (result?.success) applied += 1;
      } catch {
        // Skip cookies that cannot be applied for this profile.
      }
    }

    await client.detach().catch(() => {});
    return applied;
  }

  _resolveCookieSeedUrl(payload, cookies) {
    const pageUrl = String(payload?.pageUrl || '').trim();
    if (pageUrl.startsWith('http')) return pageUrl;

    const domainCookie = cookies.find((cookie) => cookie?.domain);
    if (!domainCookie?.domain) return null;

    const domain = String(domainCookie.domain).replace(/^\./, '');
    return `https://${domain}/`;
  }

  async _readAllCookies(page) {
    if (!page || page.isClosed()) return [];

    try {
      const client = await page.createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      await client.detach().catch(() => {});
      return Array.isArray(cookies) ? cookies : [];
    } catch {
      return page.cookies().catch(() => []);
    }
  }

  async saveSessionCookies(userDataDir, page) {
    if (!userDataDir || !page || page.isClosed()) {
      return { saved: false, cookieCount: 0 };
    }

    const cookies = await this._readAllCookies(page);
    if (!cookies.length) {
      return { saved: false, cookieCount: 0 };
    }

    const pageHost = this._hostnameFromUrl(page.url());
    const siteCookies = this._filterCookiesForHost(cookies, pageHost);
    const cookiesToSave = (siteCookies.length ? siteCookies : cookies)
      .filter((cookie) => cookie?.name && cookie?.value !== undefined)
      .map((cookie) => this._normalizeCookieForPuppeteer(cookie));

    if (!cookiesToSave.length) {
      return { saved: false, cookieCount: 0 };
    }

    const storeDir = this._getSessionStoreDir(userDataDir);
    fs.mkdirSync(storeDir, { recursive: true });

    const payload = {
      savedAt: new Date().toISOString(),
      pageUrl: page.url(),
      siteHost: pageHost,
      cookies: cookiesToSave,
    };

    fs.writeFileSync(this._getCookiesStorePath(userDataDir), JSON.stringify(payload, null, 2), 'utf8');

    return {
      saved: true,
      cookieCount: payload.cookies.length,
      storePath: this._getCookiesStorePath(userDataDir),
    };
  }

  async restoreSessionCookies(page, userDataDir) {
    const storePath = this._getCookiesStorePath(userDataDir);
    if (!storePath || !fs.existsSync(storePath) || !page || page.isClosed()) {
      return { restored: false, cookieCount: 0, pageUrl: null };
    }

    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
      return { restored: false, cookieCount: 0, pageUrl: null };
    }

    const cookies = Array.isArray(payload?.cookies) ? payload.cookies : [];
    if (!cookies.length) {
      return { restored: false, cookieCount: 0, pageUrl: null };
    }

    const siteHost = payload.siteHost
      || this._hostnameFromUrl(payload.pageUrl)
      || this._hostnameFromUrl(this._resolveCookieSeedUrl(payload, cookies));
    const siteCookies = this._filterCookiesForHost(cookies, siteHost);
    const normalized = (siteCookies.length ? siteCookies : cookies)
      .map((cookie) => this._normalizeCookieForPuppeteer(cookie))
      .filter((cookie) => cookie.name && cookie.value !== undefined);

    if (!normalized.length) {
      return { restored: false, cookieCount: 0, pageUrl: payload.pageUrl || null };
    }

    const seedUrl = this._resolveCookieSeedUrl(payload, normalized);
    if (seedUrl) {
      await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    const appliedCount = await this._setCookiesViaCdp(page, normalized);
    const targetUrl = String(payload.pageUrl || seedUrl || '').trim();

    if (targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    return {
      restored: appliedCount > 0,
      cookieCount: appliedCount,
      pageUrl: targetUrl || payload.pageUrl || null,
    };
  }

  async settlePageBeforeClose(page) {
    if (!page || page.isClosed()) return { cookieCount: 0, hasAuthCookie: false, pageUrl: null };

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null),
        page.waitForFunction(() => document.readyState === 'complete', { timeout: 8000 }).catch(() => null),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // Ignore settle failures.
    }

    const cookies = await this._readAllCookies(page);
    const hasAuthCookie = cookies.some((cookie) => (
      /wordpress_logged_in|wp-settings|session/i.test(cookie.name)
    ));

    return {
      cookieCount: cookies.length,
      hasAuthCookie,
      pageUrl: page.url(),
    };
  }

  async gracefulCloseBrowser(browser, userDataDir, page = null) {
    if (!browser?.isConnected?.()) return { savedCookies: 0 };

    const delayMs = this.getSessionCloseDelayMs();
    const activePage = page && !page.isClosed()
      ? page
      : (await browser.pages().catch(() => []))[0];

    await this.settlePageBeforeClose(activePage);
    const saveResult = await this.saveSessionCookies(userDataDir, activePage);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await browser.close();
    } catch {
      // Browser may already be closed.
    }

    if (userDataDir) {
      await this.waitForProfileUnlock(userDataDir, 15000);
    }

    return saveResult;
  }

  async openBrowserSession({ scenarioId, browserProfileId = null, startUrl = null }) {
    const userDataDir = this.resolveSessionUserDataDir(scenarioId, browserProfileId);
    await this.waitForProfileUnlock(userDataDir);
    const effectiveStartUrl = this.resolveSessionStartUrl(startUrl);
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

  async _launchPuppeteerWithProfile(userDataDir, startUrl = null) {
    const settings = this.dbService.getSettings();
    const viewportWidth = Number(settings['browser.viewportWidth']) || 1280;
    const viewportHeight = Number(settings['browser.viewportHeight']) || 720;

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

    try {
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      for (const extraPage of pages.slice(1)) {
        await extraPage.close().catch(() => {});
      }

      const restoreResult = await this.restoreSessionCookies(page, userDataDir);
      if (!restoreResult.restored) {
        const url = String(startUrl || '').trim();
        if (url) {
          const effectiveUrl = this.resolveSessionStartUrl(url) || url;
          await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        } else {
          await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
      }
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
