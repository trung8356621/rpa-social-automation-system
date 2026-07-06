# Profile Management — `/profiles/manage`

> **Router Path:** `/profiles/manage`
> **Core UI Component:** `src/renderer/pages/BrowserProfilesPage.jsx`
> **Core Service:** `src/main/browser/BrowserProfileService.js`

---

## 1. Khái Niệm Cốt Lõi

**Cô lập môi trường trình duyệt chống phát hiện (anti-detect)** riêng lẻ cho từng tài khoản mạng xã hội. Mỗi browser profile cung cấp một ngữ cảnh duyệt web biệt lập với cookies, localStorage, IndexedDB và extensions riêng — ngăn Facebook, LinkedIn hoặc các nền tảng khác liên kết các hoạt động tự động hóa giữa các tài khoản.

---

## 2. Kiến Trúc

### 2.1 Cô Lập Session Partition trong Electron

Ứng dụng gán các **phân vùng trình duyệt biệt lập** sử dụng thuộc tính `partition` gốc của Electron:

```javascript
// Trong BrowserWindow / webview construction:
partition = `persist:profile-${profileId}`;
```

Điều này ánh xạ trực tiếp đến cột `profile_directory` trong bảng SQLite `browser_profiles`. Mỗi partition tạo một thư mục Chromium profile biệt lập tại:

```
{userDataDir}/browser-data/profiles/{profileId}/
```

### 2.2 Nguồn Profile

| Nguồn | Mô tả | Xuất xứ |
|--------|-------------|--------|
| `scan` | Tự động phát hiện từ các trình duyệt đã cài (Chrome, Edge, v.v.) | `browser:scan-profiles` |
| `import` | Thư mục browser profile được import thủ công | `browser:import-profile` |
| `app` | Profile trống được tạo trong ứng dụng | `browser:create-blank-profile` |

### 2.3 Database Model — Bảng `browser_profiles`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT (UUID) | Khóa chính |
| `browser_key` | TEXT | Định danh trình duyệt (`chrome`, `edge`, `brave`) |
| `browser_name` | TEXT | Tên hiển thị (`Google Chrome`, `Microsoft Edge`) |
| `profile_name` | TEXT | Tên thư mục profile gốc |
| `executable_path` | TEXT | Đường dẫn đến file thực thi trình duyệt |
| `user_data_dir` | TEXT | Thư mục user data của trình duyệt (gốc) |
| `profile_dir_name` | TEXT | Thư mục con profile (ví dụ: `Default`, `Profile 1`) |
| `display_name` | TEXT | Nhãn profile thân thiện với người dùng |
| `source` | TEXT | `scan`, `import`, `app` |
| `status` | TEXT | `active`, `imported` |
| `imported_at` | TEXT | Thời gian import |
| `import_path` | TEXT | Đường dẫn thư mục cho profile đã import |
| `facebook_id` | TEXT | ID tài khoản Facebook đã phát hiện |
| `has_linkedin` | INTEGER | Cờ phát hiện tài khoản LinkedIn |
| `account_detected_at` | TEXT | Thời gian phát hiện tài khoản |
| `account_summary` | TEXT | Tóm tắt thông tin tài khoản đã phát hiện |
| `is_dirty` | INTEGER | Cờ sẵn sàng đồng bộ (0/1) |

---

## 3. Định Tuyến Proxy

Các profile hỗ trợ **định tuyến proxy thủ công ban đầu** khi khởi chạy trình duyệt:

```javascript
const proxyArgs = buildPuppeteerProxyLaunchArgs(proxyConfig);
// → ['--proxy-server=http://1.2.3.4:8080']

await page.authenticate({
  username: proxy.username,
  password: proxy.password,
});
```

Cấu hình proxy được lưu trong bảng `proxies` và gán qua `browser_profile_id` hoặc tùy chọn runtime. Một profile có thể được liên kết với một proxy tại một thời điểm.

---

## 4. Lưu Trữ Cookie & Session

### 4.1 Lưu Trữ Native Chromium

Hệ thống dựa vào **lưu trữ thư mục user data native Chromium** cho cookies:

```javascript
this.browser = await puppeteer.launch({
  userDataDir: resolvedDir,  // Thư mục riêng theo profile
  // ...
});
```

Cơ sở dữ liệu `Cookies` SQLite tích hợp của Chromium bên trong thư mục user data tự động lưu trữ tất cả dữ liệu session. Không cần serialize/deserialize cookie tùy chỉnh.

### 4.2 Độ Trễ Đóng Session

Khi thực thi hoàn tất, trình duyệt vẫn mở trong một khoảng thời gian có thể cấu hình:

```javascript
function _getBrowserCloseDelayMs() {
  // Mặc định: 5000ms (5 giây)
  // Có thể cấu hình qua settings: execution.browserCloseDelayMs
  // Phạm vi: [1000ms, 120000ms]
}
```

Độ trễ này đảm bảo Chromium hoàn tất WAL checkpoint trên cơ sở dữ liệu `Cookies` trước khi tiến trình thoát, đảm bảo cookie tồn tại qua các session.

### 4.3 Bảo Vệ Điều Kiện Đua

Một **khóa theo từng userDataDir (per-userDataDir lock)** ngăn hai executor khởi chạy Chrome trên cùng một thư mục đồng thời:

```javascript
while (userDataDirLocks.has(userDataDir)) {
  await userDataDirLocks.get(userDataDir);
}
```

---

## 5. Phát Hiện Tài Khoản

### 5.1 Phát Hiện Tự Động

`BrowserProfileService.detectBrowserProfileAccount(profileId)` thực hiện:

1. Mở trình duyệt với thư mục user data của profile.
2. Điều hướng đến `https://www.facebook.com/`.
3. Đọc `document.cookie` để lấy `c_user` (Facebook user ID).
4. Kích hoạt sự kiện `browser:profile-account-detected` cho renderer.
5. Cập nhật `facebook_id`, `has_linkedin`, `account_detected_at` và `account_summary` trong cơ sở dữ liệu.

### 5.2 Tóm Tắt Tài Khoản Thủ Công

Người dùng có thể nhập thủ công tóm tắt tài khoản qua `updateBrowserProfileAccountSummary(profileId, summary)`.

---

## 6. Giải Quyết Thư Mục User Data

`BrowserProfileService.resolveSessionUserDataDir()` xác định nơi lưu trữ dữ liệu session của trình duyệt:

```javascript
resolveSessionUserDataDir(scenarioId, browserProfileId, sampleId) {
  if (importedProfile) {
    return profile.import_path;    // Sử dụng thư mục profile đã import
  }
  if (appProfile) {
    return appProfileDir;          // Sử dụng thư mục profile do ứng dụng tạo
  }
  return resolveGuestSessionDir(browserDataRoot, scenarioId, sampleId);
}
```

Guest sessions tạo các thư mục biệt lập tại:
```
{browserDataRoot}/guest/{scenarioId}/{sampleId || 'default'}/
```

---

## 7. Ràng Buộc Profile với Scenario

Một scenario có thể được ràng buộc với một browser profile cụ thể:

| Column | Table | Mục đích |
|--------|-------|---------|
| `browser_profile_id` | `scenarios` | Profile mặc định cho thực thi scenario |

Khi thực thi, nếu không có `browserProfileId` nào được truyền rõ ràng, `browser_profile_id` của scenario sẽ được sử dụng. Điều này đảm bảo trạng thái cookie/session nhất quán cho mỗi luồng tự động hóa.

---

## 8. File Nguồn Chính

| File | Vai trò |
|------|------|
| `src/renderer/pages/BrowserProfilesPage.jsx` | UI quản lý profile (scan, import, tạo, xóa) |
| `src/main/browser/BrowserProfileService.js` | Vòng đời profile: tạo, import, mở, phát hiện tài khoản |
| `src/main/browser/BrowserSessionPaths.js` | Helpers giải quyết thư mục session |
| `src/main/browser/ProfileCookieSync.js` | Đồng bộ cookie giữa các profile và session |
| `src/main/database/DatabaseService.js` | CRUD `browser_profiles` + `proxies` |
| `src/main/rpa/ExecutorService.js` | Khởi chạy trình duyệt với cô lập profile |
| `src/preload/preload.cjs` | `window.electronAPI.*` cho browser profiles |

---

## 9. Kênh IPC

| Channel | Hướng | Mục đích |
|---------|-----------|---------|
| `db:get-browser-profiles` | invoke | Liệt kê tất cả browser profiles |
| `browser:scan-profiles` | invoke | Quét các trình duyệt đã cài để tìm profile |
| `browser:open-profile` | invoke | Mở cửa sổ browser profile |
| `browser:detect-profile-account` | invoke | Tự động phát hiện tài khoản Facebook/LinkedIn |
| `browser:import-profile` | invoke | Import một browser profile bên ngoài |
| `browser:create-blank-profile` | invoke | Tạo app profile trống mới |
| `browser:delete-app-profile` | invoke | Xóa một app profile |
| `db:save-browser-profile` | invoke | Lưu/cập nhật profile trong database |
| `db:delete-browser-profile` | invoke | Xóa profile khỏi database |
| `db:update-browser-profile-account-summary` | invoke | Cập nhật mô tả tài khoản |
| `browser:profile-account-detected` | event | Kết quả phát hiện tài khoản được đẩy đến renderer |
