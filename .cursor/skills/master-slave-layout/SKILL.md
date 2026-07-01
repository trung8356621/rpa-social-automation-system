---
name: master-slave-layout
description: >-
  Guides changes to the RPA app's Master/Slave build split, Global Header,
  dual-view layout (Scenarios vs Facebook Data Studio), and platform crawled
  SQLite IPC. Use when editing App.jsx, GlobalHeader, Sidebar, Facebook Data
  Studio, VITE_APP_ROLE, PlatformCrawledDataService, or facebook-data IPC.
---

# Master / Slave Layout & Facebook Data Studio

## Build roles

| Role | Env | UI | Backend |
|------|-----|-----|---------|
| **master** | `VITE_APP_ROLE=master` (default) | Global Header, view switcher, Facebook Data Studio | `PlatformCrawledDataService` active |
| **slave** | `VITE_APP_ROLE=slave` | No header; execution-only sidebar | Facebook crawled-data IPC blocked |

**Source of truth:** `src/shared/appRole.js`

- Renderer: `src/renderer/utils/appRole.js` → `import.meta.env`
- Main: `src/main/appRoleConfig.js` → `process.env`

**Import path pitfall (main):** from `src/main/appRoleConfig.js` use `../shared/appRole.js`, **not** `../../shared/appRole.js`.

Both renderer and main must use the **same** role at runtime:
- Dev: set env in npm script for **both** Vite and Electron (`npm run dev` vs `npm run dev:slave`).
- Production: build renderer with `build:renderer:master` or `build:renderer:slave`, then package; Electron main reads `process.env.VITE_APP_ROLE` from the shell/env when launched.

## Layout architecture

```text
App.jsx
├── GlobalHeader          (master only)
├── flex row
│   ├── Sidebar           (hidden when master + currentView === 'facebookData')
│   └── main → renderPage()
└── Toast
```

**Redux (`uiSlice`):**
- `currentView`: `'scenarios'` | `'facebookData'` — master only; slave forced to `'scenarios'`
- `currentPage`: scenario-mode page id (`dashboard`, `scenarios`, …)
- Slave allowed pages: `SLAVE_ALLOWED_PAGES` in `src/shared/appRole.js`

**Enforcement:**
- `App.jsx` → `useEnforceBuildRoleLayout()` resets slave to scenarios + allowed page
- `Sidebar.jsx` → filters nav items by role
- `GlobalHeader.jsx` → returns `null` on slave
- `main.js` → `assertMasterFacebookDataAccess()` on all `facebook-data:*` handlers; service not constructed on slave

## Facebook Data Studio (master only)

**Page:** `src/renderer/pages/FacebookDataPage.jsx`

Full-width (no sidebar). Top filters:
- Platform dropdown (currently Facebook only)
- Group dropdown from `listFacebookGroups()`

Tabs:
1. **Posts** — author, truncated content, clickable `post_link`, `crawled_at`; row click loads comments
2. **Comments** — loaded by `post_id` via `listFacebookComments()`

Export: `exportFacebookDataCsv({ content, defaultPath })` — UTF-8 BOM CSV via save dialog.

## Platform crawled SQLite

**Service:** `src/main/database/PlatformCrawledDataService.js`  
**File:** `${userData}/data/facebook_crawled_data.db`  
**Tables:** `groups`, `authors`, `posts`, `comments`

Separate from main app DB (`DatabaseService`). Only master initializes the service.

## Adding facebook-data features

Follow IPC order:

1. Method on `PlatformCrawledDataService`
2. `ipcMain.handle('facebook-data:…')` in `main.js` wrapped with `assertMasterFacebookDataAccess()`
3. Preload wrapper in `preload.cjs`
4. Renderer call + i18n keys in **both** `vi.js` and `en.js`

Guard UI with `isMasterBuild` from `src/renderer/utils/appRole.js`. Do not expose crawled-data UI on slave.

## Adding UI that differs by role

1. Check `isMasterBuild` / `isSlaveBuild` in component or `App.jsx`
2. Update `SLAVE_ALLOWED_PAGES` only if slave genuinely needs the page
3. Never add Facebook Data options to slave header (header is absent)
4. Run `npm run build:renderer` and `npm run build:renderer:slave` before finishing

## Commands

```bash
npm run dev                 # master dev
npm run dev:slave           # slave dev
npm run build:renderer:master
npm run build:renderer:slave
```

Copy `.env.example` → `.env` and set `VITE_APP_ROLE` for local defaults.

## Key files

| Area | Files |
|------|-------|
| Role config | `src/shared/appRole.js`, `src/main/appRoleConfig.js`, `src/renderer/utils/appRole.js` |
| Layout | `src/renderer/App.jsx`, `GlobalHeader.jsx`, `Sidebar.jsx` |
| Studio | `src/renderer/pages/FacebookDataPage.jsx`, `src/renderer/utils/exportTableCsv.js` |
| Data | `PlatformCrawledDataService.js`, `main.js` (facebook-data handlers) |
| i18n | `facebookData.studio.*`, `globalHeader.*` in locale files |
