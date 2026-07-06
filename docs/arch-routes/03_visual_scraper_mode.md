# Visual Scraper Mode — `/data/scraper-mode`

> **Router Path:** `/data/scraper-mode`
> **Execution Context:** Giao diện Web Scraper dạng Wizard 7/3 độc lập
> **Related Component:** `src/renderer/components/CrawlBrowserPreview.jsx`
> **Related Service:** `src/main/browser/ScenarioEmbeddedBrowserService.js`

---

## 1. Khái Niệm Cốt Lõi

Một **giao diện Web Scraper dạng Wizard 7/3 độc lập** không phụ thuộc vào tự động hóa RPA dựa trên thời gian. Chế độ này hoàn toàn dành cho **trích xuất dữ liệu trực quan point-and-click** từ bất kỳ trang web nào, mà không cần ghi lại hoặc phát lại các bước tương tác.

Bố cục UI chia thành:
- **Panel Trái (70%):** Lớp phủ tương tác trên trình duyệt nhúng (`webview` hoặc trình duyệt kết nối CDP).
- **Panel Phải (30%):** Selector Tree (DOM outline đơn giản hóa) ở trên + **Bảng Data Preview dạng Excel** ở dưới.

---

## 2. Bố Cục UI

```
┌──────────────────────────────────────┬─────────────────────┐
│                                      │  Selector Tree      │
│      Browser Preview (70%)           │  ┌─────────────────┐│
│                                      │  │ div.container   ││
│    [Visual overlay với dashed        │  │  ├ div.row      ││
│     border highlight khi hover]      │  │  │ ├ div.card   ││
│                                      │  │  │ │ ├ h2.title ││
│    Ctrl+Hover → định nghĩa list      │  │  │ │ └ p.desc   ││
│    Shift+Hover → trích xuất con      │  │  │ └ div.card   ││
│                                      │  │  └ div.row      ││
│                                      │  └─────────────────┘│
│                                      ├─────────────────────┤
│                                      │  Bảng Data Preview  │
│                                      │  ┌─────────────────┐│
│                                      │  │ Title | Desc    ││
│                                      │  │─────────────────││
│                                      │  │ Foo   | Bar     ││
│                                      │  │ Baz   | Qux     ││
│                                      │  └─────────────────┘│
└──────────────────────────────────────┴─────────────────────┘
```

---

## 3. Phím Tắt Tương Tác

### 3.1 Mouseover Mặc Định — Visual Highlight

Di chuột qua các phần tử trong browser preview kích hoạt **dashed border highlight**:

```css
outline: 2px dashed #3b82f6;
outline-offset: 2px;
background-color: rgba(59, 130, 246, 0.05);
```

Đây hoàn toàn là phản hồi trực quan — không thay đổi trạng thái lựa chọn.

### 3.2 Ctrl + Hover/Click — Định Nghĩa List Elements

Khi người dùng giữ **Ctrl** và di chuột/nhấp vào một phần tử:

1. Phần tử được đánh dấu bằng **viền xanh đặc**.
2. Hệ thống tự động tính toán một **CSS selector pattern** cho phần tử.
3. Nhận dạng mẫu chạy trên DOM để **khớp các danh sách động** (các sibling lặp lại có cấu trúc tương tự).
4. Tất cả các phần tử khớp được đánh dấu bằng **viền xanh lá** để xác nhận mẫu danh sách.
5. Kết quả là một **list selector** được lưu dưới dạng `parent_container_selector` + `card_selector`.

**Quy tắc loại bỏ trùng lặp:** Chỉ xem xét các phần tử hiển thị có kích thước khác không.

### 3.3 Shift + Hover/Click — Trích Xuất Child Elements

Khi người dùng giữ **Shift** và di chuột/nhấp:

1. Các phần tử con (text nodes, links, media) được trích xuất tương đối so với container cha.
2. Ánh xạ trích xuất:
   - **Nội dung văn bản** → Trường dữ liệu (ví dụ: tiêu đề, mô tả, giá).
   - **Thuộc tính `href`** → Cột link.
   - **Thuộc tính `src`** → Cột media URL.
3. Mối quan hệ được tính toán tương đối so với selector của container cha.
4. Kết quả được đưa vào **Bảng Data Preview** theo thời gian thực.

---

## 4. Bộ Lọc Trực Quan

### 4.1 Trích Xuất DOM Tree: `extractDOMTreeToJSON`

**DOM parser đệ quy** xây dựng Selector Tree và các mẫu trích xuất phải thực thi bộ lọc trực quan nghiêm ngặt. Nó sử dụng các truy vấn DOM runtime:

```javascript
function extractDOMTreeToJSON(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const computedLeft = rect.left + window.pageXOffset;

  // STRICT FILTER — loại bỏ phần tử vô hình/ẩn
  if (
    rect.width === 0 || rect.height === 0        // Kích thước bằng 0 (tracking nodes)
    || style.display === 'none'                    // Ẩn hiển thị
    || style.visibility === 'hidden'               // Ẩn visibility
    || parseFloat(style.opacity) === 0              // Opacity bằng 0
  ) {
    return null;  // Loại trừ nghiêm ngặt — dump dữ liệu sạch 100%
  }

  return {
    tag: element.tagName.toLowerCase(),
    text: element.textContent?.trim().slice(0, 200) || null,
    attributes: extractRelevantAttributes(element),
    rect: { width: rect.width, height: rect.height },
    children: Array.from(element.children)
      .map(extractDOMTreeToJSON)
      .filter(Boolean),
  };
}
```

### 4.2 Quy Tắc Lọc (Bất Biến)

