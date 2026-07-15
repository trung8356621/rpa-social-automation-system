# Studio Editor — `/studio/editor`

> **Router Path:** `/studio/editor`
> **Scenario Type:** `action`, `crawl`, `prepare`, `interact`, `check`
> **Core UI Component:** `src/renderer/components/ScenarioEditor.jsx`

---

## 1. Khái Niệm Cốt Lõi

Giao diện timeline tuyến tính phong cách **Adobe Premiere Pro** với **diamond keyframes (♦)** dành cho việc tạo kịch bản (scenario). Studio Editor là không gian làm việc chính để xây dựng, chỉnh sửa, xem trước và xuất bản các kịch bản tự động hóa RPA.

Mỗi bước (step) trong một kịch bản được biểu diễn dưới dạng keyframe trên timeline. Các bước được sắp xếp thứ tự (`step_order`), phân loại (`action_type`), và neo vào các target DOM ngữ nghĩa (`target_anchor`).

---

## 2. Engine Render (Không Dùng Native Video)

Studio Editor **từ chối cơ chế rendering video native của cửa sổ runtime**. Thay vào đó, nó sử dụng Puppeteer CDP frame capture:

| Component | Công nghệ | Mục đích |
|-----------|-----------|---------|
| Frame capture | `Page.startScreencast` qua Puppeteer CDP | Chụp ảnh chụp nhanh tuần tự trạng thái trình duyệt trong quá trình ghi |
| Cache directory | `{userData}/cache/scenarios/{scenarioId}/frames/` | Lưu trữ file frame `.png`/`.jpg` cục bộ |
| Preview playback | Hiển thị frame tuần tự qua giao thức `rpa-cache://` | Phát lại chuỗi frame theo khoảng thời gian đã ghi |
| Video export | `fluent-ffmpeg` (binary đóng gói trong Electron distribution) | Ghép chuỗi frame thành `.mp4` khi xuất bản |

### 2.1 Luồng Frame Capture

```
RecorderService.startRecording()
  → puppeteer.launch() với viewport đã ghi
  → Tái sử dụng tab about:blank mặc định của Chromium (đóng tab thừa) — tránh mở 2 tab trống
  → page.goto(targetUrl) sau khi resolve {{variables}}
  → Screenshot ~4 FPS sau khi trang load
  → Frame events được ghi vào {storageDir}/scenarios/{scenarioId}/frames/
  → Mỗi step được liên kết với một frame qua bảng scenario_step_frames
```

### 2.2 Lắp Ráp Preview

Khi phát lại hoặc xem trước:

1. `readPreviewFrames(manifestPath)` đọc manifest `preview.json` từ `{storageDir}/preview.json`.
2. Manifest chứa các mục frame có thứ tự với `timestamp`, `fileName`, `filePath`.
3. React UI render các frame tuần tự trên timeline sử dụng URL `rpa-cache://file/{base64url}`.
4. Tọa độ được chuẩn hóa: `relative_coords` đã ghi được lưu dưới dạng phần trăm, sau đó chuyển đổi sang pixel viewport thực thi qua công thức `(coords.percent / 100) * viewport.pixels`.

### 2.3 Xuất Bản Video (Fluent-FFMPEG)

Khi người dùng nhấn **Publish / Render Video**:

```
recorderService.renderVideo(scenarioId)
  → Đọc tất cả đường dẫn frame từ scenario_step_frames
  → Khởi tạo binary fluent-ffmpeg (đóng gói qua ffmpeg-static)
  → Ghép frame tại FPS đã cấu hình
  → Đầu ra: {userData}/cache/scenarios/{scenarioId}/preview.mp4
  → Kết quả IPC trả về; shell.openPath() nếu thành công
```

---

## 3. Loại Step và Timeline

Studio Editor hỗ trợ các giá trị `action_type` sau thông qua trình chỉnh sửa timeline:

