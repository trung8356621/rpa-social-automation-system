# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports English and Vietnamese UI.

The app ships in two **build roles**: **master** (full studio + data management) and **slave** (lightweight execution agent).

---

## Current Status

- **Master / Slave builds** via `VITE_APP_ROLE` (`master` | `slave`). Slave hides Global Header and Facebook Data; master has full studio.
- **Global Header** (master only): view switcher (Scenarios / Facebook Data) + quick language toggle synced with Settings (`app.language`).
- **Facebook Data Studio** (master only): full-width UI to browse `facebook_crawled_data.db` — filter by group, posts/comments tabs, CSV export.
- **Facebook Data settings** (master only): bind crawl scenarios for group posts and comments; system variable profiles auto-seeded.
- **Request catching scenarios** (`scenario_type = request_catching`): intercept Facebook GraphQL API responses while browsing; offline dump analysis; final JSON result preview.
- **Facebook GraphQL parser** (`src/shared/parseFacebookGraphQL.js`): normalizes posts/comments from raw GraphQL payloads; enriches missing `post_id` / `group_id` / `post_link` from scenario variables or target URL before DB save.
- Scenario list supports grouped display by the first name token (`WP login` → `WP`, `omi_channel` → `omi`).
- Scenarios can be pinned; pin state persists in SQLite (`scenarios.is_pinned`).
- **Crawl scenarios** (`scenario_type = crawl`): embedded browser, Design mode, crawl widgets, live sample preview.
- **Crawl execution** via `ExecutorService` with autoscroll / infinite scroll (modal-aware scroll for Facebook post dialogs).
- **Scenario variables** (`local_variables`) and data profiles with `{{variable}}` template resolution in target URLs and scroll stop conditions.
- **Tasks** page: visual flow builder (prepare / crawl / action nodes).
- Renderer builds verified: `npm run build:renderer`, `npm run build:renderer:slave`.

## Build Roles (Master vs Slave)

| | Master (`VITE_APP_ROLE=master`) | Slave (`VITE_APP_ROLE=slave`) |
|---|--------------------------------|-------------------------------|
| **Purpose** | Main workstation — design, data, reporting | Remote agent — run scenarios only |
| **Global Header** | Yes (view + language) | Hidden |
| **Facebook Data Studio** | Yes | Disabled |
| **Sidebar** | Full navigation | Scenarios, Executions, Browser, Settings only |
| **Platform crawled SQLite** | Read/write via IPC | Service not started; IPC rejected |
| **Main app SQLite** | Full (scenarios, executions, …) | Scenarios + execution (no data-profile studio pages) |

Configuration:

```bash
# Copy and edit
cp .env.example .env
# VITE_APP_ROLE=master   # or slave
```

**Important:** Renderer role is baked at **Vite build time** (`import.meta.env`). Main process reads `process.env.VITE_APP_ROLE` at **Electron startup**. Use matching scripts so both sides agree:

```bash
npm run dev                 # master (default)
npm run dev:slave           # slave agent UI

npm run build:renderer:master
npm run build:renderer:slave
npm run build               # packages current dist/renderer
```

Role logic lives in `src/shared/appRole.js` (shared constants + `SLAVE_ALLOWED_PAGES`).

## Layout Overview

```text
┌─────────────────────────────────────────────────────┐
│ GlobalHeader (master only)                          │
│  [View: Scenarios ▼]              [Language toggle] │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │ Main content                             │
│ or       │  • scenarios view → Dashboard, Scenarios,  │
│ Facebook │    Tasks, Executions, Settings, …          │
│ Sidebar  │  • facebookData view → Facebook Data     │
│ (master) │    Studio / Crawl settings (full-width)   │
└──────────┴──────────────────────────────────────────┘
```

**Redux UI state** (`src/renderer/slices/uiSlice.js`):

- `currentView`: `'scenarios'` | `'facebookData'` (master only)
- `currentPage`: page within scenarios view (`scenarios`, `executions`, …)
- `facebookDataPage`: `'studio'` | `'settings'` (within Facebook Data view)

**Key components:**

