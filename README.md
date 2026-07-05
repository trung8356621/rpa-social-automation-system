# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports English and Vietnamese UI.

The app ships in two **build roles**: **master** (full studio + data management) and **slave** (lightweight execution agent).

---

## Architecture Rules

These invariants are global. Do not violate them when changing Facebook or adding
new social platforms.

- **Single Post is isolated JSON-only:** Crawl Single Post is allowed only as a
  separate Force GraphQL Fetch flow for one direct post URL. It must not reuse
  Group feed scrolling to find old posts.
- **No DOM data scraping:** Social data must not be extracted from HTML UI
  elements. Do not use `querySelector`, accessibility trees, visible text, or
  platform UI classes to scrape post content, authors, dates, stats, comments,
  or media. `page.evaluate` is allowed only for reading runtime tokens and
  calling JSON endpoints such as `/api/graphql/`.
- **Facebook Crawl Group stays separate:** Facebook Data Studio keeps Crawl
  Group optimized for public and private groups, and Crawl Single Post must not
  change Group feed behavior.
- **Network-only extraction:** Facebook posts, comments, media, and interaction
  stats must come from GraphQL network interception or Single Post Force
  GraphQL Fetch JSON, then `parseFacebookGraphQLBatch`.
- **Centralized random delay:** Browser-like actions must not use fixed
  hardcoded delays. Click, type, scroll, and settle waits must go through
  `randomDelay(baseMs, minMs, maxMs)`.
- **Delay formula:** `randomDelay` must multiply `baseMs` by a random floating
  factor in `[0.75, 1.4]`, then clamp to `[minMs, maxMs]`.
- **Typing delay:** `page.keyboard.type` per-character delay must use
  `randomDelay` with a base between `50ms` and `100ms`.
- **Scroll delay:** `betweenScrollMs` and `settleMs` in `infinity_scroll` loops
  must call `randomDelay` on every loop to create non-linear timing.
- **LinkedIn extension rule:** LinkedIn modules must use network interception
  against `/voyager/api/...` REST endpoints with URN mapping. Do not build
  LinkedIn DOM scrapers; reuse centralized random delay.

## Current Status

- **Master / Slave builds** via `VITE_APP_ROLE` (`master` | `slave`). Slave hides Global Header and Facebook Data; master has full studio.
- **Global Header** (master only): view switcher (Scenarios / Facebook Data) + quick language toggle synced with Settings (`app.language`).
- **Facebook Data Studio** (master only): full-width UI to browse `facebook_crawled_data.db` — filter by group, posts/comments tabs, CSV export.
- **Facebook Data settings** (master only): bind the group crawl scenario; system variable profile auto-seeded.
- **Request catching scenarios** (`scenario_type = request_catching`): intercept Facebook GraphQL API responses while browsing; offline dump analysis; final JSON result preview.
- **Facebook GraphQL parser** (`src/shared/parseFacebookGraphQL.js`): normalizes posts/comments from raw GraphQL payloads; enriches group metadata from scenario variables before DB save.
- Scenario list supports grouped display by the first name token (`WP login` → `WP`, `omi_channel` → `omi`).
- Scenarios can be pinned; pin state persists in SQLite (`scenarios.is_pinned`).
- **Crawl scenarios** (`scenario_type = crawl`): embedded browser, Design mode, crawl widgets, live sample preview.
- **Crawl execution** via `ExecutorService` with autoscroll / infinite scroll for group feeds.
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

Posts without `post_id` are skipped on save. Request-catching runs enrich parsed
results with group metadata from scenario variables.

**Facebook crawl invariants:**

- Crawl Single Post is supported only as an isolated JSON-only Force GraphQL
  Fetch flow. It must have its own post-link modal and must not scroll a group
  feed to locate the target post.
- Facebook Crawl Group remains group-only: navigate by runtime `group_id` to
  `https://www.facebook.com/groups/{group_id}/`.
- Post content, author, date, interaction stats, comments, and media must come
  from intercepted GraphQL network payloads or Single Post Force GraphQL Fetch
  JSON parsed by `parseFacebookGraphQLBatch`.