| Action Type | Icon | Hành vi |
|-------------|------|---------|
| `navigate` | → | `page.goto(url)` với giải mã biến (variable resolution) |
| `click` | 🖱 | Click ưu tiên tọa độ, fallback bằng selector |
| `input` / `type` | ⌨ | `page.keyboard.type()` với độ trễ ngẫu nhiên theo từng ký tự; **khi ghi `input[type=file]`** browser chỉ trả `C:\fakepath\<tên file>` — xem §4 |
| `scroll` | ↕ | `window.scrollTo()` hoặc cuộn phần tử |
| `wait` | ⏳ | `randomDelay(duration)` |
| `crawl` | 🕸 | DOM extraction với autoscroll/infinite-scroll |
| `request_catching` | 📡 | GraphQL network interception (loại ở cấp scenario) |

### 3.1 Hệ Thống Diamond Keyframe (♦)

Mỗi step được hiển thị dưới dạng hình thoi (♦) trên track timeline ngang:

```
| ♦ navigate | ♦ click | ♦ input | ♦ scroll | ♦ wait | ♦ crawl |
|────────────|─────────|─────────|──────────|────────|─────────|
| 0ms        | 1200ms  | 2500ms  | 3800ms   | 4200ms | 6000ms  |
```

- **Recording mode:** Steps tự động được thêm vào khi người dùng tương tác với embedded browser. Frame được chụp tại mỗi tương tác.
- **Edit mode:** Steps có thể được sắp xếp lại thứ tự, xóa, hoặc chỉnh sửa thuộc tính qua `StepEditPanel`.
- **Trim mode:** `preview_trim_ranges` (mảng JSON) lưu điểm trim in/out để nén video xuất bản.

**Đồng bộ thời gian step ↔ keyframe:**

| Thành phần | Hàm / hành vi |
|------------|----------------|
| Timestamp trên `StepCard` | `getStepTimestamp(step, index, steps)` — ưu tiên `target_anchor.time_offset`, fallback tích lũy `delay_ms` |
| Vị trí diamond trên `Timeline` | Cùng `getStepTimestamp` |
| Click diamond | Gọi `handleSelectStep(index)` → nhảy playhead + highlight step trong LIST |
| Highlight diamond đỏ | `selectedStepIndex === idx` hoặc playhead gần `displayTime` |

**Program Monitor:** giữ frame URL gần nhất khi selection/URL tạm mất (xóa step, bỏ chọn) — tránh chớp canvas.

### 3.2 Panel LIST SCENARIO STEPS

Panel **List scenario steps** nằm ở cột phải của `StandardScenarioEditorContent.jsx`, bên cạnh Program Monitor (preview frame). Đây là danh sách dọc các bước đã ghi hoặc thêm thủ công.

```
┌─────────────────────────┬──────────────────────────────────┐
│  Program Monitor        │  LIST SCENARIO STEPS  (N steps)  │
│  (frame preview)        │  ┌────────────────────────────┐  │
│                         │  │ ♦ scroll        00:00.0    │  │
│  00:38.0 / 00:53.1      │  │ ♦ click         00:12.5    │  │
│  [◀ ▶ ▶]               │  │ ♦ input         00:38.0    │  │
│                         │  │   input.x1s85apg → "C:\..│  │
│                         │  └────────────────────────────┘  │
│                         │  Step Edit Panel (inspector)     │
└─────────────────────────┴──────────────────────────────────┘
│              TIMELINE KEYFRAMES (♦)                          │
└──────────────────────────────────────────────────────────────┘
```

| Thành phần | File / hàm | Vai trò |
|------------|------------|---------|
| Danh sách step | `StepCard` trong `ScenarioEditor.jsx` | Card mỗi bước: icon, mô tả i18n, timestamp, selector/text phụ |
| Thanh action thủ công | `ActionIconBar` | Thêm `navigate` / `click` / `input` / `wait` bằng icon |
| Inspector step | `StepEditPanel` | Form chỉnh `action_type`, selector/URL, text, delay |
| Đồng bộ timeline | `handleSelectStep` | Click card hoặc diamond → nhảy playhead + chọn keyframe tương ứng |
| Chuẩn hóa state | `normalizeSteps()` | Parse `target_anchor` JSON, nâng `action_config` lên top-level step |
| Timestamp chung | `getStepTimestamp()` | Nguồn thời gian duy nhất cho LIST + TIMELINE KEYFRAMES |

