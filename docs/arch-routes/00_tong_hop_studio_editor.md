# Tổng Hợp — Studio Editor & Biến Kịch Bản

> **Mục đích:** Tài liệu một chỗ cho hành vi Studio Editor, luồng Save/Record, preview frame, template biến — và các sửa lỗi ổn định đã áp dụng.  
> **Cập nhật:** 2026-07-15  
> **Chi tiết sâu:** xem các file con trong `docs/arch-routes/`.

---

## 1. Bản Đồ Tài Liệu

| File | Nội dung |
|------|----------|
| [01_studio_editor.md](./01_studio_editor.md) | Timeline, LIST SCENARIO STEPS, Record, preview, widget post-record |
| [05_database_schema.md](./05_database_schema.md) | SQLite schema, `scenarios_meta`, lifecycle frame |
| [06_variable_templates.md](./06_variable_templates.md) | Template skeleton, samples, `local_variables`, luồng Record |
| [07_execution_browser_lock.md](./07_execution_browser_lock.md) | Execution Browser Lock — khóa input user khi Execute |
| [02_facebook_crawl_group.md](./02_facebook_crawl_group.md) | Facebook Data Studio crawl |
| [03_visual_scraper_mode.md](./03_visual_scraper_mode.md) | Crawl design mode |
| [04_profile_management.md](./04_profile_management.md) | Browser profiles |

---

## 2. Sơ Đồ Studio Editor

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Header: Tên │ DataProfileSelect (template) │ Variables │ Record │ Save │
├──────────────────────┬────────────────────────────┬─────────────────────┤
│  Program Monitor     │  LIST SCENARIO STEPS       │  Step Edit Panel    │
│  (preview frame)     │  StepCard × N              │  action / selector  │
├──────────────────────┴────────────────────────────┴─────────────────────┤
│  TIMELINE KEYFRAMES — diamond ♦ theo getStepTimestamp()                   │
└─────────────────────────────────────────────────────────────────────────┘
```

| Vùng UI | Component chính | Ghi chú |
|---------|-----------------|--------|
| Preview | `ProgramMonitor` | Canvas + giữ frame cuối khi URL tạm mất |
| Danh sách step | `StepCard` | Timestamp = cùng nguồn với timeline |
| Timeline | `Timeline` | Click ♦ → `handleSelectStep` |
| Template | `DataProfileSelect` | `variable_profile_id` |
| Giá trị biến | `ScenarioVariablesBar` | `local_variables` + sample |

---

## 3. Các Vấn Đề Đã Xử Lý (Tóm Tắt)

| # | Triệu chứng | Nguyên nhân gốc | Hướng sửa |
|---|-------------|-----------------|-----------|
| 1 | Xóa step → preview chớp/trống | Orphan cleanup xóa file frame; UI unmount canvas | Giữ frame trong manifest; `ProgramMonitor` giữ URL cuối |
| 2 | LIST hiện `00:00.0`, timeline lệch | `StepCard` dùng `getStepTime(step, [])` | Dùng `getStepTimestamp()` thống nhất |
| 3 | Bấm Record → template về null | `scenario_meta` cũ ghi đè meta; race React state | `buildScenarioMetaForStorage` + ref sync |
| 4 | Tạo mới + Save → 2 scenario trùng tên | `persist` không có id đồng bộ, gọi song song | `currentScenarioIdRef` + `persistInFlightRef` |
| 5 | Record mở 2 tab `about:blank` | `newPage()` thêm tab khi Chromium đã có tab mặc định | Reuse tab đầu, đóng tab thừa |
| 6 | Facebook contenteditable bị ghi thành Input/selector thường | Debounce keydown bị ép về `action_type: input` và luôn bật | Toggle trong Scenario info + step `debounce_keydown` có icon riêng trong LIST |
| 7 | Mobile viewport 360×640 khó nhìn khi Record | Cần zoom trình duyệt thật, không scale viewport | `default_browser_zoom` (67%) qua `BrowserZoomService` — HostZoomMap Preferences, không CSS / setViewport |
| 8 | User click/gõ vào browser đang Execute làm lệch workflow | Browser automation nhận input vật lý | `ExecutionBrowserLockService` — chỉ Execute, unlock trong `finally` + watchdog |

---

## 4. Preview Frame & Xóa Step

### Quy tắc nghiệp vụ

- **Xóa step** = gỡ khỏi `scenario_steps` + keyframe ♦ — **không** xóa screenshot trên disk nếu vẫn cần cho preview.
- **Trim timeline** = bỏ frame khỏi `preview.json` → mới được orphan cleanup.
- **Xóa scenario** = dọn toàn bộ storage liên quan.

### Luồng kỹ thuật

```
Xóa step (renderer)
  → handleDeleteStep: associated_frame → manifestFrames (nếu chưa có)
  → setSteps(filter)

