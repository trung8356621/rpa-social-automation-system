# RPA Social Automation System

Local-first Electron + React + SQLite RPA app for social automation. Supports **English** and **Vietnamese** UI.

---

## English

### Features

- **Browser profiles & session persistence** — isolated Chromium user data per app profile
- **Scenario studio** — record, edit timeline, preview, and replay Puppeteer steps
- **Scenario variables & data profiles** — skeleton variables + per-run value sets (`{{variable}}`)
- **Execution** — parallel runs, headless mode, execution history
- **Proxy management** — HTTP/SOCKS proxies for automation

### Stack

- Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit
- SQLite (`better-sqlite3`) in the main process only
- Puppeteer automation under `src/main/rpa/**`

### Project layout

```
src/
├── main/           # Electron main process, SQLite, RPA services
├── preload/        # preload.cjs (contextBridge IPC)
└── renderer/       # React UI
    ├── i18n/       # en/vi locale files + useTranslation()
    ├── pages/
    ├── components/
    └── slices/
```

### Setup

**Requirements:** Node.js LTS (18+), FFmpeg on PATH (for video preview export)

```bash
npm install
npm run rebuild          # rebuild better-sqlite3 for Electron
npm run dev              # Vite + Electron dev
npm run build:renderer   # production renderer build
npm run build            # package with electron-builder
```

### Language / i18n

- UI language is stored in SQLite setting `app.language` (`vi` | `en`)
- Change it in **Settings → General → Interface language**, then click **Save settings**
- Add or edit strings in:
  - `src/renderer/i18n/locales/vi.js`
  - `src/renderer/i18n/locales/en.js`
- In React components: `const { t, language } = useTranslation()` then `t('nav.dashboard')`
- Use `{param}` placeholders in locale strings for interpolation

### IPC boundary

Renderer must use `window.electronAPI` only (see `src/preload/preload.cjs`).

---

## Tiếng Việt

### Tính năng

- **Browser profile & lưu session** — mỗi profile app dùng thư mục Chromium riêng
- **Studio kịch bản** — ghi, sửa timeline, preview, replay bước Puppeteer
- **Biến kịch bản & hồ sơ dữ liệu** — biến khung + bộ giá trị theo lần chạy (`{{ten_bien}}`)
- **Thực thi** — chạy song song, headless, lịch sử thực thi
- **Quản lý proxy** — HTTP/SOCKS cho automation

### Công nghệ

- Electron 30, React 18, Vite 6, Tailwind CSS 4, Redux Toolkit
- SQLite (`better-sqlite3`) chỉ chạy ở main process
- Puppeteer nằm trong `src/main/rpa/**`

### Cấu trúc thư mục

```
src/
├── main/           # Main process Electron, SQLite, RPA
├── preload/        # preload.cjs (IPC qua contextBridge)
└── renderer/       # Giao diện React
    ├── i18n/       # locale en/vi + hook useTranslation()
    ├── pages/
    ├── components/
    └── slices/
```

### Cài đặt

**Yêu cầu:** Node.js LTS (18+), FFmpeg trên PATH (xuất video preview)

```bash
npm install
npm run rebuild          # rebuild better-sqlite3 cho Electron
npm run dev              # dev Vite + Electron
npm run build:renderer   # build renderer production
npm run build            # đóng gói electron-builder
```

### Ngôn ngữ / i18n

- Ngôn ngữ UI lưu trong SQLite: `app.language` (`vi` | `en`)
- Đổi tại **Cài đặt → Chung → Ngôn ngữ giao diện**, rồi bấm **Lưu cài đặt**
- Thêm/sửa chuỗi tại:
  - `src/renderer/i18n/locales/vi.js`
  - `src/renderer/i18n/locales/en.js`
- Trong React: `const { t, language } = useTranslation()` rồi `t('nav.dashboard')`
- Dùng placeholder `{param}` trong locale để truyền biến

### Ranh giới IPC

Renderer chỉ gọi `window.electronAPI` (xem `src/preload/preload.cjs`).

---

## Database notes

- UUID v4 text IDs (not autoincrement integers)
- `is_dirty` flag for future cloud sync
- JSON fields (e.g. `target_anchor`) stored as strings in SQLite

## License

See repository owner for license terms.