| File | Role |
|------|------|
| `src/renderer/App.jsx` | Root layout, role enforcement, page routing |
| `src/renderer/components/GlobalHeader.jsx` | View switcher + language (master) |
| `src/renderer/components/Sidebar.jsx` | Icon nav; filtered on slave |
| `src/renderer/components/FacebookSidebar.jsx` | Studio / Settings nav inside Facebook Data view |
| `src/renderer/pages/FacebookDataPage.jsx` | Facebook Data Studio |
| `src/renderer/pages/FacebookDataSettingsPage.jsx` | Facebook crawl scenario bindings |

## Facebook Data Studio

Master-only, full-width page (no embedded browser).

**Filters (top bar):**

- Platform — currently Facebook (extensible dropdown)
- Group — loaded from `groups` table in `facebook_crawled_data.db`

**Tabs:**

1. **Posts** — `post_author`, truncated `post_content`, clickable `post_link`, `crawled_at`
2. **Comments** — click a post row to load comments by `post_id` and switch to this tab

**Export:** top-right **Export Excel / CSV** exports the active tab (UTF-8 BOM for Excel).

**Database file:** `%APPDATA%/rpa-social-automation/data/facebook_crawled_data.db` (or electron `userData/data/`)

**Schema (platform DB, separate from main app DB):**

- `groups` — `group_id`, `group_name`, `group_link`
- `authors` — `author_id`, `author_name`, `author_link`
- `posts` — `post_id`, `group_id`, `author_id`, `post_link`, `post_content`, `crawled_at`
- `comments` — `comment_id`, `post_id`, `author_id`, `comment_content`, `crawled_at`

**Service:** `src/main/database/PlatformCrawledDataService.js` (master only).

Posts without `post_id` are skipped on save. Request-catching runs enrich parsed results from scenario variables so comment-only GraphQL payloads still persist correctly.

## Facebook Crawl Settings

Accessible from **Facebook Data → Settings** (master only, via `FacebookSidebar`).

| Setting | Purpose |
|---------|---------|
| Group crawl scenario | `crawl` or `request_catching` scenario for scanning group feed posts |
| Comment crawl scenario | `crawl` or `request_catching` scenario for scanning comments on a single post |

Settings keys (in main app `settings` table):

- `facebook.crawlGroupScenarioId`
- `facebook.crawlCommentScenarioId`

On save, the app binds each scenario to a **system variable profile** (cannot be deleted):

| Profile | Variables | Use |
|---------|-----------|-----|
| `__system:facebook-crawl-group` | `group_id`, `last_date` | Group feed crawl; `last_date` for infinite-scroll stop |
| `__system:facebook-crawl-comment` | `group_id`, `post_id` | Comment crawl; `post_id` from post link or variable |

Helpers: `src/shared/facebookCrawlConfig.js` (`parseFacebookPostLink`, `buildFacebookPostLink`, `enrichFacebookCrawlPosts`, …).

**Typical comment crawl target URL:**

```text
https://www.facebook.com/groups/{{group_id}}/posts/{{post_id}}/
```

Variables are resolved in preview, execution, and final result enrichment.

## Request Catching Scenarios

Fourth scenario type: `request_catching` (alongside `prepare`, `crawl`, `action`).

**Workflow:**

1. Set platform (Facebook) and target URL with `{{variables}}`.
2. Define **Scenario variables** (`local_variables`) — e.g. `group_id`, `post_id`.
3. Browse in embedded browser; the app intercepts matching GraphQL network responses.
4. Configure request filters in scenario meta (`scenario_meta.request_catching.filters`).
5. Preview **Final result** — parsed posts/comments JSON.
6. Optional: save session dump for offline analysis (`debug_dumps/`).
7. On execution, `ExecutorService` captures live via Puppeteer CDP and saves to platform DB (master).

**Key files:**

| File | Role |
|------|------|
| `src/renderer/components/RequestCatchingScenarioEditorContent.jsx` | Editor UI: capture, offline dump, final result |
| `src/main/rpa/RequestCatchingPuppeteerCapture.js` | CDP capture during execution |
| `src/main/browser/ScenarioEmbeddedBrowserService.js` | Embedded preview + listen-only capture |
| `src/shared/parseFacebookGraphQL.js` | Parse + enrich GraphQL batches |
| `src/shared/crawlScroll.js` | Modal-aware autoscroll (Facebook post dialogs) |

