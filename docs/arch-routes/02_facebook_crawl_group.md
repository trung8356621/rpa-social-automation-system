# Facebook Crawl Group — `/data/facebook`

> **Router Path:** `/data/facebook`
> **Scenario Type:** `request_catching` (platform = `facebook`)
> **Core UI Component:** `src/renderer/pages/FacebookDataPage.jsx`

---

## 1. Khái Niệm Cốt Lõi

**Facebook Data Studio** độc quyền, được tối ưu hóa cho việc **crawl Group feed Công khai/Riêng tư**. Giao diện chỉ khả dụng trong **master builds** (`VITE_APP_ROLE=master`).

**Quan trọng:** Luồng crawl Single Post đã được **tách rời hoàn toàn và loại bỏ khỏi UI**. `FacebookDataPage` chỉ kích hoạt crawl group feed. Không tồn tại modal để dán link bài viết đơn lẻ.

---

## 2. Luồng Kỹ Thuật

```
FacebookDataPage
  → startLocalCampaign({ scenarioId, browserProfileId, variableProfileId, sampleId })
  → ipcMain 'rpa:start-campaign' handler
  → new ExecutorService(...)
  → ExecutorService.startScenario(scenarioId, options)
  → _executeRequestCatchingLive(scenario)
      → puppeteer.launch() với userDataDir isolation
      → Điều hướng đến https://www.facebook.com/groups/{group_id}/
      → URL Guard check (validateFacebookCrawlNavigation)
      → RequestCatchingPuppeteerCapture.start(page, 'facebook', { customFilters, onCapture })
      → Vòng lặp scroll _runRequestCatchingScroll()
      → capture.stop()
      → parseFacebookGraphQLBatch(rawCaptured, { targetUrl, variables })
      → PlatformCrawledDataService.saveFacebookPostsBatch(saveCandidates, groupInfo)
  → Telemetry: rpa:execution-status → FacebookDataPage làm mới
```

### 2.1 Kích Hoạt Campaign

Từ `FacebookDataPage.jsx`, người dùng khởi tạo crawl:

```javascript
window.electronAPI.startLocalCampaign({
  scenarioId: settings['facebook.crawlGroupScenarioId'],
  browserProfileId: settings['facebook.crawlBrowserProfileId'],
  variableProfileId: 'c7f8a901-2b3c-4d5e-8f67-000000000001',
  sampleId: selectedSampleId,
  headless: false,
});
```

Lệnh này gửi một `ipcRenderer.send('rpa:start-campaign', payload)` **một chiều (one-way)** — trạng thái thực thi được truyền ngược về qua các sự kiện `rpa:execution-status`.

### 2.2 System Variable Profile

Một system variable profile được seed tự động khi khởi động:

| Profile ID | Tên | Biến |
|-----------|------|-----------|
| `c7f8a901-2b3c-4d5e-8f67-000000000001` | `__system:facebook-crawl-group` | `group_id`, `post_limit` |

- `group_id`: ID số của nhóm Facebook (ví dụ: `295931577185665`).
- `post_limit`: Số lượng bài viết tối đa tùy chọn trước khi dừng.

Các biến này được ràng buộc trong `DatabaseService.syncFacebookCrawlScenarioBindings()` khi cài đặt được lưu.

### 2.3 Xây Dựng URL

Các hàm helper từ `src/shared/facebookCrawlConfig.js`:

```javascript
buildFacebookGroupUrl(groupId)
// → https://www.facebook.com/groups/{groupId}/?sorting_setting=CHRONOLOGICAL

buildFacebookPostLink(postId, groupId)
// → https://www.facebook.com/groups/{groupId}/posts/{postId}/
```

---

## 3. Request Catching qua Puppeteer

### 3.1 Network Interception

`RequestCatchingPuppeteerCapture` chặn các GraphQL network response của Facebook:

- Chặn các endpoint `*/api/graphql/`.
- Lọc theo `friendlyName` (ví dụ: `GroupsCometFeedRegularStoriesQuery`, `CometUFICommentsProviderQuery`).
- Hợp nhất các JSON payload thô bằng `mergeRequestCatchingRawObjects`.
- Chú thích các object đã chặn với metadata `__request` (friendlyName, URL, source).