**Hiển thị mỗi card (`StepCard`):**

- Tiêu đề: `describeStep(action_type)` qua i18n (`scenarioEditor.stepDescriptions.*`)
- `click`: hiện CSS selector + badge skip-if-checked (nếu có)
- `input` / `type`: hiện `selector → "text"` (cả file input)
- `wait`: hiện `duration` ms
- Timestamp: ưu tiên `target_anchor.time_offset` (thời điểm ghi thật), fallback tích lũy `delay_ms` — **cùng nguồn** với vị trí diamond trên TIMELINE KEYFRAMES

**Sau khi Stop Record**, renderer nhận steps từ IPC `scenario:stop-recording` → `normalizeSteps()` → `setSteps()` → panel refresh ngay, không cần Save thủ công (DB đã ghi trong `RecorderService._finalizeRecordingSession`).

**Xóa step:** chỉ gỡ step khỏi LIST / timeline keyframe ♦ — **không xóa** file screenshot tương ứng. Preview timeline giữ nguyên frame (tránh chớp Program Monitor). File frame chỉ bị dọn khi trim timeline bỏ khỏi preview manifest, hoặc khi xóa cả scenario.

**Giữ frame khi xóa step (renderer + main):**

1. `handleDeleteStep` / `handleDeleteSelectedSteps` — chuyển `associated_frame` của step bị xóa sang `manifestFrames` nếu chưa có.
2. `DatabaseService._deleteOrphanedScenarioFrames` — **không** `unlink` file còn nằm trong preview manifest (`preview.json`).
3. `ProgramMonitor` — hiển thị `lastFrameUrlRef` khi `currentFrameUrl` tạm null.

### 3.3 Lưu kịch bản & Record

**Luồng Save (`persist`):**

```
User bấm Save / Record (chưa có id)
  → persist() dùng currentScenarioIdRef + activeVariableProfileIdRef (sync, không chờ React state)
  → persistInFlightRef khóa — tránh 2 lần Save tạo 2 scenario UUID
  → db:save-scenario với variable_profile_id từ ref
  → setScenarioIdSafe(saved.id) — cập nhật ref + state ngay
```

**Luồng Record:**

```
User bấm Record (chưa có steps)
  → persist() — đảm bảo có scenario id + template đã lưu
  → setScenarioVariableProfile (nếu cần re-attach template sau save)
  → scenario:start-recording
  → RecorderService: reuse tab Chromium mặc định, goto URL đã resolve biến
  → Stop Record → saveScenario giữ variable_profile_id + local_variables từ DB
```

**Tạo mới từ ScenariosPage:** draft `id: null` → lần Save đầu gán UUID; không tạo bản ghi thứ hai nếu bấm Save/Record liên tiếp. `ScenarioEditor` mount với `key={currentScenario.id || 'draft'}`.

**Template + sample:** chọn template ở `DataProfileSelect`, áp sample trong `ScenarioVariablesBar` → `local_variables`. Chi tiết persistence xem [06_variable_templates.md](./06_variable_templates.md) §2.

---

## 4. Xử Lý Widget Sau Khi Ghi (Post-Record)

### 4.1 Bảng loại widget (taxonomy)

| Loại | `action_type` / vị trí | Capture khi Record | UI sau record | Executor |
|------|------------------------|--------------------|---------------|----------|
| Navigate | `navigate` | URL change / manual add | Step Edit: URL + `{{var}}` | `page.goto()` |
| Click | `click` | `click` event + anchor | Selector, skip-if-checked | `_executeClick()` |
| Text input | `input` / `type` | `input` trên ô text | VariableInput text | `keyboard.type()` |
| Debounce keydown | `debounce_keydown` | Burst `keydown` trên contenteditable/ô text | Icon + nhãn riêng, VariableInput text | `keyboard.type()` |
| **File input** | `file` | `input` trên `input[type=file]` → promote | Biến `value_type=file` + rule text Platform | `uploadFile()` |
| Scroll | `scroll` | wheel / scroll burst | (chỉ xem) | `_executeScroll()` |
| Wait | `wait` | manual / timing | duration ms | `_sleep()` |

