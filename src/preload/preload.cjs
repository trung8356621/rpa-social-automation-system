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
  setScenarioPinned: (id, isPinned) => ipcRenderer.invoke('db:set-scenario-pinned', { id, isPinned }),
  getTasks: () => ipcRenderer.invoke('db:get-tasks'),
  getTask: (id) => ipcRenderer.invoke('db:get-task', id),
  saveTask: (task) => ipcRenderer.invoke('db:save-task', task),
  deleteTask: (id) => ipcRenderer.invoke('db:delete-task', id),
  getExecutions: (limit) => ipcRenderer.invoke('db:get-executions', limit),
  getExecution: (id) => ipcRenderer.invoke('db:get-execution', id),
  clearExecutions: () => ipcRenderer.invoke('db:clear-executions'),
  getScenarioVariables: (scenarioId) => ipcRenderer.invoke('db:get-scenario-local-variables', scenarioId),
  getScenarioLocalVariables: (scenarioId) => ipcRenderer.invoke('db:get-scenario-local-variables', scenarioId),
  saveScenarioLocalVariables: (payload) => ipcRenderer.invoke('db:save-scenario-local-variables', payload),
  saveScenarioVariable: (variable) => ipcRenderer.invoke('db:save-scenario-variable', variable),
  deleteScenarioVariable: (id) => ipcRenderer.invoke('db:delete-scenario-variable', id),
  getVariableProfiles: () => ipcRenderer.invoke('db:get-variable-profiles'),
  getVariableProfile: (profileId) => ipcRenderer.invoke('db:get-variable-profile', profileId),
  saveVariableProfile: (profile) => ipcRenderer.invoke('db:save-variable-profile', profile),
  saveVariableProfileQuick: (payload) => ipcRenderer.invoke('db:save-variable-profile-quick', payload),
  deleteVariableProfile: (id) => ipcRenderer.invoke('db:delete-variable-profile', id),
  getVariableProfileSamples: (profileId) => ipcRenderer.invoke('db:get-variable-profile-samples', profileId || null),
  getVariableProfileSample: (sampleId) => ipcRenderer.invoke('db:get-variable-profile-sample', sampleId),
  saveVariableProfileSample: (sample) => ipcRenderer.invoke('db:save-variable-profile-sample', sample),
  saveVariableProfileSampleQuick: (payload) => ipcRenderer.invoke('db:save-variable-profile-sample-quick', payload),
  deleteVariableProfileSample: (id) => ipcRenderer.invoke('db:delete-variable-profile-sample', id),
  setScenarioVariableProfile: (payload) => ipcRenderer.invoke('db:set-scenario-variable-profile', payload),
  exportScenarioLocalVariables: (scenarioId) => ipcRenderer.invoke('db:export-scenario-local-variables', scenarioId),
  importScenarioLocalVariables: (scenarioId) => ipcRenderer.invoke('db:import-scenario-local-variables', scenarioId),
  exportScenario: (scenarioId) => ipcRenderer.invoke('db:export-scenario', scenarioId),
  importScenario: () => ipcRenderer.invoke('db:import-scenario'),
  buildResolvedVariables: (payload) => ipcRenderer.invoke('db:build-resolved-variables', payload),
  startScenarioRecording: (payload) => ipcRenderer.invoke('scenario:start-recording', payload),
  stopScenarioRecording: () => ipcRenderer.invoke('scenario:stop-recording'),
  getScenarioRecordingStatus: () => ipcRenderer.invoke('scenario:recording-status'),
  openScenarioBrowser: (payload) => ipcRenderer.invoke('scenario:open-browser', payload),
  attachCrawlPreview: (payload) => ipcRenderer.invoke('scenario:crawl-preview:attach', payload),
  detachCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:detach'),
  setCrawlPreviewBounds: (bounds) => ipcRenderer.invoke('scenario:crawl-preview:set-bounds', bounds),
  navigateCrawlPreview: (payload) => ipcRenderer.invoke('scenario:crawl-preview:navigate', payload),
  reloadCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:reload'),
  backCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:back'),
  forwardCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:forward'),
  getCrawlPreviewState: () => ipcRenderer.invoke('scenario:crawl-preview:state'),
  setCrawlDesignMode: (payload) => ipcRenderer.invoke('scenario:crawl-preview:set-design-mode', payload),
  openCrawlDevTools: () => ipcRenderer.invoke('scenario:crawl-preview:open-devtools'),
  highlightCrawlAnchor: (anchor) => ipcRenderer.invoke('scenario:crawl-preview:highlight-anchor', anchor),
  clearCrawlHighlight: () => ipcRenderer.invoke('scenario:crawl-preview:clear-highlight'),
  extractCrawlPreviewSample: (payload) => ipcRenderer.invoke('scenario:crawl-preview:extract-sample', payload),
  promoteCrawlSelectorToParent: (anchor) => ipcRenderer.invoke('scenario:crawl-preview:promote-to-parent', anchor),
  zoomInCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:zoom-in'),
  zoomOutCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:zoom-out'),
  findInCrawlPreview: (payload) => ipcRenderer.invoke('scenario:crawl-preview:find-in-page', payload),
  stopFindInCrawlPreview: () => ipcRenderer.invoke('scenario:crawl-preview:stop-find-in-page'),
  onCrawlOpenFindBar: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('crawl:open-find-bar', handler);
    return () => ipcRenderer.removeListener('crawl:open-find-bar', handler);
  },
  onCrawlPreviewState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('crawl:preview-state', handler);
    return () => ipcRenderer.removeListener('crawl:preview-state', handler);
  },
  onCrawlDesignPick: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('crawl:design-pick', handler);
    return () => ipcRenderer.removeListener('crawl:design-pick', handler);
  },
  openCrawlPreviewExternal: (url) => ipcRenderer.invoke('scenario:crawl-preview:open-external', url),
  startRequestCatchingPreview: (payload) => ipcRenderer.invoke('scenario:request-catching:start', payload),
  stopRequestCatchingPreview: () => ipcRenderer.invoke('scenario:request-catching:stop'),
  setRequestCatchingAuto: (payload) => ipcRenderer.invoke('scenario:request-catching:set-auto', payload),
  loadRequestCatchingDump: (scenarioId) => ipcRenderer.invoke('scenario:request-catching:load-dump', scenarioId),
  saveRequestCatchingDump: (payload) => ipcRenderer.invoke('scenario:request-catching:save-dump', payload),
  clearRequestCatchingDump: (scenarioId) => ipcRenderer.invoke('scenario:request-catching:clear-dump', scenarioId),
  getRequestCatchingDumpPath: (scenarioId) => ipcRenderer.invoke('scenario:request-catching:get-dump-path', scenarioId),
  onRequestCatchingCaptured: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('request-catching:captured', handler);
    return () => ipcRenderer.removeListener('request-catching:captured', handler);
  },
  onRequestCatchingDiscovered: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('request-catching:discovered', handler);
    return () => ipcRenderer.removeListener('request-catching:discovered', handler);
  },
  onRequestCatchingReset: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('request-catching:reset', handler);
    return () => ipcRenderer.removeListener('request-catching:reset', handler);
  },
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

  getBrowserProfiles: () => ipcRenderer.invoke('db:get-browser-profiles'),
  scanBrowserProfiles: () => ipcRenderer.invoke('browser:scan-profiles'),
  openBrowserProfile: (profileId) => ipcRenderer.invoke('browser:open-profile', profileId),
  openAppBrowserProfile: (profile) => ipcRenderer.invoke('browser:open-app-profile', profile),
  openGuestBrowser: (options) => ipcRenderer.invoke('browser:open-session', options || {}),
  openBrowserSession: (options) => ipcRenderer.invoke('browser:open-session', options),
  importBrowserProfile: (profileId) => ipcRenderer.invoke('browser:import-profile', profileId),
  removeImportedBrowserData: (profileId) => ipcRenderer.invoke('browser:remove-imported-data', profileId),
  setActiveImportProfile: (profileId) => ipcRenderer.invoke('browser:set-active-import', profileId),
  listAppRecordingProfiles: () => ipcRenderer.invoke('browser:list-app-recording-profiles'),
  listAppBrowserProfiles: () => ipcRenderer.invoke('browser:list-app-browser-profiles'),
  createBlankBrowserProfile: (displayName) => ipcRenderer.invoke('browser:create-blank-profile', displayName),
  deleteAppBrowserProfile: (profile) => ipcRenderer.invoke('browser:delete-app-profile', profile),
  saveBrowserProfile: (profile) => ipcRenderer.invoke('db:save-browser-profile', profile),
  deleteBrowserProfile: (id) => ipcRenderer.invoke('db:delete-browser-profile', id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  getFacebookDataStats: () => ipcRenderer.invoke('facebook-data:get-stats'),
  listFacebookGroups: (options) => ipcRenderer.invoke('facebook-data:list-groups', options),
  listFacebookAuthors: (options) => ipcRenderer.invoke('facebook-data:list-authors', options),
  listFacebookPosts: (options) => ipcRenderer.invoke('facebook-data:list-posts', options),
  listFacebookComments: (options) => ipcRenderer.invoke('facebook-data:list-comments', options),
  deleteFacebookPost: (payload) => ipcRenderer.invoke('facebook-data:delete-post', payload),
  resolveFacebookMediaUrl: (relativePath) => ipcRenderer.invoke('facebook-data:resolve-media-url', relativePath),
  openFacebookMediaFile: (relativePath) => ipcRenderer.invoke('facebook-data:open-media-file', relativePath),
  exportFacebookDataCsv: (payload) => ipcRenderer.invoke('facebook-data:export-csv', payload),

  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ===== RPA: Campaign Execution APIs =====
  /**
   * Khởi động campaign.
   * Dùng ipcRenderer.send() (one-way) vì đây là lệnh fire-and-forget,
   * trạng thái thực thi được cập nhật qua event listener bên dưới.
   */
  startLocalCampaign: (payload) => {
    ipcRenderer.send('rpa:start-campaign', payload);
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