### 3.2 URL Guard

Một **URL guard runtime nghiêm ngặt** đảm bảo trình duyệt ở lại đúng trang nhóm dự kiến:

```javascript
validateFacebookCrawlNavigation(expectedUrl, actualUrl)
// → { ok: true } hoặc { ok: false, reason: 'group_mismatch', ... }
```

Nếu trình duyệt điều hướng ra khỏi URL nhóm mục tiêu:
- Một lần thử `goBack()` khôi phục duy nhất ở batch đầu tiên.
- Sau đó, việc cuộn dừng ngay lập tức.
- Ném lỗi nếu khôi phục thất bại: `"Facebook crawl navigation guard failed"`.

### 3.3 Vòng Lặp Scroll

`_runRequestCatchingScroll()` triển khai chiến lược cuộn theo batch:

| Parameter | Nguồn | Mặc định |
|-----------|--------|---------|
| scrollsPerBatch | Cấu hình `crawlMeta.infinity_scroll` | 5 |
| settleMs | Cài đặt `facebook.crawlScrollSettleSeconds` | 4000ms |
| maxScrolls | Cấu hình infinity scroll | 30 |
| timeoutMs | Cấu hình infinity scroll | 30000ms |
| betweenScrollMs | Cấu hình infinity scroll | 500ms |
| stop condition | Infinity scroll `stop_mode = 'condition'` | Field/operator/value |

Mỗi batch cuộn, chờ network idle, sau đó kiểm tra:
1. **Post limit** đạt (`capturedPostIds.size >= postLimit`).
2. **Stop condition** khớp qua `crawlConditionShouldStopScroll()`.
3. **Empty batch** phát hiện (>5 lần cuộn liên tiếp không có dữ liệu mới).
4. **URL guard** — trình duyệt đã đi lạc khỏi trang nhóm.
5. **Scroll bị kẹt** — `isCrawlScrollStuck()`.
6. **Đã cuộn đến đáy** — `isCrawlScrollAtBottom()`.

---

## 4. Phân Tích GraphQL

### 4.1 Parser: `parseFacebookGraphQLBatch`

Nằm tại `src/shared/parseFacebookGraphQL.js`. Chuyển đổi các GraphQL payload thô đã chặn thành các đối tượng post/comment đã chuẩn hóa.

### 4.2 Bất Biến Parser (Quan Trọng)

1. **Story/feed payloads** phải chứa `message`, `styled_message`, `permalink`, hoặc media attachments hợp lệ để trở thành **save candidates**.
2. **Feedback-only payloads** (ví dụ: `GroupsCometFeedRegularStoriesQuery` không có nội dung story) **chỉ merge vào post đã tồn tại** — không tạo dòng post mới.
3. **Comment-only payloads** (ví dụ: `CometUFICommentsProviderQuery`, `display_comments`, các node `Comment` đơn lẻ) **phải được gắn cờ `_comments_only: true`**.
4. Comment-only payloads **nghiêm cấm**:
   - Tạo ra một dòng post mới.
   - Làm rò rỉ nội dung comment vào `post_content`.
5. Các post có `_comments_only === true` hoặc `_feedback_only === true` bị loại khỏi `saveCandidates` trong `_executeRequestCatchingLive()`.

```javascript
const saveCandidates = cleaned.filter((post) => (
  post?.post_id
  && post._comments_only !== true
  && post._feedback_only !== true
));
```

---

## 5. Lưu Trữ

### 5.1 Platform Database

**File:** `{userData}/data/facebook_crawled_data.db`

| Table | Các cột chính |
|-------|-------------|
| `groups` | `group_id` (PK), `group_name`, `group_link`, `group_type` |
| `authors` | `author_id` (PK), `author_name`, `author_link` |
| `posts` | `post_id` (PK), `group_id` (FK), `author_id` (FK), `post_link`, `post_content`, `post_date`, `like_count`, `share_count`, `comment_count`, `post_images`, `local_image_path` |
| `comments` | `comment_id` (PK), `post_id` (FK), `author_id` (FK), `comment_content`, `like_count`, `comment_images` |

