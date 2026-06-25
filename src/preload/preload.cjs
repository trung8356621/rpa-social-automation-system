/**
 * preload.cjs — Cầu nối an toàn giữa Main Process và Renderer Process.
 *
 * ⚠️ FILE NÀY BẮT BUỘC DÙNG .cjs (CommonJS).
 * Vì package.json có "type": "module", tất cả file .js đều bị coi là ES Module.
 * Electron yêu cầu preload script phải là CommonJS (dùng require).
 * Phần mở rộng .cjs ghi đè cấu hình "type":"module", buộc Node.js xử lý file này
 * theo chuẩn CommonJS — giải quyết triệt để lỗi "preload.js not supported".
 *
 * Nguyên tắc bảo mật:
 * - contextBridge.exposeInMainWorld() để expose API an toàn.
 * - Mọi tương tác đều qua ipcRenderer.invoke() (async, two-way) hoặc
 *   ipcRenderer.send() (one-way, fire-and-forget).
 * - KHÔNG expose nodeIntegration, remote, fs, path, better-sqlite3 hay puppeteer.
 *
 * Renderer chỉ có thể gọi window.electronAPI.* — không có quyền truy cập
 * bất kỳ API Node.js nào.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ===== Database: Scenario APIs =====
  /** Lấy danh sách tất cả kịch bản. */
  getScenarios: () => ipcRenderer.invoke('db:get-scenarios'),

  /** Lấy chi tiết một kịch bản kèm các bước (steps). */
  getScenarioDetails: (id) => ipcRenderer.invoke('db:get-scenario-details', id),

  /** Lưu hoặc cập nhật kịch bản + steps (atomic transaction). */
  saveScenario: (scenario, steps) =>
    ipcRenderer.invoke('db:save-scenario', { scenario, steps }),
  deleteScenario: (id) => ipcRenderer.invoke('db:delete-scenario', id),
  getScenarioVariables: (scenarioId) => ipcRenderer.invoke('db:get-scenario-variables', scenarioId),
  saveScenarioVariable: (variable) => ipcRenderer.invoke('db:save-scenario-variable', variable),
  deleteScenarioVariable: (id) => ipcRenderer.invoke('db:delete-scenario-variable', id),
  importProfileVariables: (payload) => ipcRenderer.invoke('db:import-profile-variables', payload),
  startScenarioRecording: (payload) => ipcRenderer.invoke('scenario:start-recording', payload),
  stopScenarioRecording: () => ipcRenderer.invoke('scenario:stop-recording'),
  getScenarioRecordingStatus: () => ipcRenderer.invoke('scenario:recording-status'),
  openScenarioBrowser: (payload) => ipcRenderer.invoke('scenario:open-browser', payload),
  replayAndRecord: (payload) => ipcRenderer.invoke('scenario:replay-and-record', payload),
  renderScenarioVideo: (scenarioId) => ipcRenderer.invoke('scenario:render-video', scenarioId),
  readFrameDataUrl: (filePath) => ipcRenderer.invoke('scenario:read-frame-data-url', filePath),

  // ===== Database: Proxy APIs =====
  /** Lấy danh sách tất cả proxy. */
  getProxies: () => ipcRenderer.invoke('db:get-proxies'),

  /** Lưu hoặc cập nhật một proxy. */
  saveProxy: (proxy) => ipcRenderer.invoke('db:save-proxy', { proxy }),

  /** Xóa proxy theo ID. */
  deleteProxy: (id) => ipcRenderer.invoke('db:delete-proxy', id),

  // ===== Database: Profile APIs =====
  /** Lấy danh sách tất cả profile (kèm proxy_name). */
  getProfiles: () => ipcRenderer.invoke('db:get-profiles'),

  /** Lưu hoặc cập nhật một profile. */
  saveProfile: (profile) => ipcRenderer.invoke('db:save-profile', { profile }),

  /** Xóa profile theo ID. */
  deleteProfile: (id) => ipcRenderer.invoke('db:delete-profile', id),

  getBrowserProfiles: () => ipcRenderer.invoke('db:get-browser-profiles'),
  scanBrowserProfiles: () => ipcRenderer.invoke('browser:scan-profiles'),
  openBrowserProfile: (profileId) => ipcRenderer.invoke('browser:open-profile', profileId),
  importBrowserProfile: (profileId) => ipcRenderer.invoke('browser:import-profile', profileId),
  saveBrowserProfile: (profile) => ipcRenderer.invoke('db:save-browser-profile', profile),
  deleteBrowserProfile: (id) => ipcRenderer.invoke('db:delete-browser-profile', id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ===== RPA: Campaign Execution APIs =====
  /**
   * Khởi động campaign.
   * Dùng ipcRenderer.send() (one-way) vì đây là lệnh fire-and-forget,
   * trạng thái thực thi được cập nhật qua event listener bên dưới.
   */
  startLocalCampaign: (campaignId) => {
    ipcRenderer.send('rpa:start-campaign', campaignId);
  },

  // ===== Event Listeners (Main → Renderer) =====
  /**
   * Đăng ký listener nhận cập nhật trạng thái thực thi từ Main Process.
   * Trả về hàm cleanup để React component gọi trong useEffect cleanup.
   *
   * @param {Function} callback - Hàm nhận (event, data) khi có cập nhật.
   * @returns {Function} Hàm dọn dẹp (remove listener).
   */
  onExecutionUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('rpa:execution-status', handler);

    // Trả về hàm cleanup để tránh memory leak khi component unmount
    return () => {
      ipcRenderer.removeListener('rpa:execution-status', handler);
    };
  },
});
