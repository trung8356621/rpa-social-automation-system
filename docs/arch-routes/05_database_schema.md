# Database Schema — System Infrastructure

> **Core Architecture:** Thiết kế Offline-First độc lập với hai cơ sở dữ liệu
> **Engine:** `better-sqlite3` (đồng bộ, chỉ trong main process)
> **Main DB:** `DatabaseService` → `{userData}/database/rpa_local.db`
> **Platform DB:** `PlatformCrawledDataService` → `{userData}/data/{platform}_crawled_data.db`

---

## 1. Kiến Trúc Cốt Lõi

### 1.1 Thiết Kế Offline-First

Ứng dụng sử dụng thiết kế **Offline-First độc lập** với hai cơ sở dữ liệu SQLite độc lập:

1. **Main App Database** (`rpa_local.db`): Scenarios, steps, browser profiles, proxies, executions, settings, variable profiles, campaigns, tasks.
2. **Platform Database** (`{platform}_crawled_data.db`): Dữ liệu đã crawl theo từng nền tảng xã hội (groups, authors, posts, comments, media).

### 1.2 Sẵn Sàng Đồng Bộ

Main database sử dụng:
- **Định danh UUID v4 dạng TEXT** (`crypto.randomUUID()`) cho tất cả khóa chính — không dùng autoincrement integers.
- **Cột `is_dirty` INTEGER** (0/1) trên mọi bảng có thể thay đổi để theo dõi trạng thái đồng bộ cho đồng bộ hóa đám mây trong tương lai.

---

## 2. Main Database Schema (`rpa_local.db`)

### 2.1 Các Bảng

#### `proxies`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL | Tên hiển thị proxy |
| `protocol` | TEXT DEFAULT 'http' | `http`, `https`, `socks5` |
| `ip` | TEXT NOT NULL | Địa chỉ Host/IP |
| `port` | INTEGER NOT NULL | Số cổng |
| `username` | TEXT | Tên người dùng auth (tùy chọn) |
| `password` | TEXT | Mật khẩu auth (tùy chọn) |
| `status` | TEXT DEFAULT 'active' | `active`, `inactive` |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |

#### `browser_profiles`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `browser_key` | TEXT NOT NULL | `chrome`, `edge`, `brave` |
| `browser_name` | TEXT NOT NULL | Tên trình duyệt hiển thị |
| `profile_name` | TEXT NOT NULL | Tên thư mục profile gốc |
| `executable_path` | TEXT NOT NULL | Đường dẫn đến binary trình duyệt |
| `user_data_dir` | TEXT NOT NULL | Thư mục user data gốc của Chrome |
| `profile_dir_name` | TEXT NOT NULL | Thư mục con profile |
| `display_name` | TEXT NOT NULL | Nhãn thân thiện với người dùng |
| `source` | TEXT DEFAULT 'scan' | `scan`, `import`, `app` |
| `status` | TEXT DEFAULT 'active' | `active`, `imported` |
| `last_scanned_at` | TEXT | Thời gian quét lần cuối |
| `imported_at` | TEXT | Thời gian import |
| `import_path` | TEXT | Thư mục nguồn import |
| `facebook_id` | TEXT | ID tài khoản Facebook đã phát hiện |
| `has_linkedin` | INTEGER DEFAULT 0 | Cờ tài khoản LinkedIn |
| `account_detected_at` | TEXT | Thời gian phát hiện tài khoản |
| `account_summary` | TEXT | Mô tả tài khoản thủ công |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |
| *UNIQUE* | `(browser_key, user_data_dir, profile_dir_name)` | |

#### `settings`

| Column | Type | Mô tả |
|--------|------|-------------|
| `option_name` | TEXT PK | Khóa cài đặt |
| `option_value` | TEXT | Giá trị đã JSON-serialize |
| `autoload` | INTEGER DEFAULT 1 | Tải khi khởi động |
| `updated_at` | TEXT | ISO timestamp |

