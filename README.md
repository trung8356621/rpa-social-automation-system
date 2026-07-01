# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports English and Vietnamese UI.

The app ships in two **build roles**: **master** (full studio + data management) and **slave** (lightweight execution agent).

---

## Current Status

- **Master / Slave builds** via `VITE_APP_ROLE` (`master` | `slave`). Slave hides Global Header and Facebook Data; master has full studio.
- **Global Header** (master only): view switcher (Scenarios / Facebook Data) + quick language toggle synced with Settings (`app.language`).
- **Facebook Data Studio** (master only): full-width UI to browse `facebook_crawled_data.db` — filter by group, posts/comments tabs, CSV export.
- Scenario list supports grouped display by the first name token (`WP login` → `WP`, `omi_channel` → `omi`).
- Scenarios can be pinned; pin state persists in SQLite (`scenarios.is_pinned`).
- **Crawl scenarios** (`scenario_type = crawl`): embedded browser, Design mode, crawl widgets, live sample preview.
- **Crawl execution** via `ExecutorService` with autoscroll / infinite scroll.
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
│ (hidden  │  • scenarios view → Dashboard, Scenarios,  │
│  in FB   │    Tasks, Executions, Settings, …          │
│  Data    │  • facebookData view → Facebook Data     │
│  studio) │    Studio (full-width)                   │
└──────────┴──────────────────────────────────────────┘
```

**Redux UI state** (`src/renderer/slices/uiSlice.js`):

- `currentView`: `'scenarios'` | `'facebookData'` (master only)
- `currentPage`: page within scenarios view (`scenarios`, `executions`, …)

**Key components:**

| File | Role |
|------|------|
| `src/renderer/App.jsx` | Root layout, role enforcement, page routing |
| `src/renderer/components/GlobalHeader.jsx` | View switcher + language (master) |
| `src/renderer/components/Sidebar.jsx` | Icon nav; filtered on slave |
| `src/renderer/pages/FacebookDataPage.jsx` | Facebook Data Studio |

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

## Features

- **Dual build:** master studio vs slave execution agent.
- **Global Header:** bilingual quick switch + Scenarios / Facebook Data views (master).
- **Facebook Data Studio:** browse, filter, drill into comments, export CSV.
- Browser profiles and session persistence per app profile.
- Scenario studio: record, edit timeline, preview, replay Puppeteer steps.
- **Three scenario types:** `prepare`, `crawl`, `action`.
- **Crawl design studio:** Design mode, parent selectors, `full_html` / `patterns` result modes.
- Scenario variables and data profiles (`{{variable}}`).
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
│   └── appRole.js              # Master/slave constants + SLAVE_ALLOWED_PAGES
├── main/
│   ├── appRoleConfig.js        # process.env role (main process)
│   ├── browser/                # ScenarioEmbeddedBrowserService
│   ├── database/
│   │   ├── DatabaseService.js  # Main app SQLite
│   │   └── PlatformCrawledDataService.js  # facebook_crawled_data.db (master)
│   └── rpa/                    # ExecutorService, crawl scripts, …
├── preload/
│   └── preload.cjs             # window.electronAPI bridge
└── renderer/
    ├── utils/
    │   ├── appRole.js          # import.meta.env role (renderer)
    │   └── exportTableCsv.js   # CSV export helper
    ├── components/
    │   ├── GlobalHeader.jsx
    │   └── Sidebar.jsx
    ├── pages/
    │   └── FacebookDataPage.jsx
    ├── i18n/locales/           # en.js, vi.js
    └── slices/uiSlice.js       # currentView, currentPage
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

Crawl preview channels (examples): `scenario:crawl-preview:set-design-mode`, `scenario:crawl-preview:extract-sample`.

When adding IPC: service → `main.js` handler → preload → renderer. Guard master-only APIs with `assertMasterFacebookDataAccess()`.

## Database Notes

**Main app DB** (`DatabaseService`):

- UUID v4 text IDs, `is_dirty` for future sync.
- JSON fields stored as strings (`target_anchor`, `flow_data`, …).
- Tasks in `tasks` table; crawl widgets in `scenario_steps`.

**Platform crawled DB** (`PlatformCrawledDataService`, master only):

- One file per platform: `data/{platform}_crawled_data.db`.
- Facebook schema: `groups`, `authors`, `posts`, `comments` with foreign keys.

## Agent / Cursor Skill

Project skill for AI assistants working on layout and role split:

`.cursor/skills/master-slave-layout/SKILL.md`

Use when changing Global Header, App layout, `VITE_APP_ROLE`, Facebook Data Studio, or platform crawled-data IPC.

---

## Tiếng Việt

Ứng dụng RPA local-first (Electron + React + SQLite) hỗ trợ hai bản cài: **máy chính (master)** và **máy phụ (slave)**.

### Vai trò bản cài

| | Máy chính | Máy phụ |
|---|-----------|---------|
| Mục đích | Thiết kế kịch bản, xem dữ liệu, báo cáo | Chỉ chạy kịch bản, tiết kiệm RAM |
| Global Header | Có (đổi view + ngôn ngữ) | Ẩn hoàn toàn |
| Facebook Data Studio | Có | Khóa |
| Sidebar | Đầy đủ | Kịch bản, Thực thi, Browser, Cài đặt |
| SQLite dữ liệu cào | Đọc/ghi | Không khởi tạo service |

Cấu hình: `VITE_APP_ROLE=master` hoặc `slave` trong `.env`.  
Chạy: `npm run dev` (master) hoặc `npm run dev:slave` (máy phụ).

### Facebook Data Studio (máy chính)

- Full-width, không nhúng browser.
- Lọc theo nền tảng (Facebook) và nhóm/hội từ bảng `groups`.
- Tab **Bài viết** và **Bình luận** — click một bài để xem comment tương ứng.
- Nút **Export Excel / CSV** xuất tab đang hiển thị.

File dữ liệu: `userData/data/facebook_crawled_data.db`.

### Ghi chú kỹ thuật

- Renderer chỉ gọi `window.electronAPI`.
- Logic role: `src/shared/appRole.js`.
- Main import role: `src/main/appRoleConfig.js` → `../shared/appRole.js` (không dùng `../../shared/`).
- Thêm IPC: cập nhật `main.js`, `preload.cjs`, và i18n (`vi.js` + `en.js`).
- Skill cho Cursor: `.cursor/skills/master-slave-layout/SKILL.md`.

## License

See repository owner for license terms.
