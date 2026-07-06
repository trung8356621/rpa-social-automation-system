# Hệ Thống RPA Social Automation

Ứng dụng RPA **local-first, offline-capable** sử dụng Electron + React + SQLite cho tự động hóa mạng xã hội. Hệ thống có kiến trúc dual-build (Master/Slave), tự động hóa trình duyệt dựa trên Puppeteer, crawl dữ liệu Facebook GraphQL, studio timeline kịch bản trực quan, quản lý chống phát hiện (anti-detect) profile, và giao diện song ngữ (Tiếng Việt / English).

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#tổng-quan-kiến-trúc)
2. [Vai Trò Build (Master vs Slave)](#vai-trò-build-master-vs-slave)
3. [Bắt Đầu Nhanh](#bắt-đầu-nhanh)
4. [Cấu Trúc Dự Án](#cấu-trúc-dự-án)
5. [Tài Liệu Kiến Trúc](#tài-liệu-kiến-trúc)
6. [Bất Biến Kiến Trúc (Luật Bất Di Bất Dịch)](#bất-biến-kiến-trúc-luật-bất-di-bất-dịch)
7. [Ranh Giới IPC](#ranh-giới-ipc)
8. [Các Lệnh Hữu Ích](#các-lệnh-hữu-ích)
9. [Cursor Skills](#cursor-skills)

---

## Tổng Quan Kiến Trúc

```
┌──────────────────────────────────────────────────────────────┐
│                    Renderer (React + Vite)                   │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Sidebar  │  │ GlobalHeader │  │ Main Content Area       │ │
│  │ (nav)    │  │ (view/lang)  │  │ (page routing)          │ │
│  └──────────┘  └──────────────┘  └────────────────────────┘ │
│                      │ window.electronAPI.*                   │
├──────────────────────┴───────────────────────────────────────┤
│                   Preload (preload.cjs)                       │
│          contextBridge → ipcRenderer.invoke / .send            │
├──────────────────────┴───────────────────────────────────────┤
│                    Main Process (Electron)                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ DatabaseService│  │ BrowserProfile │  │ ExecutorService │  │
│  │ (better-sqlite3)│  │ Service        │  │ (Puppeteer RPA) │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │PlatformCrawled │  │RecorderService │  │EmbeddedBrowser │  │
│  │DataService     │  │(CDP screencast) │  │Service (webview)│  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Stack:** Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit.  
**Database:** `better-sqlite3` (chỉ trong main process).  
**Automation:** Puppeteer 22 trong `src/main/rpa/`.  
**Node:** v22.2.0, ESM (`.js`) với CommonJS preload (`.cjs`).

---

## Vai Trò Build (Master vs Slave)

Ứng dụng có hai vai trò được điều khiển bởi biến môi trường `VITE_APP_ROLE`. Vai trò được gán tại **thời điểm build Vite** cho renderer và đọc từ `process.env` tại **thời điểm khởi động Electron** cho main process.

| Tính năng | Master (`VITE_APP_ROLE=master`) | Slave (`VITE_APP_ROLE=slave`) |
|---------|----------------------------------|-------------------------------|
| **Mục đích** | Workstation chính — thiết kế & quản lý dữ liệu | Agent thực thi nhẹ |
| **Global Header** | View switcher + chuyển đổi ngôn ngữ | Ẩn |
| **Facebook Data Studio** | UI crawl + duyệt đầy đủ | Vô hiệu hóa |
| **Platform Crawled DB** | Đọc/ghi qua IPC | Service không khởi động |
| **Sidebar** | Điều hướng đầy đủ | Chỉ Scenarios, Executions, Browser, Settings |
| **Main SQLite** | Truy cập đầy đủ | Chỉ Scenarios + execution |

```bash
# Đặt role trong .env:
VITE_APP_ROLE=master   # hoặc slave

# Phát triển:
npm run dev            # master (mặc định)
npm run dev:slave      # slave agent UI

# Build:
npm run build:renderer:master
npm run build:renderer:slave
```

Hằng số role: `src/shared/appRole.js`.  
Cấu hình main process: `src/main/appRoleConfig.js`.  
Cấu hình renderer: `src/renderer/utils/appRole.js`.

---

## Bắt Đầu Nhanh

```bash
npm install
npm run rebuild          # Rebuild better-sqlite3 cho Electron ABI
cp .env.example .env     # Tùy chọn; mặc định là master
npm run dev              # Chế độ master
```

**Yêu cầu:** Node.js LTS 22.2.0+, FFmpeg trong PATH để xuất video preview.

---

## Cấu Trúc Dự Án

```
src/
├── shared/              # Hằng số dùng chung, GraphQL parser, scroll helpers
├── main/
│   ├── browser/         # BrowserProfileService, SessionPaths, CookieSync, EmbeddedBrowser
│   ├── config/          # loadEnv
│   ├── database/        # DatabaseService, PlatformCrawledDataService
│   ├── media/           # FacebookPostImageDownloader
│   ├── rpa/             # ExecutorService, RecorderService, PuppeteerCapture, v.v.
│   └── scenario/        # ScenarioBundleZip
├── preload/             # preload.cjs (CommonJS contextBridge)
└── renderer/
    ├── components/      # UI tái sử dụng: ScenarioEditor, CrawlPreview, GlobalHeader, v.v.
    ├── i18n/            # Locales song ngữ (vi, en)
    ├── pages/           # Component cấp trang
    ├── slices/          # Redux Toolkit slices
    ├── store/           # Redux store
    ├── utils/           # appRole, exportTableCsv, crawlWidget, v.v.
    └── views/           # Sub-views (ProxiesView, v.v.)
```

---

## Tài Liệu Kiến Trúc

Các đặc tả kiến trúc chi tiết cho từng module chính có sẵn trong `docs/arch-routes/`. Mỗi tài liệu bao gồm luồng kỹ thuật đầy đủ, ánh xạ schema database, kênh IPC, bất biến (invariants) và tham chiếu file nguồn chính.

| Tài liệu | Module | Router Path |
|----------|--------|-------------|
| [01 — Studio Editor](docs/arch-routes/01_studio_editor.md) | Scenario timeline, CDP frame capture, xuất fluent-ffmpeg | `/studio/editor` |
| [02 — Facebook Crawl Group](docs/arch-routes/02_facebook_crawl_group.md) | Group feed crawl, GraphQL interception, parser invariants, lưu trữ | `/data/facebook` |
| [03 — Visual Scraper Mode](docs/arch-routes/03_visual_scraper_mode.md) | Web scraper wizard, design mode, lọc DOM, bảng data preview | `/data/scraper-mode` |
| [04 — Profile Management](docs/arch-routes/04_profile_management.md) | Cô lập browser profile, session partition, định tuyến proxy, cookie persistence | `/profiles/manage` |
| [05 — Database Schema](docs/arch-routes/05_database_schema.md) | Bố cục hai database, schema bảng đầy đủ, tracking lỗi đa hình | System Infrastructure |

---

## Bất Biến Kiến Trúc (Luật Bất Di Bất Dịch)

Đây là các quy tắc kiến trúc **không thể thương lượng** được thực thi trên toàn bộ mã nguồn:

### Không DOM Scraping Cho Dữ Liệu Mạng Xã Hội

Trích xuất dữ liệu mạng xã hội từ các phần tử HTML UI là **bất hợp pháp**. `querySelector` hoặc accessibility tree scraping **bị nghiêm cấm**. Dữ liệu chỉ được lấy từ:

- **GraphQL network interception** (Facebook: endpoint `/api/graphql/` qua `RequestCatchingPuppeteerCapture`).
- **REST API interception** (tương lai: LinkedIn `/voyager/api/...`, v.v.).

`page.evaluate()` chỉ có thể đọc runtime tokens hoặc gọi JSON endpoints, **không bao giờ** được trích xuất nội dung bài viết, tác giả, ngày tháng hoặc thống kê từ HTML.

### Centralized Random Delay

Các khoảng chờ tĩnh được hardcode (`setTimeout(3000)`) bị nghiêm cấm tuyệt đối. Mọi độ trễ tương tác trình duyệt phải thông qua:

```javascript
function randomRuntimeDelay(baseMs, minMs = 120, maxMs = 1500) {
  const factor = 0.7 + Math.random() * 1.1;   // [0.75, 1.4]
  return Math.round(Math.max(minMs, Math.min(maxMs, baseMs * factor)));
}
```

Điều này áp dụng cho: clicks, độ trễ gõ từng ký tự, tạm dừng cuộn, chờ settle và chờ điều hướng.

### Macro Scenario Roles

Các scenario được phân loại nghiêm ngặt theo `scenario_type`:

| Type | Mục đích |
|------|---------|
| `prepare` | Tạo session profile thủ công / login cookies. Không ràng buộc `browser_profile_id`. |
| `crawl` | DOM extraction dạng cây/vòng lặp (visual scraper). |
| `action` | Timeline đăng bài tương tác mạng xã hội. |
| `request_catching` | GraphQL network interception để trích xuất feed/post/comment. |
| `interact` *(tương lai)* | Vòng lặp mô phỏng hành vi người dùng ngẫu nhiên chống bot. |
| `check` *(tương lai)* | Xác minh trạng thái live/die nhẹ. |

### Các Bất Biến Bổ Sung

- **Bảo mật Electron:** `contextIsolation: true`, `nodeIntegration: false`. Không bao giờ expose Node modules, `better-sqlite3` hoặc Puppeteer cho renderer.
- **ID:** Định danh UUID v4 dạng TEXT (`crypto.randomUUID()`), không bao giờ dùng autoincrement integers.
- **Lưu trữ JSON:** Các trường JSON được lưu dưới dạng TEXT trong SQLite, deserialize trước khi trả về UI.
- **Migrate:** Schema migrations có tính idempotent, an toàn để chạy mỗi lần khởi động.
- **Cô lập Platform DB:** Mỗi nền tảng có file SQLite độc lập tại `{userData}/data/{platform}_crawled_data.db`.
- **Cô lập Comment:** GraphQL payloads chỉ chứa comment (`_comments_only: true`) không bao giờ được tạo dòng post mới hoặc rò rỉ vào `post_content`.
- **Bảo vệ Master/Slave:** API chỉ dành cho Master được bảo vệ bởi `assertMasterFacebookDataAccess()` trong IPC handlers của main process.

---

## Ranh Giới IPC

Renderer chỉ gọi backend thông qua `window.electronAPI` (`src/preload/preload.cjs`).

### Các Mẫu Chính

| Pattern | Phương thức | Trường hợp sử dụng |
|---------|--------|----------|
| Request-Response | `ipcMain.handle` + `ipcRenderer.invoke` | CRUD operations, truy vấn dữ liệu |
| Fire-and-Forget | `ipcMain.on` + `ipcRenderer.send` | Khởi chạy campaign, lệnh |
| Events (Main → Renderer) | `webContents.send` + `ipcRenderer.on` | Tiến trình thực thi, cập nhật trạng thái |

### Thêm Một Khả Năng Mới

1. Triển khai hành vi main-process (phương thức service).
2. Đăng ký một IPC channel có kiểu trong `src/main/main.js`.
3. Expose một wrapper hẹp trong `src/preload/preload.cjs`.
4. Chỉ gọi wrapper preload từ React/Redux.
5. Bảo vệ API chỉ dành cho Master với `assertMasterFacebookDataAccess()`.

---

## Các Lệnh Hữu Ích

| Lệnh | Mô tả |
|---------|-------------|
| `npm run dev` | Master — chế độ dev Vite + Electron |
| `npm run dev:slave` | Slave — UI agent nhẹ |
| `npm run build:renderer` | Build renderer (dùng role từ `.env`) |
| `npm run build:renderer:master` | Build renderer master |
| `npm run build:renderer:slave` | Build renderer slave |
| `npm run build` | Build renderer + electron-builder package |
| `npm run rebuild` | Rebuild `better-sqlite3` cho Electron ABI |
| `npm run rebuild:manual` | Thủ công `@electron/rebuild -f -w better-sqlite3` |

---

## Cursor Skills

- **Facebook Crawl Data:** `.cursor/skills/facebook-crawl-data/SKILL.md` — sử dụng khi chỉnh sửa Facebook crawl, GraphQL parsing, tải media, hoặc platform DB persistence.
- **Master/Slave Layout:** `.cursor/skills/master-slave-layout/SKILL.md` — sử dụng khi chỉnh sửa bố cục ứng dụng, chuyển đổi view, hoặc phân chia vai trò.
- **Codebase Memory:** MCP tool `codebase-memory` lập chỉ mục toàn bộ repository. Chạy `CallMcpTool` → `get_architecture` để khám phá clusters, hotspots và dependency graphs.

---

> **Giấy phép:** Xem chủ sở hữu repository để biết điều khoản giấy phép.