#### `scenarios`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL | Tên scenario |
| `description` | TEXT | Mô tả |
| `platform` | TEXT DEFAULT 'custom' | Nền tảng mục tiêu |
| `target_url` | TEXT | URL với placeholder `{{variable}}` |
| `recorded_width` | INTEGER | Chiều rộng viewport khi ghi |
| `recorded_height` | INTEGER | Chiều cao viewport khi ghi |
| `device_pixel_ratio` | REAL DEFAULT 1.0 | DPR tại thời điểm ghi |
| `preview_path` | TEXT | Đường dẫn file video preview |
| `preview_manifest_path` | TEXT | Đường dẫn JSON manifest preview |
| `preview_duration_ms` | INTEGER | Tổng thời lượng preview |
| `preview_trim_ranges` | TEXT DEFAULT '[]' | Mảng JSON các khoảng trim |
| `browser_profile_id` | TEXT | FK → browser_profiles(id) |
| `variable_profile_id` | TEXT | FK → variable_profiles(id) |
| `local_variables` | TEXT DEFAULT '[]' | Mảng JSON `{key, value, value_type}` |
| `scenario_type` | TEXT DEFAULT 'action' | `prepare`, `crawl`, `action`, `request_catching` |
| `result_type` | TEXT DEFAULT 'simple' | `simple`, `list` |
| `parent_id` | TEXT | FK → scenarios(id) ON DELETE SET NULL |
| `dom_check_anchor` | TEXT | JSON anchor để kiểm tra DOM readiness |
| `is_pinned` | INTEGER DEFAULT 0 | Trạng thái ghim |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |

#### `scenarios_meta`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `meta_key` | TEXT NOT NULL | Khóa metadata |
| `meta_value` | TEXT | Giá trị metadata (JSON hoặc scalar) |
| `updated_at` | TEXT | ISO timestamp |
| *UNIQUE* | `(scenario_id, meta_key)` | |

**Meta keys quan trọng** (một số cột legacy trên `scenarios` đã migrate sang đây):

| `meta_key` | Nội dung |
|------------|----------|
| `variable_profile_id` | FK text → `variable_profiles.id` |
| `local_variables` | JSON `[{key, value, value_type}]` |
| `recorded_width` / `recorded_height` | Viewport đã ghi |
| `result_type` | `simple` \| `list` |
| `dom_check_anchor` | JSON anchor readiness |

`buildScenarioMetaForStorage()` merge payload Save với `existingMeta`; **không** cho `scenario_meta` draft ghi đè `variable_profile_id` / `local_variables` khi không truyền top-level.

#### `scenario_steps`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `step_order` | INTEGER NOT NULL | Chỉ số step (1-based) |
| `action_type` | TEXT NOT NULL | Định danh loại hành động |
| `target_anchor` | TEXT | JSON anchor payload |
| `delay_ms` | INTEGER DEFAULT 300 | Độ trễ cơ sở trước step |
| `created_at` | TEXT | ISO timestamp |

#### `scenario_step_frames`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `step_id` | TEXT NOT NULL | FK → scenario_steps(id) CASCADE |
| `frame_path` | TEXT NOT NULL | Đường dẫn tuyệt đối đến file frame |
| `frame_name` | TEXT | Tên cơ sở của frame |
| `frame_timestamp_ms` | INTEGER | Độ lệch trên timeline |
| `role` | TEXT DEFAULT 'associated' | Vai trò frame |
| `created_at` | TEXT | ISO timestamp |
| *UNIQUE* | `(step_id, frame_path, role)` | |

**Lifecycle frame screenshot:**

| Sự kiện | Hành vi |
|---------|---------|
| Save scenario | Ghi lại `scenario_step_frames` theo `target_anchor.associated_frame` của từng step |
| Xóa step (UI) | Gỡ row step + step_frame; file **giữ** nếu còn trong preview manifest |
| Trim timeline | Xóa frame khỏi manifest → có thể orphan cleanup |
| `_deleteOrphanedScenarioFrames` | `unlink` chỉ khi không còn step_frame **và** không còn trong `preview.json` |

Preview playback đọc `preview_manifest_path` (`preview.json`), không chỉ phụ thuộc `scenario_step_frames`.

#### `scenario_variables`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `key` | TEXT NOT NULL | Khóa của biến |
| `value` | TEXT | Giá trị của biến |
| *UNIQUE* | `(scenario_id, key)` | |

#### `variable_profiles`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL UNIQUE | Tên profile |
| `variables_json` | TEXT DEFAULT '[]' | JSON template keys `{key, value_type}` |
| `is_system` | INTEGER DEFAULT 0 | System profile (được bảo vệ) |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |

#### `variable_profile_samples`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `profile_id` | TEXT NOT NULL | FK → variable_profiles(id) CASCADE |
| `name` | TEXT NOT NULL | Tên mẫu (ví dụ: 'Default') |
| `values_json` | TEXT DEFAULT '[]' | Mục JSON `{key, value, value_type}` |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |
| *UNIQUE* | `(profile_id, name)` | |

#### `campaigns`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL | Tên campaign |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `status` | TEXT DEFAULT 'draft' | `draft`, `active`, `completed` |
| `scheduled_at` | TEXT | Thời gian chạy theo lịch |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |

#### `campaign_profiles`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `campaign_id` | TEXT NOT NULL | FK → campaigns(id) CASCADE |
| `profile_ref` | TEXT NOT NULL | Tham chiếu định danh profile |
| `status` | TEXT DEFAULT 'pending' | `pending`, `running`, `completed`, `failed` |
| `updated_at` | TEXT | ISO timestamp |

#### `execution_errors`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `step_id` | TEXT | FK → scenario_steps(id) ON DELETE SET NULL |
| `object_id` | TEXT NOT NULL | ID tham chiếu đa hình |
| `object_type` | TEXT NOT NULL | Kiểu tham chiếu đa hình |
| `error_code` | TEXT | Mã lỗi đã phân loại |
| `message` | TEXT | Thông báo lỗi / stack trace |
| `screenshot` | TEXT | Đường dẫn file ảnh chụp màn hình |
| `created_at` | TEXT | ISO timestamp |

#### `execution_logs`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `scenario_id` | TEXT NOT NULL | FK → scenarios(id) CASCADE |
| `scenario_name` | TEXT | Ảnh chụp tên scenario |
| `browser_profile_id` | TEXT | Browser profile đã sử dụng |
| `variable_profile_id` | TEXT | Variable profile đã sử dụng |
| `variable_profile_name` | TEXT | Ảnh chụp tên variable profile |
| `variable_sample_id` | TEXT | Sample đã sử dụng |
| `variable_sample_name` | TEXT | Ảnh chụp tên sample |
| `status` | TEXT DEFAULT 'running' | `running`, `completed`, `failed` |
| `total_steps` | INTEGER DEFAULT 0 | Tổng số step |
| `completed_steps` | INTEGER DEFAULT 0 | Số step đã hoàn thành |
| `failed_steps` | INTEGER DEFAULT 0 | Số step thất bại |
| `failed_step_index` | INTEGER | Chỉ số của lỗi đầu tiên |
| `error_message` | TEXT | Thông báo lỗi cấp cao nhất |
| `result_json` | TEXT | Kết quả thực thi đầy đủ (JSON) |
| `duration_ms` | INTEGER | Thời gian thực thi |
| `started_at` | TEXT | ISO timestamp |
| `finished_at` | TEXT | ISO timestamp |
| `is_dirty` | INTEGER DEFAULT 1 | Cờ đồng bộ |
| `updated_at` | TEXT | ISO timestamp |

#### `tasks`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL | Tên task |
| `description` | TEXT | Mô tả |
| `flow_data` | TEXT | Dữ liệu đồ thị luồng JSON |
| `is_active` | INTEGER DEFAULT 1 | Trạng thái hoạt động |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

---

## 3. Tracking Lỗi Đa Hình (Polymorphic Error Tracking)

Bảng `execution_errors` triển khai mẫu **quan hệ đa hình (polymorphic relationship)**:

```sql
CREATE TABLE IF NOT EXISTS execution_errors (
  id          TEXT PRIMARY KEY,
  step_id     TEXT,
  object_id   TEXT NOT NULL,
  object_type TEXT NOT NULL,
  error_code  TEXT,
  message     TEXT,
  screenshot  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (step_id) REFERENCES scenario_steps(id) ON DELETE SET NULL
);
```

### 3.1 Các Kiểu Object Đa Hình

Cặp `object_id` + `object_type` cho phép tham chiếu đến bất kỳ thực thể nào:

| `object_type` | `object_id` tham chiếu | Mục đích |
|---------------|----------------------|---------|
| `campaign_profiles` | UUID trong `campaign_profiles.id` | Theo dõi lỗi trong quá trình thực thi campaign trên nhiều profile |
| `scenario_tests` | UUID trong `scenarios.id` | Theo dõi lỗi từ các lần chạy thử studio |
| `scenarios` | UUID trong `scenarios.id` | Lỗi thực thi scenario tổng quát |
| `execution_logs` | UUID trong `execution_logs.id` | Liên kết lỗi trở lại một lần thực thi |

### 3.2 Định Vị Lỗi Ở Cấp Step

Khóa ngoại `step_id` trỏ đến `scenario_steps.id` cho phép **định vị ngay lập tức node quy trình bị lỗi**:

```
execution_errors.step_id → scenario_steps.id
                            → scenario_steps.action_type (ví dụ: 'click')
                            → scenario_steps.target_anchor (ví dụ: timeout trên selector)
```

Điều này cho phép UI đánh dấu chính xác step nào bị lỗi và tại sao (ví dụ: "click target timeout tại step 4").

---

## 4. Platform Database Schema (`facebook_crawled_data.db`)

Được quản lý bởi `PlatformCrawledDataService` (chỉ master build).

#### `groups`

