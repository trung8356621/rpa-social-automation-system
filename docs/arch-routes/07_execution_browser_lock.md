# Execution Browser Lock

> **Mục đích:** Khóa tương tác vật lý của người dùng với browser automation trong lúc Execute.  
> **Phạm vi:** Chỉ `ExecutorService` / Execute — **không** áp dụng Record, Open Browser, Replay preview, Screenshot, Frame Capture, Video Render.  
> **Cập nhật:** 2026-07-15

---

## 1. Mục Đích

Browser mở bởi Execute là **browser dành riêng cho automation**, không phải browser người dùng.

Trong lúc workflow chạy, người dùng **không** được:

- Click / gõ / scroll / drag / resize / focus để thao tác

Nhưng:

- Browser vẫn **render** bình thường
- **Puppeteer / CDP** vẫn click, type, upload bình thường
- Sau khi Execute kết thúc hoặc lỗi → browser **mở khóa hoàn toàn**

---

## 2. Lifecycle & Flow

```
Execute bắt đầu
  → ExecutorService._launchBrowser()
  → prepare BrowserZoom (Preferences, default 67%)
  → puppeteer.launch → goto start URL → apply BrowserZoom
  → ExecutionBrowserLockService.lock(executionId)
  → Chạy toàn bộ workflow (+ parent + request_catching nếu có)
  → _cleanupBrowser() (settle delay → đóng Chrome)
  → finally: unlock(executionId)   ← luôn chạy
Kết thúc
```

| Sự kiện | Hành vi lock |
|---------|----------------|
| Execute start (headed) + `execution_browser_lock=true` | `lock()` |
| Execute headless | Skip lock |
| Setting `execution_browser_lock=false` | Skip lock |
| Execute success / fail / throw | `unlock()` trong `finally` |
| Watchdog timeout (mặc định 30 phút) | Force unlock |
| App `before-quit` / process exit | `unlockAll()` |

**Quy tắc cứng:** không được tồn tại trường hợp browser còn khóa sau khi workflow crash.

---

## 3. Service

**File:** `src/main/rpa/ExecutionBrowserLockService.js`

| API | Vai trò |
|-----|---------|
| `lock({ executionId, browser, page, headless })` | Khóa theo execution |
| `unlock(executionId)` | Mở khóa (idempotent) |
| `isLocked(executionId?)` | Trạng thái |
| `unlockAll(reason)` | Mở khóa mọi session |

Executor **chỉ gọi service** — không tự implement logic Win32/overlay.

```
getExecutionBrowserLockService()  // singleton
```

---

## 4. Strategy Pattern

| Strategy | Platform | Cơ chế |
|----------|----------|--------|
| `Win32DisableWindowStrategy` | Windows (ưu tiên) | `EnableWindow(hwnd, FALSE)` trên cửa sổ Chromium theo PID tree |
| `OverlayWindowStrategy` | Fallback (Electron) | `BrowserWindow` transparent always-on-top phủ lên cửa sổ Chrome |
| `CompositeBrowserLockStrategy` | Mặc định | Thử Win32 → Overlay |

**Không dùng:**

- `BlockInput(true)` (khóa cả desktop / Electron)
- Pause browser / disable renderer
- CSS overlay trong page (Puppeteer vẫn cần DOM thật; user có thể bypass chrome UI)

CDP `Input.dispatch*` inject vào Blink — **không** phụ thuộc message queue Win32 của HWND đã disable.

Refresh định kỳ (~2s) khi lock: cửa sổ Chrome mới mở trong lúc Execute cũng bị disable / cập nhật overlay bounds.

---

## 5. Watchdog

- Mỗi `lock()` gắn timer (mặc định **30 phút**)
- Hết hạn → log `[BrowserLock] Watchdog force unlock.` → `unlock()`
- Process `exit` / `SIGINT` / `SIGTERM` / Electron `before-quit` → best-effort unlock

---

## 6. Config

| Key | Mặc định | UI |
|-----|----------|-----|
| `execution_browser_lock` | `true` | Settings → Automation |

Tắt setting → Execute chạy như cũ, không lock.

---

## 7. Các Trường Hợp Unlock

1. `finally` sau Execute (success hoặc exception)
2. Watchdog timeout
3. `unlockAll` khi app quit
4. Gọi `unlock` lặp lại → no-op an toàn (`alreadyUnlocked`)

---

## 8. Không Ảnh Hưởng

| Luồng | Lock? |
|-------|-------|
| Execute (`rpa:start-campaign` → `ExecutorService`) | Có (nếu setting bật + headed) |
| Record | Không |
| Open Browser / Browser Profile session | Không |
| Replay / Preview frame / Screencast | Không |
| Screenshot / Video render | Không |

---

## 9. Log

```
[BrowserLock] Lock browser.
[BrowserLock] Locked via win32_disable_window (execution=...).
[BrowserLock] Unlock browser.
[BrowserLock] Watchdog force unlock.
[BrowserLock] Skip lock (headless).
[BrowserLock] Skip lock (execution_browser_lock=false).
```

---

## 10. Lưu Ý Bảo Trì

1. **Không** nhét EnableWindow / overlay vào `ExecutorService` — chỉ gọi service.
2. Đổi cơ chế lock = thêm/sửa Strategy, không sửa Executor.
3. Parallel Execute: mỗi `executionId` một lock session (theo PID browser của instance đó).
4. Sau khi đổi Win32 script, kiểm tra: Puppeteer click/type vẫn OK; user click Chrome bị chặn; Record vẫn tương tác được.
5. Nếu lock fail (không tìm thấy HWND), log warning — Execute **vẫn chạy** (fail-open), không chặn automation.

---

## 11. File Liên Quan

| File | Vai trò |
|------|---------|
| `src/main/rpa/ExecutionBrowserLockService.js` | Service + strategies + watchdog |
| `src/main/rpa/ExecutorService.js` | `lock` sau launch, `unlock` trong `finally` |
| `src/main/main.js` | Default setting + `unlockAll` on quit |
| `src/renderer/pages/SettingsPage.jsx` | Toggle UI |
| `src/renderer/slices/settingsSlice.js` | Default `true` |
