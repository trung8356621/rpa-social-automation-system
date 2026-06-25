import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

    const importedAt = new Date().toISOString();
    this.dbService.saveSettings({
      'browser.importProfileId': profileId,
      'browser.importUserDataDir': importRoot,
      'browser.importedAt': importedAt,
    });

    return {
      success: true,
      profile,
      importRoot,
      importProfileDir,
      copied,
      skipped,
      importedAt,
      message: copied.length
        ? `Da import ${copied.length} nhom du lieu tu ${profile.display_name}`
        : `Khong copy duoc du lieu nao tu ${profile.display_name}`,
    };
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