| Column | Type | Mô tả |
|--------|------|-------------|
| `group_id` | TEXT PK | ID nhóm hoặc slug |
| `group_name` | TEXT | Tên hiển thị |
| `group_link` | TEXT | URL nhóm Facebook |
| `group_type` | TEXT | `Private`, `Public` |

#### `authors`

| Column | Type | Mô tả |
|--------|------|-------------|
| `author_id` | TEXT PK | Profile ID hoặc `name:{slug}` |
| `author_name` | TEXT | Tên hiển thị |
| `author_link` | TEXT | URL profile |

#### `posts`

| Column | Type | Mô tả |
|--------|------|-------------|
| `post_id` | TEXT PK | ID bài viết Facebook |
| `group_id` | TEXT NOT NULL | FK → groups(group_id) |
| `author_id` | TEXT NOT NULL | FK → authors(author_id) |
| `post_link` | TEXT | URL permalink |
| `post_content` | TEXT | Nội dung đã làm sạch |
| `post_date` | TEXT | Thời gian bài viết |
| `like_count` | INTEGER DEFAULT 0 | Số lượng reaction |
| `share_count` | INTEGER DEFAULT 0 | Số lượng chia sẻ |
| `comment_count` | INTEGER DEFAULT 0 | Số lượng bình luận |
| `post_images` | TEXT | Các đường dẫn media đã serialize |
| `local_image_path` | TEXT | File media cục bộ đầu tiên |
| `crawled_at` | DATETIME | Tự động đặt khi insert |

#### `comments`

| Column | Type | Mô tả |
|--------|------|-------------|
| `comment_id` | TEXT PK | SHA-256 hash hoặc ID gốc |
| `post_id` | TEXT NOT NULL | FK → posts(post_id) |
| `author_id` | TEXT NOT NULL | FK → authors(author_id) |
| `comment_content` | TEXT | Nội dung bình luận |
| `like_count` | INTEGER DEFAULT 0 | Số lượt thích |
| `comment_images` | TEXT | Các đường dẫn media đã serialize |
| `crawled_at` | DATETIME | Tự động đặt khi insert |

---

## 5. Các Quyết Định Kiến Trúc Chính

### 5.1 Các Trường JSON

Các trường sau lưu trữ JSON có cấu trúc dưới dạng TEXT trong SQLite và được deserialize khi đọc:

| Table | Column | Nội dung |
|-------|--------|---------|
| `scenarios` | `local_variables` | `[{key, value, value_type}]` — `file` = path thư mục (canonical: `scenarios_meta`) |
| `scenarios` | `preview_trim_ranges` | `[{start, end}]` |
| `scenarios_meta` | `variable_profile_id`, `local_variables`, … | Metadata scenario (xem bảng meta keys §2) |
| `scenario_steps` | `target_anchor` | `{selector_value, relative_coords, action_config, time_offset, associated_frame}` |
| `scenarios_meta` | `meta_value` | JSON metadata tùy ý |
| `variable_profiles` | `variables_json` | `[{key, value_type}]` — skeleton schema (xem [06_variable_templates.md](./06_variable_templates.md)) |
| `variable_profile_samples` | `values_json` | `[{key, value, value_type}]` |
| `execution_logs` | `result_json` | Kết quả thực thi đầy đủ |
| `tasks` | `flow_data` | `{nodes, edges}` |
| `browser_profiles` (tương lai) | `account_summary` | Thông tin tài khoản linh hoạt |

### 5.2 System Variable Profiles

Được seed khi khởi động và bảo vệ khỏi việc xóa:

| ID | Tên | Biến |
|----|------|-----------|
| `c7f8a901-2b3c-4d5e-8f67-000000000001` | `__system:facebook-crawl-group` | `group_id`, `post_limit` |

### 5.3 Chiến Lược Migration

Schema migrations có tính **idempotent và an toàn để chạy mỗi lần khởi động**:

- `PRAGMA table_info(table_name)` kiểm tra sự tồn tại của cột.
- `ALTER TABLE ADD COLUMN` cho các cột mới.
- `CREATE TABLE IF NOT EXISTS` cho các bảng mới.
- Khởi tạo dựa trên transaction trong `DatabaseService.initSchema()`.
- Phát hiện schema xử lý đường dẫn migration từ legacy đến hiện tại.

---

## 6. File Nguồn Chính

| File | Vai trò |
|------|------|
| `src/main/database/DatabaseService.js` | Main app database: CRUD, schema, migrations, transactions |
| `src/main/database/PlatformCrawledDataService.js` | Platform databases: Facebook schema, post/comment persistence |
| `src/main/main.js` | Khởi tạo database, đăng ký IPC handler |
| `src/shared/facebookCrawlConfig.js` | Hằng số system variable profile |