**Result enrichment:** when GraphQL returns orphan comments without a post node, `enrichFacebookCrawlPosts()` fills `post_id`, `group_id`, and `post_link` from scenario variables or the resolved target URL so database writes stay consistent.

## Features

- **Dual build:** master studio vs slave execution agent.
- **Global Header:** bilingual quick switch + Scenarios / Facebook Data views (master).
- **Facebook Data Studio:** browse, filter, drill into comments, export CSV.
- **Facebook crawl settings:** scenario bindings + system variable profiles.
- **Request catching:** intercept API responses, parse GraphQL, preview and persist structured data.
- Browser profiles and session persistence per app profile.
- Scenario studio: record, edit timeline, preview, replay Puppeteer steps.
- **Four scenario types:** `prepare`, `crawl`, `action`, `request_catching`.
- **Crawl design studio:** Design mode, parent selectors, `full_html` / `patterns` result modes.
- Scenario variables and data profiles (`{{variable}}` in URLs and conditions).
- **Task builder:** connect prepare, crawl, and action scenarios.
- Execution: parallel runs, headless mode, history with crawl summaries.
- Proxy management: HTTP/SOCKS.

## Stack

- Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit.
- SQLite via `better-sqlite3` in main process only.
- Puppeteer under `src/main/rpa/**`.

## Project Layout

```text
src/
├── shared/
│   ├── appRole.js                 # Master/slave constants + SLAVE_ALLOWED_PAGES
│   ├── facebookCrawlConfig.js     # Facebook crawl settings, URL helpers, result enrichment
│   ├── parseFacebookGraphQL.js    # GraphQL → posts/comments parser
│   ├── crawlScroll.js             # Modal-aware scroll for crawl / request catching
│   └── crawlStopCondition.js      # Infinite-scroll stop conditions
├── main/
│   ├── appRoleConfig.js           # process.env role (main process)
│   ├── browser/                   # ScenarioEmbeddedBrowserService
│   ├── database/
│   │   ├── DatabaseService.js     # Main app SQLite (+ system variable profiles)
│   │   └── PlatformCrawledDataService.js  # facebook_crawled_data.db (master)
│   └── rpa/
│       ├── ExecutorService.js
│       ├── RequestCatchingPuppeteerCapture.js
│       └── RequestCatchingConfig.js
├── preload/
│   └── preload.cjs                # window.electronAPI bridge
└── renderer/
    ├── utils/
    │   ├── appRole.js             # import.meta.env role (renderer)
    │   └── exportTableCsv.js      # CSV export helper
    ├── components/
    │   ├── GlobalHeader.jsx
    │   ├── Sidebar.jsx
    │   ├── FacebookSidebar.jsx
    │   └── RequestCatchingScenarioEditorContent.jsx
    ├── pages/
    │   ├── FacebookDataPage.jsx
    │   └── FacebookDataSettingsPage.jsx
    ├── i18n/locales/              # en.js, vi.js
    └── slices/uiSlice.js          # currentView, currentPage, facebookDataPage
```

## Setup

Requirements: Node.js LTS 18+, FFmpeg on PATH for video preview export.

