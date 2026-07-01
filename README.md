# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports English and Vietnamese UI.

---

## Current Status

- Scenario list supports grouped display by the first name token, such as `WP login` under `WP` and `omi_channel` under `omi`.
- Scenarios can be pinned with a star button. Pinned scenarios are shown first and cannot be deleted until they are unpinned.
- Pin state is stored in SQLite with `scenarios.is_pinned`, so it persists after restarting the app.
- **Crawl scenarios** (`scenario_type = crawl`) use a dedicated editor: embedded browser preview, **Design mode** (hover/click to pick elements), crawl widget list, and live sample extraction preview.
- Crawl widgets are stored in existing `scenario_steps` rows (`action_type: 'crawl'`); no separate crawl table.
- **Crawl execution** runs at Execute time via `ExecutorService` — extracts card data with optional autoscroll and infinite scroll.
- **Tasks** page provides a visual flow builder (prepare / crawl / action scenario nodes) stored in the `tasks` table.
- Scenario deletion is protected in both the renderer and main process.
- Renderer build was verified with `npm run build:renderer`.

## Features

- Browser profiles and session persistence: isolated Chromium user data per app profile.
- Scenario studio: record, edit timeline, preview, and replay Puppeteer steps.
- **Three scenario types:** `prepare` (login/session), `crawl` (data extraction), `action` (interactions).
- **Crawl design studio:** pick elements in embedded BrowserView, configure parent container selectors, result mode (`full_html` or `patterns`), and promote-to-parent.
- **Crawl runtime:** extract cards during execution, with autoscroll and infinite-scroll stop conditions; results appear in execution history.
- Scenario organization: grouped scenario list, collapsible groups, and persistent pinned scenarios.
- Scenario variables and data profiles: skeleton variables plus per-run value sets using `{{variable}}`.
- **Task builder:** connect prepare, crawl, and action scenarios into reusable flows.
- Execution: parallel runs, headless mode, execution history with crawl result summaries.
- Proxy management: HTTP/SOCKS proxies for automation.

## Stack

- Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit.
- SQLite through `better-sqlite3` in the main process only.
- Puppeteer automation under `src/main/rpa/**`.

## Project Layout

```text
src/
├── main/
│   ├── browser/    # ScenarioEmbeddedBrowserService (crawl preview + design mode)
│   ├── database/   # DatabaseService.js (SQLite + migrations)
│   └── rpa/        # ExecutorService, DesignModeScript, CardExtractorScript, ...
├── preload/
│   ├── preload.cjs              # main renderer IPC bridge
│   └── crawl-design-preload.cjs # BrowserView pick events
└── renderer/
    ├── i18n/       # en/vi locale files + useTranslation()
    ├── pages/      # ScenariosPage, ExecutionsPage, TasksPage, ...
    ├── components/ # ScenarioEditor, CrawlWidgetPanel, CrawlWidgetSettings, ...
    └── slices/
```

## Setup

Requirements: Node.js LTS 18+, FFmpeg on PATH for video preview export.

```bash
npm install
npm run rebuild
npm run dev
npm run build:renderer
npm run build
```

## Useful Commands

- `npm run dev`: start Vite and Electron in development mode.
- `npm run build:renderer`: build the React renderer.
- `npm run build`: build renderer and package with electron-builder.
- `npm run rebuild`: rebuild native modules such as `better-sqlite3` for Electron.

## Scenario Notes

- Group name is derived from the first token of the scenario name, split by space, underscore, or hyphen.
- Examples: `WP login` -> `WP`, `WP_create_preview` -> `WP`, `omi_channel` -> `omi`.
- Pinned scenarios are sorted before unpinned scenarios.
- Pinned scenarios must be unpinned before deletion.

## Crawl Notes

- Crawl editor hides Record/Publish controls; use **Design** toggle to pick elements on the live page.
- Each crawl widget is one `scenario_steps` row with `action_config` inside `target_anchor`:
  - `parent_container_selector`, `selector_mode` (`single` | `multiple`)
  - `result_mode` (`full_html` | `patterns`), `result_patterns`, `sample_dump`