Save scenario (main)
  → saveTransaction: cập nhật scenario_step_frames theo steps còn lại
  → đọc preview manifest → protectedFramePaths
  → _deleteOrphanedScenarioFrames(..., protectedFramePaths)
       → chỉ unlink khi KHÔNG còn step_frame VÀ KHÔNG còn trong manifest
```

### Program Monitor

- `lastFrameUrlRef` giữ ảnh cuối khi `currentFrameUrl` tạm `null` (bỏ chọn step, xóa step đang chọn).
- Reset ref khi không còn step và không còn frame.

**Chi tiết:** [01_studio_editor.md](./01_studio_editor.md) §3.2, [05_database_schema.md](./05_database_schema.md) `scenario_step_frames`.

---

## 5. Đồng Bộ Thời Gian Step ↔ Keyframe

### Hàm chuẩn: `getStepTimestamp(step, index, steps)`

```text
if (step.target_anchor?.time_offset != null)
  → Number(time_offset)          // thời điểm ghi thật
else
  → tích lũy delay_ms các step trước
```

| Consumer | Dùng `getStepTimestamp` |
|----------|-------------------------|
| `StepCard` (LIST) | Có |
| `Timeline` (♦) | Có |
| `handleSelectStep` | Seek playhead theo `time_offset` |
| `applyTrimDeletion` | Có |

Click diamond trên timeline → `handleSelectStep(index)` → highlight step + nhảy playhead.

---

## 6. Template Biến & Record

### Ba lớp dữ liệu

| Lớp | Lưu trữ | Vai trò |
|-----|---------|---------|
| Template skeleton | `variable_profiles.variables_json` | Key + `value_type` |
| Sample | `variable_profile_samples.values_json` | Bộ value mẫu |
| Runtime | `scenarios_meta.local_variables` | Executor đọc khi chạy |

### Luồng người dùng chuẩn

```
1. Chọn template (header)     → setScenarioVariableProfile
2. Mở Variables → chọn sample → saveScenarioLocalVariables
3. (Tuỳ chọn) chỉnh value    → ScenarioVariablesBar
4. Save hoặc Record           → persist giữ variable_profile_id + local_variables
```

### Bảo vệ khi Save / Record

**`buildScenarioMetaForStorage`** (main):

- Loại `variable_profile_id` và `local_variables` khỏi `scenario_meta` draft trước khi merge.
- Chỉ cập nhật hai field này khi payload top-level truyền rõ, hoặc giữ `existingMeta`.

**Renderer refs** (`ScenarioEditor.jsx`):

| Ref | Mục đích |
|-----|----------|
| `currentScenarioIdRef` | Save/Record luôn biết id hiện tại — tránh tạo UUID mới |
| `activeVariableProfileIdRef` | Template không mất khi state React chưa kịp commit |
| `persistInFlightRef` | Khóa persist đồng thời — tránh scenario double |
| `scenarioDetailsLoadGenRef` | Hủy load cũ — không ghi đè template bằng response stale |

**`DataProfileSelect`:** không gọi `onChange('')` khi reload list thiếu profile; giữ option ẩn cho id đang chọn.

**`RecorderService._finalizeRecordingSession`:** merge `currentScenario` từ DB, giữ `variable_profile_id` + `local_variables`.

**Chi tiết:** [06_variable_templates.md](./06_variable_templates.md) §2.

---

## 7. Save Kịch Bản & Tránh Trùng

### Scenario mới (`id: null`)

```
ScenariosPage → createDraftScenario() → ScenarioEditor key="draft"
  → User Save / Record
  → persist(): scenarioData.id từ currentScenarioIdRef (null lần đầu)
  → DatabaseService.saveScenario → crypto.randomUUID() một lần
  → setScenarioIdSafe(saved.id) — ref + state ngay lập tức
  → Lần Save/Record tiếp theo: cùng id → UPDATE, không INSERT mới
