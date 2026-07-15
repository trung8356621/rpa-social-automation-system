# Variable Templates — `/data-profiles`

> **Router / UI:** Data Profiles / Variable templates  
> **Core UI:** `src/renderer/components/DataProfilesManager.jsx`  
> **Scenario values panel:** `src/renderer/components/ScenarioVariablesBar.jsx`  
> **Persistence:** `src/main/database/DatabaseService.js` (`variable_profiles`, `variable_profile_samples`, `scenarios.local_variables`)

---

## 1. Ba Lớp Biến

| Lớp | Lưu ở đâu | Vai trò | Shape JSON |
|-----|-----------|---------|------------|
| **Template skeleton** | `variable_profiles.variables_json` | Schema: danh sách key + type | `[{ key, value_type }]` |
| **Samples** | `variable_profile_samples.values_json` | Bộ value dùng lại cho cùng skeleton | `[{ key, value, value_type }]` |
| **local_variables** | `scenarios` / `scenarios_meta` | Value thực tế của một kịch bản (executor đọc đây) | `[{ key, value, value_type }]` |

### `value_type`

| Type | Ý nghĩa |
|------|---------|
| `text` (mặc định) | Chuỗi cho URL / input text / `{{}}` placeholders |
| `file` | Đường dẫn **thư mục** tuyệt đối (`selectDirectory`). Executor quét file hợp lệ trong thư mục (1 cấp) rồi `uploadFile(...paths)`. |

Template **không** lưu value — chỉ schema. Value nằm ở Samples hoặc `local_variables`.

---

## 2. Luồng Đồng Bộ

```
Variable template (skeleton: key + type)
        │
        ├── apply profile vào scenario
        │     → merge keys+type vào local_variables (giữ value nếu key đã có)
        │
        ├── Samples (value sets)
        │     → stamp type từ skeleton khi save sample
        │
        └── Scenario Variables panel
              ↔ chỉnh value / type tại local_variables
              → Quick save template: copy key+type vào skeleton
              → Quick save sample: lưu values (+ type stamp từ skeleton)
```

### Áp dụng profile (`setScenarioVariableProfileId`)

1. Đọc skeleton của profile.
2. Merge vào `local_variables`: keys + `value_type` từ template; **giữ** value hiện có nếu key trùng.
3. Backward-compat: skeleton cũ chỉ có `{key}` (không có `value_type`) → nếu local đã là `file`, **giữ** type local.

**Save / Record:** `buildScenarioMetaForStorage` không cho `scenario_meta` stale từ editor draft ghi đè `variable_profile_id` hay `local_variables`. Chỉ cập nhật hai field này khi payload top-level truyền rõ (hoặc giữ giá trị đã có trong `scenarios_meta`).

**Luồng Record (giữ template + sample):**

```
Chọn template (DataProfileSelect)
  → setScenarioVariableProfile → scenarios_meta.variable_profile_id + merge skeleton keys
Chọn sample (ScenarioVariablesBar)
  → saveScenarioLocalVariables → scenarios_meta.local_variables
Bấm Record
  → persist() dùng activeVariableProfileIdRef (không mất template do React state chậm)
  → saveScenario: buildScenarioMetaForStorage giữ profile + variables đã có
  → RecorderService._finalizeRecordingSession: merge currentScenario từ DB, giữ variable_profile_id
```

**Race đã xử lý:**

| Vấn đề | Cách xử lý |
|--------|------------|
| Template reset về "(No template)" sau Record | Ref sync trong `persist`; không ghi đè bằng `scenario_meta` cũ |
| `getScenarioDetails` trả `variable_profile_id` null làm mất UI | Load details: `serverProfile \|\| localProfile` — không wipe selection mới hơn |
| `DataProfileSelect` tự clear khi reload list | Bỏ `onChange('')` khi profile chưa có trong list; giữ option ẩn cho id hiện tại |
| Scenario bị double khi Save nhanh | `persistInFlightRef` + `currentScenarioIdRef` tái dùng id |

### Lưu template từ Data Profiles

Sau khi save skeleton, mọi scenario đang gắn `variable_profile_id` đó được **re-merge** keys/types vào `local_variables`. Redux `fetchLocalScenarios` được gọi từ UI để danh sách Scenarios cập nhật.

---

## 3. UI

### Scenario header (`ScenarioEditor`)

- **`DataProfileSelect`:** dropdown template gắn scenario (`variable_profile_id`). Không tự reset khi danh sách template reload.
- **`ScenarioVariablesBar`:** CRUD `local_variables`, chọn/áp sample, quick save sample.

### Variable templates (`DataProfilesManager`)

- **Key list (skeleton):** key + select type (`text` / `file`).
- **Samples:** value editor; key type=`file` → chọn thư mục (`selectDirectory`), `value` = path thư mục.

### Scenario Variables (`ScenarioVariablesBar`)

- CRUD `local_variables` trực tiếp trên scenario.
- Selectbox **Sample**: chỉ liệt kê sample của template đang gắn scenario (`variable_profile_id`). Chọn sample → ghi values vào `local_variables`.
- **Save sample** → lưu bộ value hiện tại thành sample mới của cùng template.

Chi tiết bước file upload (`action_type: file`, `variable_key`) xem [01_studio_editor.md](./01_studio_editor.md) § File Input.

---

## 4. System Profiles

Được seed khi init DB, `is_system = 1`, không cho sửa/xóa từ UI:

| ID | Tên | Keys (text) |
|----|-----|-------------|
| `c7f8a901-2b3c-4d5e-8f67-000000000001` | `__system:facebook-crawl-group` | `group_id`, `post_limit` |

---

## 5. File Nguồn

| File | Vai trò |
|------|---------|
| `src/renderer/components/DataProfilesManager.jsx` | CRUD template + samples |
| `src/renderer/components/ScenarioVariablesBar.jsx` | CRUD local_variables + quick save |
| `src/renderer/components/DataProfileSelect.jsx` | Chọn template gắn scenario |
| `src/renderer/pages/DataProfilesPage.jsx` | Trang Variable templates |
| `src/main/database/DatabaseService.js` | `normalizeTemplateKeys`, merge, stamp sample types, sync linked scenarios |
| `src/shared/facebookCrawlConfig.js` | Hằng số system profile |

Schema tổng quan: [05_database_schema.md](./05_database_schema.md).

---

## 6. Thực thi file folder

Khi biến `value_type=file`, `value` là đường dẫn thư mục. `ExecutorService._executeFile` gọi `expandUploadPaths()`:

1. Đọc `value` (folder và/hoặc file; nhiều path cách nhau bằng `;`).
2. Nếu là thư mục → liệt kê file **một cấp** (không đệ quy), bỏ file ẩn.
3. Lọc theo `accept` của step; nếu `accept` trống → chỉ giữ ảnh/video mặc định (jpg/png/webp/mp4/mov/…).
4. `ElementHandle.uploadFile(...paths)` với toàn bộ file hợp lệ.

Module: `src/main/rpa/expandUploadPaths.js`.