- Crawl scenario meta (`scenario_meta.crawl`) controls runtime scroll: `autoscroll`, `infinity_scroll` (timeout or condition).
- Key files: `DesignModeScript.js`, `CardExtractorScript.js`, `crawlWidget.js`, `CrawlWidgetPanel.jsx`.

## IPC Boundary

Renderer code must use `window.electronAPI` only. The preload bridge is defined in `src/preload/preload.cjs`.

Crawl preview IPC channels (examples): `scenario:crawl-preview:set-design-mode`, `scenario:crawl-preview:extract-sample`, `scenario:crawl-preview:highlight-anchor`.

## Database Notes

- UUID v4 text IDs are used instead of autoincrement integers.
- `is_dirty` is reserved for future cloud sync.
- JSON fields such as `target_anchor` and `flow_data` are stored as strings in SQLite.
- Scenario pinning uses `scenarios.is_pinned`.
- Tasks use the `tasks` table (`name`, `description`, `flow_data`, `is_active`).

---

## Tiếng Việt

Ứng dụng RPA local-first dùng Electron, React và SQLite để ghi, chỉnh sửa và chạy tự động hóa trình duyệt Chromium.

### Trạng Thái Hiện Tại

- Danh sách kịch bản đã có nhóm theo phần đầu tên, ví dụ `WP login` nằm trong nhóm `WP`, `omi_channel` nằm trong nhóm `omi`.
- Có nút sao để ghim/bỏ ghim kịch bản; kịch bản đã ghim nổi lên đầu và không xóa được cho tới khi bỏ ghim.
- Trạng thái ghim được lưu trong SQLite (`scenarios.is_pinned`).
- **Kịch bản crawl** có editor riêng: browser nhúng, chế độ **Design** (hover/click chọn element), danh sách crawl widget, xem trước dữ liệu mẫu.
- Widget crawl lưu trong `scenario_steps` (`action_type: 'crawl'`), không thêm bảng mới.
- **Thực thi crawl** đã có: extract dữ liệu khi chạy, hỗ trợ autoscroll và infinite scroll; kết quả hiển thị trong lịch sử chạy.
- Trang **Tasks** có flow builder nối các kịch bản prepare / crawl / action.
- Đã kiểm tra build giao diện bằng `npm run build:renderer`.

### Tính Năng

- Browser profile và lưu session riêng cho từng profile app.
- Studio kịch bản: ghi, sửa timeline, preview và replay bước Puppeteer.
- Ba loại kịch bản: `prepare` (đăng nhập), `crawl` (lấy dữ liệu), `action` (tương tác).
- Thiết kế crawl: chọn element trên trang thật, cấu hình selector container, chế độ kết quả (`full_html` / `patterns`).
- Chạy crawl: extract card khi thực thi, cuộn tự động, dừng theo timeout hoặc điều kiện.
- Tổ chức kịch bản: nhóm, thu gọn/mở rộng nhóm, ghim kịch bản.
- Biến kịch bản và hồ sơ dữ liệu: dùng dạng `{{ten_bien}}`.
- Task builder: ghép các kịch bản thành luồng tái sử dụng.
- Thực thi: chạy song song, headless, lịch sử chạy kèm tóm tắt kết quả crawl.
- Quản lý proxy HTTP/SOCKS cho automation.

### Ghi Chú Kỹ Thuật

- Renderer chỉ gọi API qua `window.electronAPI`.
- Database chạy ở main process.
- Khi thêm IPC mới, cập nhật cả `src/main/main.js` và `src/preload/preload.cjs`.
- Khi thêm dữ liệu bền vững, cập nhật migration trong `src/main/database/DatabaseService.js`.
- Crawl design inject script vào BrowserView (`DesignModeScript.js`, `crawl-design-preload.cjs`).

## License

See repository owner for license terms.