**Debounce keydown (Global capture khi Record):** bật/tắt bằng checkbox trong **Scenario info** (`action` / `prepare`). Mỗi lần người dùng gõ trên ô editable → sau `debounce_ms` ngừng gõ → chèn một step `debounce_keydown` có icon riêng vào LIST SCENARIO STEPS.

### 4.2 Luồng chung sau Stop Record

```
Stop Record
  → RecorderService._finalizeRecordingSession()
    → _buildSteps() + saveScenario()
  → IPC scenario:stop-recording
  → ScenarioEditor.handleRecordClick()
    → normalizeSteps()  // promote file input, parse target_anchor
    → setSteps() → LIST SCENARIO STEPS refresh
```

`normalizeSteps()` gọi `promoteFileInputStep()`: step `input`/`type` có `anchor.type === 'file'` hoặc text `C:\fakepath\...` → `action_type: 'file'`.

### 4.3 Widget File (`action_type: file`)

#### Capture (RecorderService)

Injected script gửi `action_type: 'file'` khi target là `input[type=file]` (hoặc legacy `input` + fakepath, được promote ở renderer).

Anchor gồm `tagName`, `type`, `accept`, `ariaLabel`, `selector_value`, `relative_coords`, frame.

#### `C:\fakepath\`

Chromium **không** expose path thật. `target.value` luôn dạng `C:\fakepath\<filename>`. Sau promote, fakepath **bị xóa** khỏi `action_config.text`; người dùng gán biến file.

#### Biến scenario (`local_variables`)

Mỗi biến có `value_type`:

| `value_type` | Ý nghĩa | Gán giá trị |
|--------------|---------|-------------|
| `text` (mặc định) | Chuỗi cho URL / input text | Nhập text |
| `file` | Đường dẫn **thư mục** tuyệt đối (chọn folder) | Panel **Variables** → type File → Chọn thư mục |

JSON lưu trong `scenarios.local_variables` / `scenario_meta.local_variables`:

```json
[
  { "key": "images", "value": "D:\\media\\batch", "value_type": "file" }
]
```

> **Thực thi:** biến `file` = path thư mục → `expandUploadPaths` lấy ảnh/video hợp lệ rồi `uploadFile(...paths)`. Chi tiết: [06_variable_templates.md](./06_variable_templates.md) §6.

Skeleton schema và samples dùng lại cùng `value_type` — xem [06_variable_templates.md](./06_variable_templates.md).

Trong panel **Variables**: selectbox Sample chỉ hiện sample của template đã chọn ở header; chọn sample sẽ áp values vào `local_variables`.

#### Step config sau record

```json
{
  "action_type": "file",
  "target_anchor": {
    "selector_value": "input.x1s85apg",
    "type": "file",
    "accept": "image/*,video/*",
    "action_config": {
      "selector": "input.x1s85apg",
      "variable_key": "media_path"
    }
  }
}
```

| Field | Mô tả |
|-------|--------|
| `variable_key` | Key biến `value_type=file` (không có `{{}}`) |

**Step Edit Panel:** dropdown biến file + **rule text theo Platform** (Facebook: chấp nhận gần hết ảnh/video). Không còn field Allowed file types / Max file size — Facebook tự validate trong picker.

**LIST SCENARIO STEPS:** nhãn i18n `Upload file to input` · `selector → {{media_path}}`.

#### Executor (`_executeFile`)