| Rule | Điều kiện | Hành động |
|------|-----------|--------|
| Kích thước bằng 0 | `width === 0` HOẶC `height === 0` | Loại trừ |
| Hiển thị ẩn | `display: none` | Loại trừ |
| Visibility ẩn | `visibility: hidden` | Loại trừ |
| Opacity bằng 0 | `opacity: 0` | Loại trừ |
| System tracking nodes | Thẻ Script, meta, link | Loại trừ |

Điều này đảm bảo **dump dữ liệu sạch 100%** — không có tracking nodes ẩn hệ thống, phần tử placeholder vô hình, hoặc overlay opacity-zero nào lọt vào đầu ra trích xuất.

---

## 5. Embedded Browser Service

Trình duyệt nhúng được quản lý bởi `ScenarioEmbeddedBrowserService` (`src/main/browser/ScenarioEmbeddedBrowserService.js`):

| Khả năng | Phương thức | IPC Channel |
|-----------|--------|-------------|
| Gắn trình duyệt | `attach(options)` | `scenario:crawl-preview:attach` |
| Tách | `detach()` | `scenario:crawl-preview:detach` |
| Điều hướng | `navigate({ url })` | `scenario:crawl-preview:navigate` |
| Đặt design mode | `setDesignMode(enabled, opts)` | `scenario:crawl-preview:set-design-mode` |
| Highlight anchor | `highlightAnchor(anchor)` | `scenario:crawl-preview:highlight-anchor` |
| Trích xuất mẫu | `extractCrawlSample(anchor, maxCards)` | `scenario:crawl-preview:extract-sample` |
| Tìm trong trang | `findInPage(text, opts)` | `scenario:crawl-preview:find-in-page` |

---

## 6. Design Mode Script

Được inject qua `DesignModeScript.js` khi design mode được bật:

- Phủ một lớp tương tác trong suốt lên trang đã nhúng.
- Lắng nghe các sự kiện chuột (`mouseover`, `click`) với phát hiện phím bổ trợ (`Ctrl`, `Shift`).
- Gửi dữ liệu đã chọn/di chuột về main process qua các IPC event `crawl:design-pick` và `crawl:design-hover`.
- Tính toán `slimAnchorForPage()` — một semantic selector anchor tối thiểu cho phần tử đã chọn.

---

## 7. Bảng Data Preview

**Bảng Data Preview dạng Excel** ở góc dưới-bên phải hiển thị dữ liệu đã trích xuất dưới dạng các dòng:

- Các cột được tự động tạo từ các key của child element đã trích xuất.
- Cập nhật thời gian thực khi người dùng thêm/xóa các quy tắc trích xuất.
- Hỗ trợ xuất CSV dữ liệu preview hiện tại.
- Phân trang cho tập dữ liệu lớn (mặc định 100 dòng mỗi trang).

---

## 8. Tích Hợp với Scenario Steps

Visual scraper mode có thể xuất cấu hình **crawl step**:

```json
{
  "action_type": "crawl",
  "target_anchor": {
    "selector_value": "div.card",
    "action_config": {
      "parent_container_selector": "div.row",
      "card_selector": "div.card",
      "fields": [
        { "key": "title", "selector": "h2.title", "type": "text" },
        { "key": "description", "selector": "p.desc", "type": "text" },
        { "key": "link", "selector": "a", "type": "href" }
      ],
      "label": "Product cards",
      "max_cards": 100,
      "result_type": "list"
    }
  }
}
```

Cấu hình này có thể được lưu vào bất kỳ scenario nào dưới dạng step `crawl` và thực thi qua `ExecutorService._executeCrawl()`.

---

## 9. File Nguồn Chính

| File | Vai trò |
|------|------|
| `src/renderer/components/CrawlBrowserPreview.jsx` | Trình duyệt nhúng + lớp phủ design mode |
| `src/renderer/components/CrawlWidgetPanel.jsx` | Panel cấu hình widget |
| `src/renderer/components/CrawlWidgetSettings.jsx` | Cài đặt trích xuất theo từng widget |
| `src/main/browser/ScenarioEmbeddedBrowserService.js` | Vòng đời trình duyệt nhúng + CDP bridge |
| `src/main/rpa/DesignModeScript.js` | Inject design mode + xử lý sự kiện |
| `src/main/rpa/CardExtractorScript.js` | Logic trích xuất card (`getCrawlExtractionScript`) |
| `src/main/rpa/ElementAnchorScript.js` | Tính toán anchor cho semantic selectors |
| `src/shared/crawlWidget.js` | Tiện ích quản lý trạng thái widget |

---

## 10. Kênh IPC

| Channel | Hướng | Mục đích |
|---------|-----------|---------|
| `scenario:crawl-preview:attach` | invoke | Gắn trình duyệt nhúng |
| `scenario:crawl-preview:detach` | invoke | Tách trình duyệt nhúng |
| `scenario:crawl-preview:navigate` | invoke | Điều hướng đến URL |
| `scenario:crawl-preview:set-design-mode` | invoke | Bật/tắt design mode |
| `scenario:crawl-preview:highlight-anchor` | invoke | Highlight phần tử theo anchor |
| `scenario:crawl-preview:extract-sample` | invoke | Trích xuất mẫu data cards |
| `scenario:crawl-preview:promote-to-parent` | invoke | Mở rộng selector lên cha |
| `scenario:crawl-preview:find-in-page` | invoke | Tìm văn bản trong trang |
| `crawl:design-pick` | event | Phần tử được chọn trong design mode |
| `crawl:design-hover` | event | Phần tử được di chuột trong design mode |