```

### Metadata-only save

- Không truyền `preview_manifest_frames: []` khi manifest đang có frame (tránh wipe preview).
- Không để `scenario_meta` draft ghi đè biến đã áp sample.

---

## 8. Record Browser

```
startRecording()
  → khóa record gate (`_recordingReady=false`)
  → prepare BrowserZoom (Preferences HostZoomMap, default 67%)
  → puppeteer.launch(userDataDir theo scenario/profile)
  → pages = browser.pages()
  → page = pages[0] || newPage()
  → đóng pages[1..] (tab thừa)
  → resolve {{url}} qua buildVariableMap
  → page.goto(resolvedTargetUrl, waitUntil='load')
  → apply BrowserZoom (Menu Zoom thật — không CSS / setViewport)
  → inject recorder xong → mở record gate (`_recordingReady=true`)
  → screenshot timer ~4 FPS sau load
```

Cùng pattern cho `openBrowser()` và `ExecutorService._launchBrowser()` (Execute).

**Không** áp zoom trong `replayAndRecord()` (append preview).

### Execution Browser Lock

Khi **Execute** (headed), hệ thống khóa input vật lý trên browser automation để user không click/gõ/scroll làm lệch workflow. Puppeteer/CDP vẫn điều khiển bình thường.

```
_launchBrowser()
  → ExecutionBrowserLockService.lock(executionId)
  → chạy workflow
  → _cleanupBrowser()
  → finally unlock()   // luôn chạy; watchdog 30 phút nếu crash
