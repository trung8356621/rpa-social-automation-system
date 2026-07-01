# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports English and Vietnamese UI.

---

## Current Status

- Scenario list supports grouped display by the first name token, such as `WP login` under `WP` and `omi_channel` under `omi`.
- Scenarios can be pinned with a star button. Pinned scenarios are shown first and cannot be deleted until they are unpinned.
- Pin state is stored in SQLite with `scenarios.is_pinned`, so it persists after restarting the app.
- Scenario deletion is protected in both the renderer and main process.
- Renderer build was verified with `npm run build:renderer`.

## Features

- Browser profiles and session persistence: isolated Chromium user data per app profile.
- Scenario studio: record, edit timeline, preview, and replay Puppeteer steps.
- Scenario organization: grouped scenario list, collapsible groups, and persistent pinned scenarios.
- Scenario variables and data profiles: skeleton variables plus per-run value sets using `{{variable}}`.
- Execution: parallel runs, headless mode, execution history.
- Proxy management: HTTP/SOCKS proxies for automation.

## Stack

- Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit.
- SQLite through `better-sqlite3` in the main process only.
- Puppeteer automation under `src/main/rpa/**`.

## Project Layout

```text
src/
├── main/           # Electron main process, SQLite, RPA services
├── preload/        # preload.cjs, contextBridge IPC
└── renderer/       # React UI
    ├── i18n/       # en/vi locale files + useTranslation()
    ├── pages/
    ├── components/
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

## IPC Boundary

Renderer code must use `window.electronAPI` only. The preload bridge is defined in `src/preload/preload.cjs`.

## Database Notes

- UUID v4 text IDs are used instead of autoincrement integers.
- `is_dirty` is reserved for future cloud sync.
- JSON fields such as `target_anchor` are stored as strings in SQLite.
- Scenario pinning uses `scenarios.is_pinned`.

---

## Tiếng Việt

Ứng dụng RPA local-first dùng Electron, React và SQLite để ghi, chỉnh sửa và chạy tự động hóa trình duyệt Chromium.

### Trạng Thái Hiện Tại

- Danh sách kịch bản đã có nhóm theo phần đầu tên, ví dụ `WP login` nằm trong nhóm `WP`, `omi_channel` nằm trong nhóm `omi`.
- Có nút sao để ghim/bỏ ghim kịch bản.
- Kịch bản đã ghim sẽ nổi lên đầu và không xóa được cho tới khi bỏ ghim.
- Trạng thái ghim được lưu trong SQLite nên mở lại app vẫn còn.
- Đã kiểm tra build giao diện bằng `npm run build:renderer`.

### Tính Năng

- Browser profile và lưu session riêng cho từng profile app.
- Studio kịch bản: ghi, sửa timeline, preview và replay bước Puppeteer.
- Tổ chức kịch bản: nhóm, thu gọn/mở rộng nhóm, ghim kịch bản quan trọng.
- Biến kịch bản và hồ sơ dữ liệu: dùng dạng `{{ten_bien}}`.
- Thực thi: chạy song song, headless, lịch sử chạy.
- Quản lý proxy HTTP/SOCKS cho automation.

### Ghi Chú Kỹ Thuật

- Renderer chỉ gọi API qua `window.electronAPI`.
- Database chạy ở main process.
- Khi thêm IPC mới, cập nhật cả `src/main/main.js` và `src/preload/preload.cjs`.
- Khi thêm dữ liệu bền vững, cập nhật migration trong `src/main/database/DatabaseService.js`.

## License

See repository owner for license terms.