1. Resolve `{{variable_key}}` qua `buildVariableMap`
2. Từ chối `C:\fakepath\`
3. `expandUploadPaths`: folder → danh sách file hợp lệ (1 cấp); path file giữ nguyên; `;` = nhiều nguồn
4. `ElementHandle.uploadFile(...paths)`

### 4.4 Debounce keydown → step trong LIST SCENARIO STEPS

Checkbox **Debounce keydown** nằm trong **Scenario info** của scenario `action` / `prepare`. Config được lưu theo scenario và chỉ capture khi checkbox bật.

**Vấn đề:** Facebook và nhiều SPA dùng `contenteditable` — sự kiện `input` không fire (listener `input` chỉ xử lý phần tử có `.value`).

**Cách hoạt động:**

1. Listener `keydown` (capture) trên toàn document trong suốt quá trình Record
2. Tìm ô editable gần nhất: `contenteditable`, `textarea`, `input` text, `role=textbox`
3. Mỗi phím reset timer debounce
4. Sau `debounce_ms` không gõ thêm → đọc **nội dung thật** (`innerText` / `value`) → chèn step `debounce_keydown` vào LIST SCENARIO STEPS với icon/nhãn riêng
5. `_mergeTypeEvents()` gộp burst input cùng target

Config tại `scenario_meta.global_widgets.debounce_keydown`:

```json
{
  "enabled": true,
  "debounce_ms": 300
}
```

Ví dụ Facebook *Tạo bài viết*: gõ *"Test kịch bản auto..."* → sau 300ms dừng gõ → LIST SCENARIO STEPS có step `debounce_keydown` với full text + anchor contenteditable.

### 4.5 Widget text input (tham chiếu)

```json
{
  "action_type": "input",
  "target_anchor": {
    "action_config": {
      "selector": "textarea",
      "text": "{{message}}"
    }
  }
}
```

Khác file: dùng `VariableInput` text, không có accept/max size.

### 4.6 Crawl widget (ngoài phạm vi record)

| | Action / prepare (record) | Crawl (design mode) |
|--|---------------------------|---------------------|
| Tạo step | Tự động khi tương tác | Click element Design mode |
| `action_type` | `click`, `input`, `file`, `scroll`, … | `crawl` |
| Config | `target_anchor.action_config` | `widget_type`, `extract_mode`, `children` |
| Panel | LIST STEPS + Step Edit | `CrawlWidgetPanel` |

---

## 5. Chuẩn Hóa Tọa Độ

Tọa độ ghi lại được lưu dưới dạng **phần trăm tương đối với viewport**:

```json
{
  "relative_coords": {
    "x": 45.2,
    "y": 32.8
  }
}
```

Tại thời điểm thực thi, `ExecutorService._executeClick()` chuyển đổi:

```javascript
const x = Math.round((coords.x / 100) * viewport.width);
const y = Math.round((coords.y / 100) * viewport.height);
```

Điều này đảm bảo các step đã ghi hoạt động trên nhiều kích thước viewport khác nhau (tính chống chịu).

---

## 6. Database Model

### Bảng `scenario_steps`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT (UUID) | Khóa chính |
| `scenario_id` | TEXT (UUID) | FK → scenarios(id) ON DELETE CASCADE |
| `step_order` | INTEGER | Thứ tự trong scenario (1-based) |
| `action_type` | TEXT | `navigate`, `click`, `input`, `file`, `scroll`, `wait`, `crawl` |
| `target_anchor` | TEXT (JSON) | Semantic anchor: `selector_value`, `ariaLabel`, `relative_coords`, `action_config` |
| `delay_ms` | INTEGER | Độ trễ cơ sở trước step này (mặc định 300) |

### Bảng `scenario_step_frames`

| Column | Type | Mô tả |
|--------|------|-------------|
| `id` | TEXT (UUID) | Khóa chính |
| `scenario_id` | TEXT (UUID) | FK → scenarios(id) |
| `step_id` | TEXT (UUID) | FK → scenario_steps(id) |
| `frame_path` | TEXT | Đường dẫn tuyệt đối đến file frame |
| `frame_name` | TEXT | Tên cơ sở của file frame |
| `frame_timestamp_ms` | INTEGER | Độ lệch millisecond trên timeline |
| `role` | TEXT | `'associated'` (liên kết với step) |

---

## 7. Cấu Hình Độ Trễ Thực Thi (`randomDelay`)

Tất cả độ trễ thực thi step đều đi qua một hàm tập trung:

```javascript
function randomRuntimeDelay(baseMs = 300, minMs = 120, maxMs = 1500) {
  const base = Math.max(1, Number(baseMs));
  const factor = 0.7 + Math.random() * 1.1; // [0.75, 1.4]
  return Math.round(Math.max(minMs, Math.min(maxMs, base * factor)));
}
```

**Quy tắc chính:** Không được dùng `setTimeout` cứng với giá trị tĩnh. Mọi độ trễ tương tác phải sử dụng `randomRuntimeDelay` hoặc công thức tương tự.

---

## 8. Execution Browser Lock

Khi chạy Execute từ Studio/Executions, browser automation bị khóa input vật lý của người dùng. Record / Open Browser / Preview **không** bị ảnh hưởng.

| Thành phần | Vai trò |
|------------|---------|
| `ExecutionBrowserLockService` | `lock` / `unlock` / `isLocked` + watchdog |
| Strategy Win32 | `EnableWindow(FALSE)` trên HWND Chromium (Windows) |
| Strategy Overlay | Electron transparent overlay (fallback) |
| Setting `execution_browser_lock` | Mặc định `true` |

```
Execute → launch browser → lock → workflow → cleanup → finally unlock
```

Chi tiết đầy đủ: [07_execution_browser_lock.md](./07_execution_browser_lock.md).

---

## 9. File Nguồn Chính

| File | Vai trò |
|------|------|
| `src/renderer/components/ScenarioEditor.jsx` | UI timeline chính + trình chỉnh sửa keyframe |
| `src/renderer/components/StandardScenarioEditorContent.jsx` | Trình chỉnh sửa step loại action tiêu chuẩn |
| `src/renderer/components/CrawlScenarioEditorContent.jsx` | Cấu hình step crawl |
| `src/renderer/components/RequestCatchingScenarioEditorContent.jsx` | Trình chỉnh sửa scenario request-catching |
| `src/renderer/components/StepEditor.jsx` | Trình chỉnh sửa thuộc tính từng step |
| `src/renderer/components/ScenarioVariablesBar.jsx` | Quản lý biến cục bộ + sample |
| `src/renderer/components/DataProfileSelect.jsx` | Chọn variable template gắn scenario |
| `src/main/database/DatabaseService.js` | `saveScenario`, `buildScenarioMetaForStorage`, orphan frame cleanup |
| `src/main/rpa/RecorderService.js` | Ghi Puppeteer + screenshot frames |
| `src/main/rpa/ExecutorService.js` | Thực thi step; gọi Browser Lock khi Execute |
| `src/main/rpa/ExecutionBrowserLockService.js` | Khóa input user trên browser Execute |
| `src/shared/platformFileAccept.js` | Rule text upload theo Platform (Facebook mẫu) |

---

## 10. Kênh IPC

| Channel | Hướng | Mục đích |
|---------|-----------|---------|
| `db:save-scenario` | Invoke | Lưu scenario + steps (atomic transaction) |
| `db:get-scenario-details` | Invoke | Tải scenario kèm steps + frames |
| `db:delete-scenario` | Invoke | Xóa scenario |
| `scenario:start-recording` | Invoke | Bắt đầu ghi qua RecorderService |
| `scenario:stop-recording` | Invoke | Dừng ghi |
| `scenario:render-video` | Invoke | Render video preview qua fluent-ffmpeg |
| `scenario:read-frame-data-url` | Invoke | Đọc frame dưới dạng data: URL (đã kiểm tra bảo mật) |
| `scenario:replay-and-record` | Invoke | Phát lại steps hiện có, sau đó tiếp tục ghi |