```

| Setting | Mặc định | Ghi chú |
|---------|----------|---------|
| `execution_browser_lock` | `true` | Tắt trong Settings → Automation nếu cần debug tương tác tay |

- Strategy ưu tiên Windows: Win32 `EnableWindow(FALSE)` theo PID Chromium; fallback Overlay Electron.
- **Không** áp dụng Record / Open Browser / Replay / Preview / Screenshot.
- Chi tiết: [07_execution_browser_lock.md](./07_execution_browser_lock.md).

### Browser Zoom mặc định

| Setting | Mặc định | Giá trị cho phép |
|---------|----------|------------------|
| `default_browser_zoom` | `67` | 50, 67, 75, 80, 90, 100 |

- Zoom thật của Chromium (giống Menu → Zoom), qua `BrowserZoomService`.
- CDP **không** expose HostZoomMap. Ghi Preferences với partition id giả (`"0"`) bị Chromium bỏ qua — **không** được coi là đã apply.
- Headed (Windows): áp zoom bằng accelerator **Ctrl+0 / Ctrl+-** (Menu Zoom thật). Preferences chỉ seed key partition đã tồn tại cho lần launch sau.
- Electron `webContents.setZoomFactor` khi page do Electron host.
- Không đổi Puppeteer viewport, relative_coords, hay luồng screenshot.
- Trong lúc URL ban đầu đang load, recorder bridge có thể tồn tại nhưng mọi event/screenshot đều bị gate bỏ qua. Mốc `time_offset=0` chỉ bắt đầu sau `document.readyState=complete`, zoom và inject hoàn tất.

**Lỗi biến chưa điền:** `resolveScenarioTargetUrl` ném lỗi rõ `Chua thay the bien: ...` nếu URL còn `{{key}}`.

### Debounce keydown

- Checkbox **Debounce keydown** nằm trong **Scenario info** cho scenario Action/Prepare.
- Khi bật, listener gom một đợt gõ theo `debounce_ms` (mặc định 300 ms).
- Recorder lưu `action_type: debounce_keydown`; step có icon/nhãn riêng và được thêm vào **LIST SCENARIO STEPS** như các step khác.
- Executor chạy step này bằng luồng nhập bàn phím, dùng semantic anchor/selector để focus target.

---

## 9. File Nguồn (Thay Đổi Liên Quan)

| File | Thay đổi chính |
|------|----------------|
| `src/renderer/components/ScenarioEditor.jsx` | `getStepTimestamp`, persist refs, delete giữ frame, `ProgramMonitor`, timeline click |
| `src/renderer/components/DataProfileSelect.jsx` | Không auto-clear template |
| `src/renderer/components/StandardScenarioEditorContent.jsx` | Truyền `steps` vào `StepCard`; timeline props |
| `src/renderer/pages/ScenariosPage.jsx` | `key` khi mount editor |
| `src/main/database/DatabaseService.js` | `buildScenarioMetaForStorage`, protected orphan frames |
| `src/main/rpa/RecorderService.js` | Reuse tab, giữ template khi finalize, default browser zoom |
| `src/main/rpa/ExecutorService.js` | Execute workflow; `_launchBrowser` áp default browser zoom |
| `src/main/rpa/BrowserZoomService.js` | Chromium Menu Zoom (Preferences / Electron / keyboard) |
| `src/main/rpa/ExecutionBrowserLockService.js` | Lock input user khi Execute (Win32 / Overlay + watchdog) |
| `src/main/rpa/ExecutorService.js` | Gọi lock sau launch; unlock trong `finally` |

---

## 10. Checklist Kiểm Thử

### Preview & step

- [ ] Record vài step → LIST và timeline cùng timestamp (không toàn `00:00.0`)
- [ ] Click ♦ trên timeline → step tương ứng được chọn, preview nhảy đúng thời điểm
- [ ] Xóa 1 step đang chọn → preview **không** chớp trắng
- [ ] Save sau xóa step → frame preview vẫn phát được trên timeline

### Template & Record

- [ ] Tạo scenario mới → chọn template + áp sample
- [ ] Bấm Record **không** reset template về "(No template)"
- [ ] Stop Record → template + `local_variables` còn nguyên
- [ ] URL `{{url}}` với sample đã điền → browser mở đúng URL, không `about:blank` (trừ khi cố ý)

### Save & danh sách

- [ ] Tạo mới → Save một lần → chỉ **một** dòng trong Scenarios (không double)
- [ ] Save rồi Record nhanh → vẫn một scenario id
- [ ] Record chỉ mở **một** tab Chromium (không 2 tab `about:blank`)
- [ ] Chọn **Ghi đè** → Stop Record → steps/timeline chỉ còn dữ liệu mới (không giữ steps/frames cũ)
- [ ] Chọn **Ghi nối tiếp** → steps mới nối sau steps cũ
- [ ] Toolbar ZOOM cạnh RES đổi `default_browser_zoom` và áp dụng lần Record/Open Browser/Execute sau
- [ ] Tắt Debounce keydown → gõ contenteditable không sinh step debounce
- [ ] Bật Debounce keydown → LIST có step **Debounce keydown** với icon riêng
- [ ] Execute headed → không click/gõ được vào Chrome automation; Puppeteer vẫn chạy step
- [ ] Execute xong / lỗi → browser mở khóa (hoặc đã đóng)
- [ ] Record vẫn tương tác bình thường (không bị lock)
- [ ] Tắt `execution_browser_lock` → Execute cho phép tương tác tay

### Trim (hồi quy)

- [ ] Trim vùng timeline → frame trong vùng bị bỏ khỏi manifest (khác xóa step đơn lẻ)

---

## 11. IPC Liên Quan

| Channel | Khi nào |
|---------|---------|
| `db:save-scenario` | Save, persist trước Record, finalize Record |
| `db:get-scenario-details` | Load editor, sau Stop Record |
| `db:set-scenario-variable-profile` | Đổi template header |
| `db:save-scenario-local-variables` | Áp sample / chỉnh biến |
| `scenario:start-recording` | Bấm Record |
| `scenario:stop-recording` | Bấm Stop |
| `scenario:read-frame-data-url` | Load ảnh preview vào canvas |

---

## 12. Ghi Chú Cho Dev Tiếp Theo

1. **Một nguồn thời gian:** mọi UI hiển thị thời điểm step phải qua `getStepTimestamp`, không gọi `getStepTime(step, [])`.
2. **Meta nhạy cảm:** `variable_profile_id` và `local_variables` chỉ sửa qua API chuyên dụng hoặc top-level payload Save — không nhét vào `scenario_meta` draft.
3. **Ref trước state:** mọi luồng Save/Record cần đọc `*Ref` đồng bộ, không chỉ `useState`.
4. **Frame ≠ step:** preview manifest có thể chứa frame của step đã xóa; đó là chủ ý cho playback mượt.
5. **Executor file folder:** biến `value_type=file` lưu path thư mục — upload thư mục vẫn TBD ([06_variable_templates.md](./06_variable_templates.md) §6).

---

*Tài liệu này tổng hợp từ phiên chỉnh sửa Studio Editor (preview, timeline, template, save/record). Khi thêm tính năng mới, cập nhật file chi tiết tương ứng rồi bổ sung mục vào §3 và §10 nếu cần.*