### 5.2 Tải Media

`FacebookPostImageDownloader` tải ảnh xuống `{projectRoot}/facebook_media/{post_id}/` trong `saveFacebookPostWithComments()`.

- `post_images`: Mảng đã serialize các đường dẫn tương đối đã tải.
- `local_image_path`: Ảnh đầu tiên đã tải dùng cho thumbnail nhanh.

### 5.3 Chế Độ Supplement

Khi `options.supplement = true`:
- Post hiện có được cập nhật với nội dung mới (chiến lược merge).
- Các trường nội dung thiếu được điền từ dòng hiện có.
- Số lượng tương tác sử dụng `Math.max(existing, incoming)`.
- Post `_comments_only` chỉ merge comment vào post hiện có.

---

## 6. Cài Đặt

Được cấu hình trong `FacebookDataSettingsPage.jsx` và lưu trong bảng `settings` của ứng dụng chính:

| Setting Key | Type | Mục đích |
|------------|------|---------|
| `facebook.crawlGroupScenarioId` | TEXT | UUID của scenario `request_catching` |
| `facebook.crawlScrollSettleSeconds` | INTEGER | Số giây chờ giữa các batch scroll (mặc định: 4) |
| `facebook.crawlBrowserProfileId` | TEXT | UUID của browser profile để cô lập |
| `facebook.crawlProxyId` | TEXT | UUID của cấu hình proxy |

---

## 7. File Nguồn Chính

| File | Vai trò |
|------|------|
| `src/renderer/pages/FacebookDataPage.jsx` | UI Facebook Data Studio — kích hoạt crawl, duyệt posts/comments |
| `src/renderer/pages/FacebookDataSettingsPage.jsx` | Ràng buộc cài đặt crawl |
| `src/renderer/components/FacebookSidebar.jsx` | Điều hướng: Studio / Settings |
| `src/main/main.js` | IPC handlers (`facebook-data:*`) được bảo vệ bởi `assertMasterFacebookDataAccess()` |
| `src/main/rpa/ExecutorService.js` | Thực thi request-catching live |
| `src/main/rpa/RequestCatchingPuppeteerCapture.js` | GraphQL network interception qua CDP |
| `src/shared/parseFacebookGraphQL.js` | GraphQL → posts/comments đã chuẩn hóa |
| `src/shared/facebookCrawlConfig.js` | URL helpers, variable profiles, cài đặt crawl |
| `src/shared/facebookCrawlConfig.js` | System variable profile: `__system:facebook-crawl-group` |
| `src/shared/crawlScroll.js` | Scroll loop helpers cho feed |
| `src/shared/facebookMediaExtract.js` | Trích xuất URL ảnh/video từ dữ liệu đã parse |
| `src/shared/facebookInteractionCounts.js` | Chuẩn hóa số lượng like/share/comment |
| `src/main/media/FacebookPostImageDownloader.js` | Tải media xuống `facebook_media/` |
| `src/main/database/PlatformCrawledDataService.js` | Lưu trữ SQLite theo platform |
| `src/main/rpa/CrawlRequestDumpService.js` | Ghi debug dump cho request đã chặn |
| `src/preload/preload.cjs` | `window.electronAPI.startLocalCampaign`, `onExecutionUpdate`, `facebook-data:*` |

---

## 8. Kênh IPC

| Channel | Hướng | Bảo vệ |
|---------|-----------|-------|
| `facebook-data:get-stats` | invoke | Chỉ Master |
| `facebook-data:list-groups` | invoke | Chỉ Master |
| `facebook-data:list-authors` | invoke | Chỉ Master |
| `facebook-data:list-posts` | invoke | Chỉ Master |
| `facebook-data:list-comments` | invoke | Chỉ Master |
| `facebook-data:delete-post` | invoke | Chỉ Master |
| `facebook-data:resolve-media-url` | invoke | Chỉ Master |
| `facebook-data:open-media-file` | invoke | Chỉ Master |
| `facebook-data:export-csv` | invoke | Chỉ Master |
| `rpa:start-campaign` | send (fire-and-forget) | Cả hai build |
| `rpa:execution-status` | event (main → renderer) | Cả hai build |
