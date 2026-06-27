import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import DatabaseService from './database/DatabaseService.js';
import BrowserProfileService from './browser/BrowserProfileService.js';
import { ExecutorService } from './rpa/ExecutorService.js';
import { initRecorderService } from './rpa/RecorderService.js';

// __dirname equivalent trong ESM:
// Trong ES Module, không có __dirname và __filename global.
// Dùng fileURLToPath(import.meta.url) để tính đường dẫn tuyệt đối từ URL của file hiện tại.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {BrowserWindow|null} */
let mainWindow = null;

/** @type {DatabaseService} */
let dbService = null;

/** @type {BrowserProfileService} */
let browserProfileService = null;

/** @type {import('./rpa/RecorderService.js').RecorderService} */
let recorderService = null;

/**
 * Tạo cửa sổ Electron chính.
 * contextIsolation = true, nodeIntegration = false — bảo mật tối đa.
 *
 * ⚠️ ĐƯỜNG DẪN PRELOAD:
 * preload script (.cjs) được resolve bằng đường dẫn tuyệt đối dựa trên __dirname.
 * .cjs là bắt buộc vì package.json có "type": "module" —
 * Electron từ v12+ yêu cầu preload script phải là CommonJS.
 */
function createWindow() {
  // Tính đường dẫn tuyệt đối tới preload.cjs từ vị trí của main.js
  // main.js:  src/main/main.js
  // preload:  src/preload/preload.cjs
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'RPA Social Automation System',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Trong môi trường phát triển, load từ Vite dev server (hot reload)
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load từ build output
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Đăng ký các IPC handlers cho DatabaseService.
 * Renderer gọi qua window.electronAPI.* (được định nghĩa trong preload.cjs).
 *
 * Nguyên tắc:
 * - ipcMain.handle() dùng cho two-way communication (gọi + trả về kết quả).
 * - ipcMain.on() dùng cho one-way communication (fire-and-forget).
 */
function registerDatabaseHandlers() {
  // ===== Proxy Handlers =====

  /**
   * Lấy danh sách tất cả proxy.
   * Renderer gọi: window.electronAPI.getProxies()
   */
  ipcMain.handle('db:get-proxies', () => {
    return dbService.getProxies();
  });

  /**
   * Lưu hoặc cập nhật một proxy.
   * Renderer gọi: window.electronAPI.saveProxy(proxy)
   * Payload nhận: { proxy: {...} }
   */
  ipcMain.handle('db:save-proxy', (_event, { proxy }) => {
    return dbService.saveProxy(proxy);
  });

  /**
   * Xóa proxy theo ID.
   * Renderer gọi: window.electronAPI.deleteProxy(id)
   */
  ipcMain.handle('db:delete-proxy', (_event, id) => {
    return dbService.deleteProxy(id);
  });

  // ===== Browser Profile Handlers =====

  ipcMain.handle('db:get-browser-profiles', () => {
    return dbService.getBrowserProfiles();
  });

  ipcMain.handle('browser:scan-profiles', () => {
    return browserProfileService.scanInstalledBrowserProfiles();
  });

  ipcMain.handle('browser:open-profile', (_event, profileId) => {
    return browserProfileService.openBrowserProfile(profileId);
  });

  ipcMain.handle('browser:open-app-profile', (_event, profile) => {
    return browserProfileService.openAppBrowserProfile(profile);
  });

  ipcMain.handle('browser:open-guest', (_event, options) => {
    if (options && (options.scenarioId || options.browserProfileId)) {
      return browserProfileService.openBrowserSession(options);
    }
    return browserProfileService.openGuestBrowser();
  });

  ipcMain.handle('browser:open-session', (_event, options) => {
    return browserProfileService.openBrowserSession(options || {});
  });

  ipcMain.handle('browser:import-profile', (_event, profileId) => {
    return browserProfileService.importBrowserProfile(profileId);
  });

  ipcMain.handle('browser:remove-imported-data', (_event, profileId) => {
    return browserProfileService.removeImportedBrowserData(profileId);
  });

  ipcMain.handle('browser:set-active-import', (_event, profileId) => {
    return browserProfileService.setActiveImportProfile(profileId);
  });

  ipcMain.handle('browser:list-app-recording-profiles', () => {
    return browserProfileService.listAppRecordingProfiles();
  });

  ipcMain.handle('browser:list-app-browser-profiles', () => {
    return browserProfileService.listAppBrowserProfiles();
  });

  ipcMain.handle('browser:create-blank-profile', (_event, displayName) => {
    return browserProfileService.createBlankAppProfile(displayName);
  });

  ipcMain.handle('browser:delete-app-profile', (_event, profile) => {
    return browserProfileService.deleteAppProfile(profile);
  });

  ipcMain.handle('db:save-browser-profile', (_event, profile) => {
    return dbService.saveBrowserProfile(profile);
  });

  ipcMain.handle('db:delete-browser-profile', (_event, id) => {
    return dbService.deleteBrowserProfile(id);
  });

  ipcMain.handle('settings:get', () => {
    return withDefaultSettings(dbService.getSettings());
  });

  ipcMain.handle('settings:save', (_event, settings) => {
    return withDefaultSettings(dbService.saveSettings(settings));
  });

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await showNativeOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-file', async (_event, filters = []) => {
    const result = await showNativeOpenDialog({
      properties: ['openFile'],
      filters: Array.isArray(filters) && filters.length > 0 ? filters : undefined,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ===== Scenario Handlers =====

  /**
   * Lấy danh sách tất cả kịch bản.
   * Renderer gọi: window.electronAPI.getScenarios()
   */
  ipcMain.handle('db:get-scenarios', () => {
    // Sử dụng prepared statement để query tất cả scenarios
    const scenarios = dbService.db
      .prepare(`
        SELECT s.*, COUNT(st.id) AS steps_count
        FROM scenarios s
        LEFT JOIN scenario_steps st ON st.scenario_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC
      `)
      .all();
    return scenarios.map((scenario) => ({
      ...scenario,
      preview_url: scenario.preview_path
        ? `rpa-cache://file/${Buffer.from(scenario.preview_path).toString('base64url')}`
        : null,
    }));
  });

  /**
   * Lấy chi tiết một kịch bản kèm steps.
   * Renderer gọi: window.electronAPI.getScenarioDetails(id)
   */
  ipcMain.handle('db:get-scenario-details', (_event, id) => {
    return dbService.getScenarioById(id);
  });

  /**
   * Lưu hoặc cập nhật kịch bản + steps (atomic transaction).
   * Renderer gọi: window.electronAPI.saveScenario(scenario, steps)
   * Payload nhận: { scenario: {...}, steps: [...] }
   */
  ipcMain.handle('db:save-scenario', (_event, { scenario, steps }) => {
    return dbService.saveScenario(scenario, steps);
  });

  ipcMain.handle('db:delete-scenario', (_event, id) => {
    return dbService.deleteScenario(id);
  });

  ipcMain.handle('db:get-executions', (_event, limit) => {
    return dbService.getExecutionLogs(limit || 100);
  });

  ipcMain.handle('db:get-execution', (_event, id) => {
    return dbService.getExecutionLogById(id);
  });

  ipcMain.handle('db:clear-executions', () => {
    return dbService.deleteAllExecutionLogs();
  });

  ipcMain.handle('db:get-scenario-variables', (_event, scenarioId) => {
    return dbService.getScenarioVariables(scenarioId);
  });

  ipcMain.handle('db:save-scenario-variable', (_event, variable) => {
    return dbService.saveScenarioVariable(variable);
  });

  ipcMain.handle('db:delete-scenario-variable', (_event, id) => {
    return dbService.deleteScenarioVariable(id);
  });

  ipcMain.handle('db:get-variable-profiles', (_event, scenarioId) => {
    return dbService.getVariableProfiles(scenarioId);
  });

  ipcMain.handle('db:get-variable-profile', (_event, profileId) => {
    return dbService.getVariableProfileById(profileId);
  });

  ipcMain.handle('db:save-variable-profile', (_event, profile) => {
    return dbService.saveVariableProfile(profile);
  });

  ipcMain.handle('db:delete-variable-profile', (_event, id) => {
    return dbService.deleteVariableProfile(id);
  });

  ipcMain.handle('db:save-profile-variable-values', (_event, payload) => {
    return dbService.saveProfileVariableValues(payload?.profileId, payload?.values || []);
  });

  ipcMain.handle('db:build-resolved-variables', (_event, payload) => {
    return dbService.buildResolvedVariables(payload?.scenarioId, payload?.profileId || null);
  });

  ipcMain.handle('scenario:start-recording', async (_event, payload) => {
    return recorderService.startRecording(payload);
  });

  ipcMain.handle('scenario:stop-recording', async () => {
    return recorderService.stopRecording();
  });

  ipcMain.handle('scenario:recording-status', () => {
    return recorderService.getStatus();
  });

  ipcMain.handle('scenario:open-browser', async (_event, payload) => {
    try {
      const scenarioId = payload?.scenarioId || null;
      let browserProfileId = payload?.browserProfileId || payload?.importProfileId || null;
      if (!browserProfileId && scenarioId) {
        const scenario = dbService.getScenarioById(scenarioId);
        browserProfileId = scenario?.browser_profile_id || null;
      }
      const result = await browserProfileService.openBrowserSession({
        scenarioId,
        browserProfileId,
        startUrl: payload?.targetUrl || null,
      });
      return { opened: true, ...result };
    } catch (error) {
      return { opened: false, error: error.message };
    }
  });

  ipcMain.handle('scenario:replay-and-record', async (_event, payload) => {
    // Phat lai cac buoc da ghi, sau do bat dau record de ghi tiep
    // payload: { scenarioId, targetUrl, viewport, importProfileId }
    return recorderService.replayAndRecord(
      payload?.scenarioId,
      payload?.targetUrl || '',
      payload?.viewport || { width: 1280, height: 720 },
      payload?.importProfileId || null,
    );
  });

  ipcMain.handle('scenario:render-video', async (_event, scenarioId) => {
    // Xuat ban video tu cac frame screenshot da chup
    return recorderService.renderVideo(scenarioId);
  });

  ipcMain.handle('scenario:read-frame-data-url', async (_event, filePath) => {
    return readAllowedFrameAsDataUrl(filePath);
  });

  // ===== RPA Campaign Handlers =====

  /**
   * Khởi động campaign (one-way).
   * Renderer gọi: window.electronAPI.startLocalCampaign(campaignId)
   *
   * ExecutorService ủy quyền cho phương thức startScenario của
   * ExecutorService. CampaignId được dùng làm scenarioId tạm thời;
   * khi có module campaign hoàn chỉnh, sẽ load campaign_profiles
   * và lặp qua từng profile.
   */
  // Pool of active executors — each task gets its own instance for true parallel execution.
  const activeExecutors = new Map();

  ipcMain.on('rpa:start-campaign', async (_event, payload) => {
    const scenarioId = typeof payload === 'string' ? payload : payload?.scenarioId;
    const browserProfileId = typeof payload === 'object' ? payload?.browserProfileId || null : null;
    const variableProfileId = typeof payload === 'object' ? payload?.variableProfileId || null : null;
    const headless = typeof payload === 'object' ? Boolean(payload?.headless) : false;
    if (!scenarioId) {
      console.error('[Main] Thiếu scenarioId khi chạy kịch bản');
      return;
    }

    const executionId = crypto.randomUUID();
    const executor = new ExecutorService({
      dbService,
      browserProfileService,
      appDataPath: app.getPath('userData'),
      cacheRoot: path.join(app.getPath('userData'), 'cache'),
      sendTelemetry: (telemetryPayload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rpa:execution-status', telemetryPayload);
        }
      },
    });

    activeExecutors.set(executionId, executor);
    console.log(`[Main] Bắt đầu thực thi ${executionId}: kịch bản=${scenarioId}, headless=${headless}`);

    executor.startScenario(scenarioId, {
      executionId,
      browserProfileId,
      variableProfileId,
      headless,
    })
      .then((result) => console.log(`[Main] Thực thi ${executionId} hoàn tất:`, result))
      .catch((err) => console.error(`[Main] Lỗi thực thi ${executionId}:`, err.message))
      .finally(() => activeExecutors.delete(executionId));
  });
}

function withDefaultSettings(settings) {
  return {
    ...settings,
    'browser.userDataDir':
      settings['browser.userDataDir'] || path.join(app.getPath('userData'), 'browser-data'),
    'execution.browserCloseDelayMs': Number(settings['execution.browserCloseDelayMs']) || 5000,
  };
}

async function showNativeOpenDialog(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  return parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}

async function readAllowedFrameAsDataUrl(filePath) {
  if (!filePath) return null;

  const resolvedFilePath = path.resolve(filePath);
  const comparableFilePath = process.platform === 'win32'
    ? resolvedFilePath.toLowerCase()
    : resolvedFilePath;
  const settings = dbService ? withDefaultSettings(dbService.getSettings()) : {};
  const allowedRoots = [
    path.join(app.getPath('userData'), 'cache'),
    path.join(settings['browser.userDataDir'] || path.join(app.getPath('userData'), 'browser-data'), 'storage'),
  ].map((item) => {
    const resolved = path.resolve(item);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  });

  if (!allowedRoots.some((root) => comparableFilePath.startsWith(root))) {
    throw new Error('Frame path is outside allowed storage.');
  }

  try {
    const data = await fs.readFile(resolvedFilePath);
    const ext = path.extname(resolvedFilePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function registerCacheProtocol() {
  protocol.handle('rpa-cache', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const encodedPath = parsedUrl.hostname === 'file'
        ? parsedUrl.pathname.replace(/^\/+/, '')
        : parsedUrl.hostname;
      const filePath = Buffer.from(encodedPath, 'base64url').toString('utf8');
      const resolvedFilePath = path.resolve(filePath);
      const comparableFilePath = process.platform === 'win32'
        ? resolvedFilePath.toLowerCase()
        : resolvedFilePath;
      const settings = dbService ? withDefaultSettings(dbService.getSettings()) : {};
      const allowedRoots = [
        path.join(app.getPath('userData'), 'cache'),
        path.join(settings['browser.userDataDir'] || path.join(app.getPath('userData'), 'browser-data'), 'storage'),
      ].map((item) => {
        const resolved = path.resolve(item);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      });

      if (!allowedRoots.some((root) => comparableFilePath.startsWith(root))) {
        return new Response('Forbidden', { status: 403 });
      }

      // Xac dinh content-type dua tren phan mo rong file
      const ext = path.extname(resolvedFilePath).toLowerCase();
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.json': 'application/json',
        '.txt': 'text/plain',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      const fileUrl = pathToFileURL(resolvedFilePath).href;
      const response = await net.fetch(fileUrl);
      const body = await response.arrayBuffer();

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Content-Length': String(body.byteLength),
        },
      });
    } catch (error) {
      console.error('[CacheProtocol] Error:', error.message);
      return new Response('Not Found', { status: 404 });
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerCacheProtocol();
  // ===== Khởi tạo DatabaseService =====
  // Dùng app.getPath('userData') để lấy thư mục dữ liệu người dùng.
  // - Development: %APPDATA%/rpa-social-automation trên Windows
  // - Production:  được quản lý bởi electron-builder, cùng cấu trúc
  dbService = new DatabaseService(app.getPath('userData'));
  dbService.open();
  dbService.initSchema();
  browserProfileService = new BrowserProfileService({ dbService, appDataPath: app.getPath('userData') });
  recorderService = initRecorderService({
    appDataPath: app.getPath('userData'),
    dbService,
    browserProfileService,
  });
  console.log('[Main] DatabaseService đã sẵn sàng');

  // Đăng ký IPC handlers (Database + RPA)
  registerDatabaseHandlers();

  console.log('[Main] Đã đăng ký tất cả IPC handlers');

  createWindow();

  // ExecutorService instances are now created per-execution in the rpa:start-campaign handler.

  // macOS: tạo lại cửa sổ khi click vào dock icon
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Đóng database khi tất cả cửa sổ đóng
app.on('window-all-closed', () => {
  if (dbService) dbService.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Đảm bảo đóng database trước khi thoát
app.on('before-quit', () => {
  if (dbService) dbService.close();
});