- DOM element scraping is forbidden for Facebook data extraction. Do not use
  `querySelector`, accessibility trees, or visible UI text to create or patch
  post/comment data. `page.evaluate` may read runtime tokens and call GraphQL
  JSON endpoints, but must not read post/comment text from HTML.
- Comment-only payloads such as `display_comments` must not create new `posts`
  rows.
- Post/comment media must be downloaded into `facebook_media/` whenever Facebook
  returns a downloadable image or video URL. Preserve local paths in
  `post_images` / `comment_images`.

## Facebook Crawl Settings

Accessible from **Facebook Data -> Settings** (master only, via `FacebookSidebar`).

| Setting | Purpose |
|---------|---------|
| Group crawl scenario | `crawl` or `request_catching` scenario for scanning group feed posts |

Settings keys (in main app `settings` table):

- `facebook.crawlGroupScenarioId`

On save, the app binds the scenario to a **system variable profile** (cannot be deleted):

| Profile | Variables | Use |
|---------|-----------|-----|
| `__system:facebook-crawl-group` | `group_id`, `post_limit` | Group feed crawl; `post_limit` stops after that many unique posts |

Helpers: `src/shared/facebookCrawlConfig.js` (`parseFacebookGroupLink`, `buildFacebookGroupUrl`, `enrichFacebookCrawlPosts`, ...).

Variables are resolved in preview, execution, and final result enrichment.

## Request Catching Scenarios

Fourth scenario type: `request_catching` (alongside `prepare`, `crawl`, `action`).

**Workflow:**

1. Set platform (Facebook) and a group target URL with `{{variables}}`.
2. Define **Scenario variables** (`local_variables`) such as `group_id` and `post_limit`.
3. Browse the group feed; the app intercepts matching GraphQL network responses.
4. Configure request filters in scenario meta (`scenario_meta.request_catching.filters`).
5. Preview **Final result** as parsed posts/comments JSON.
6. Optional: save session dump for offline analysis (`debug_dumps/`).
7. On execution, `ExecutorService` captures live via Puppeteer CDP and saves to platform DB (master).

**Key files:**

| File | Role |
|------|------|
| `src/renderer/components/RequestCatchingScenarioEditorContent.jsx` | Editor UI: capture, offline dump, final result |
| `src/main/rpa/RequestCatchingPuppeteerCapture.js` | CDP capture during execution |
| `src/main/browser/ScenarioEmbeddedBrowserService.js` | Embedded preview + listen-only capture |
| `src/shared/parseFacebookGraphQL.js` | Parse + enrich GraphQL batches |
| `src/shared/crawlScroll.js` | Autoscroll / infinite-scroll helpers |

**Result enrichment:** `enrichFacebookCrawlPosts()` may fill missing `group_id`
and `post_link` from scenario variables. It must not invent a post from
comment-only GraphQL.

## Features

- **Dual build:** master studio vs slave execution agent.
- **Global Header:** bilingual quick switch + Scenarios / Facebook Data views (master).
- **Facebook Data Studio:** browse, filter, drill into comments, export CSV.
- **Facebook crawl settings:** group scenario binding + system variable profile.
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
- System Facebook group variable profile seeded on startup (`is_system = 1`, protected from delete).

**Platform crawled DB** (`PlatformCrawledDataService`, master only):

- One file per platform: `data/{platform}_crawled_data.db`.
- Facebook schema: `groups`, `authors`, `posts`, `comments` with foreign keys.
- Populated by `ExecutorService` after request-catching / crawl runs (`saveFacebookPostsBatch`).

## Agent / Cursor Skill

Project skill for AI assistants working on layout and role split:

`.cursor/skills/master-slave-layout/SKILL.md`

Use `.cursor/skills/facebook-crawl-data/SKILL.md` when changing Facebook crawl,
network parsing, media download, or platform crawled-data persistence.

---

## Vietnamese Notes

The Vietnamese UI remains supported. Technical architecture rules are defined in
English in **Architecture Rules** and are authoritative for future AI-assisted
changes.

- Facebook Crawl Group and Crawl Single Post are separate flows.
- Single Post crawl must be JSON-only Force GraphQL Fetch; DOM element scraping
  remains forbidden.
- Social crawlers must use network interception plus centralized random delay.

## License
See repository owner for license terms.