```bash
npm install
npm run rebuild
cp .env.example .env    # optional; default role is master
npm run dev             # or npm run dev:slave
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Master — Vite + Electron |
| `npm run dev:slave` | Slave — lightweight agent UI |
| `npm run build:renderer` | Build renderer (uses `.env` role) |
| `npm run build:renderer:master` | Force master renderer build |
| `npm run build:renderer:slave` | Force slave renderer build |
| `npm run build` | Build renderer + electron-builder package |
| `npm run rebuild` | Rebuild `better-sqlite3` for Electron |

## IPC Boundary

Renderer uses `window.electronAPI` only (`src/preload/preload.cjs`).

**Facebook Data channels (master only):**

| Channel | Purpose |
|---------|---------|
| `facebook-data:get-stats` | Counts groups/authors/posts/comments |
| `facebook-data:list-groups` | Group dropdown |
| `facebook-data:list-posts` | Posts tab (`groupId` filter) |
| `facebook-data:list-comments` | Comments tab (`postId`) |
| `facebook-data:export-csv` | Save dialog + write CSV |

Crawl / request-catching preview channels (examples): `scenario:crawl-preview:set-design-mode`, `scenario:request-catching:*`.

When adding IPC: service → `main.js` handler → preload → renderer. Guard master-only APIs with `assertMasterFacebookDataAccess()`.

## Database Notes

**Main app DB** (`DatabaseService`):

- UUID v4 text IDs, `is_dirty` for future sync.
- JSON fields stored as strings (`target_anchor`, `flow_data`, `scenario_meta`, …).
- Tasks in `tasks` table; crawl widgets in `scenario_steps`.
- System Facebook variable profiles seeded on startup (`is_system = 1`, protected from delete).

**Platform crawled DB** (`PlatformCrawledDataService`, master only):

- One file per platform: `data/{platform}_crawled_data.db`.
- Facebook schema: `groups`, `authors`, `posts`, `comments` with foreign keys.
- Populated by `ExecutorService` after request-catching / crawl runs (`saveFacebookPostsBatch`).

## Agent / Cursor Skill

Project skill for AI assistants working on layout and role split:

`.cursor/skills/master-slave-layout/SKILL.md`

Use when changing Global Header, App layout, `VITE_APP_ROLE`, Facebook Data Studio, Facebook crawl settings, or platform crawled-data IPC.

---

## Tiếng Việt

Ứng dụng RPA local-first (Electron + React + SQLite) hỗ trợ hai bản cài: **máy chính (master)** và **máy phụ (slave)**.

### Vai trò bản cài

| | Máy chính | Máy phụ |
|---|-----------|---------|
| Mục đích | Thiết kế kịch bản, xem dữ liệu, báo cáo | Chỉ chạy kịch bản, tiết kiệm RAM |
| Global Header | Có (đổi view + ngôn ngữ) | Ẩn hoàn toàn |
| Facebook Data Studio | Có | Khóa |
| Sidebar | Đầy đủ / Facebook sidebar | Kịch bản, Thực thi, Browser, Cài đặt |
| SQLite dữ liệu cào | Đọc/ghi | Không khởi tạo service |

Cấu hình: `VITE_APP_ROLE=master` hoặc `slave` trong `.env`.  
Chạy: `npm run dev` (master) hoặc `npm run dev:slave` (máy phụ).

### Facebook Data Studio (máy chính)

- Full-width, không nhúng browser.
- Lọc theo nền tảng (Facebook) và nhóm/hội từ bảng `groups`.
- Tab **Bài viết** và **Bình luận** — click một bài để xem comment tương ứng.
- Nút **Export Excel / CSV** xuất tab đang hiển thị.

File dữ liệu: `userData/data/facebook_crawled_data.db`.

### Cài đặt crawl Facebook

Trong view **Facebook Data → Cài đặt**:

- Chọn kịch bản **crawl nhóm** (quét bài viết trong nhóm).
- Chọn kịch bản **crawl comment** (quét bình luận theo bài).

Hai **profile biến hệ thống** được tạo sẵn, không xóa được:

- Nhóm: `group_id`, `last_date`
- Comment: `group_id`, `post_id`

URL mẫu crawl comment:

```text
https://www.facebook.com/groups/{{group_id}}/posts/{{post_id}}/
```

### Kịch bản bắt request API (`request_catching`)

- Duyệt Facebook trong browser nhúng; app chặn response GraphQL phù hợp.
- Khai báo biến kịch bản (`local_variables`) — ví dụ `group_id`, `post_id`.
- Xem **Final result** (JSON bài viết + comment đã parse).
- Khi GraphQL chỉ trả comment mà không có node bài viết, hệ thống **tự gán `post_id` / `group_id` từ biến kịch bản** trước khi lưu DB.
- Hỗ trợ autoscroll trong modal bài viết Facebook.

### Ghi chú kỹ thuật

- Renderer chỉ gọi `window.electronAPI`.
- Logic role: `src/shared/appRole.js`.
- Main import role: `src/main/appRoleConfig.js` → `../shared/appRole.js` (không dùng `../../shared/`).
- Parse Facebook: `src/shared/parseFacebookGraphQL.js`, `src/shared/facebookCrawlConfig.js`.
- Thêm IPC: cập nhật `main.js`, `preload.cjs`, và i18n (`vi.js` + `en.js`).
- Skill cho Cursor: `.cursor/skills/master-slave-layout/SKILL.md`.

## License

See repository owner for license terms.
