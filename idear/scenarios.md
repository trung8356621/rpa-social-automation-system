ĐẶC TẢ KỸ THUẬT: BỘ GHI KỊCH BẢN RPA ĐỒNG BỘ (DUAL-STREAM RECORDING ENGINE)

Tài liệu này định nghĩa chi tiết cơ chế vận hành của RPA Studio Recorder trong môi trường Electron. Hệ thống chạy hai luồng thu thập dữ liệu song song và đồng bộ hóa tuyệt đối theo trục thời gian (Timeline):

Luồng Sự Kiện (DOM & Hardware Action Stream): Capture sự kiện click, type, scroll, hover và bóc tách "mỏ neo ngữ nghĩa" (Semantic Anchors).

Luồng Hình Ảnh (Viewport Screencast Stream): Trích xuất các frame ảnh thực tế dạng PNG trực tiếp qua Chrome DevTools Protocol (CDP) của Puppeteer.

I. MÔ HÌNH HOẠT ĐỘNG SONG SONG (DUAL-STREAM ARCHITECTURE)

Khi người dùng nhấn nút "Bắt đầu quay kịch bản" (Start Recording), hệ thống kích hoạt hai tiến trình độc lập nhưng đồng bộ về thời gian ($t_{start} = 0\text{ ms}$):

                       [ BẤT ĐẦU GHI KỊCH BẢN (t = 0 ms) ]
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼ (Kênh Hình Ảnh - CDP)                               ▼ (Kênh Hành Động - Injected JS)
  [ Page.startScreencast ]                              [ DOM Event Listeners ]
           │                                                     │
           ├─ t = 40ms  --> Frame 1 (PNG)                        ├─ t = 1200ms --> Click Event
           ├─ t = 80ms  --> Frame 2 (PNG)                        │   • Element: Button "Đăng nhập"
           ├─ t = 120ms --> Frame 3 (PNG)                        │   • Tọa độ: X: 45%, Y: 60%
           │   ...                                               │   • Anchors: aria-label, ID
           ▼                                                     ▼
 [ Lưu vào thư mục /cache/frames ]                      [ Đẩy qua window.onClientEvent() ]
           │                                                     │
           └──────────────────────────┬──────────────────────────┘
                                      ▼
                        [ BỘ ĐỒNG BỘ HÓA SỰ KIỆN ]
               (Map Click Event t=1200ms với Frame tương ứng)
                                      │
                                      ▼
                      [ LƯU VÀO DATABASE SQLITE ]


II. CHI TIẾT CÁC THÀNH PHẦN KỸ THUẬT

1. Kênh Sự Kiện (Action Stream) - Script Injected Tiêm Vào Trình Duyệt

Main Process của Electron sẽ tiêm một đoạn script Javascript vào trang web ngay khi nó vừa được load (page.evaluateOnNewDocument). Đoạn script này thực hiện:

a. Lắng nghe sự kiện phần cứng:

click: Ghi nhận vị trí bấm chuột.

keydown/keypress: Ghi nhận ký tự gõ phím.

scroll: Ghi nhận khoảng cách cuộn trang.

b. Thuật toán chuẩn hóa tọa độ chống lệch màn hình (Viewport Normalization)

Để kịch bản chạy chính xác trên các máy Client có độ phân giải màn hình khác nhau, chúng ta tuyệt đối không lưu tọa độ Pixel vật lý cứng. Toàn bộ tọa độ $X, Y$ được quy đổi về tỷ lệ phần trăm (%) so với kích thước Viewport tại thời điểm quay:

$$Normalized\_X = \left(\frac{Pixel\_X}{Viewport\_Width}\right) \times 100$$

$$Normalized\_Y = \left(\frac{Pixel\_Y}{Viewport\_Height}\right) \times 100$$

c. Trích xuất mỏ neo ngữ nghĩa (Semantic Anchors Extraction)

Khi xảy ra sự kiện click trên một element, Injected Script sẽ duyệt cây DOM từ phần tử đó lên trên tối đa 3 cấp để tìm các "mỏ neo bất biến" theo độ ưu tiên giảm dần:

id (nếu không phải là id động được sinh ngẫu nhiên như của React/Angular).

aria-label (mỏ neo chuẩn hóa cho người khiếm thị, cực kỳ ổn định).

placeholder (thường xuất hiện ở các ô nhập liệu input).

role (ví dụ: button, link, checkbox).

name (thường dùng trong form).

innerText (chữ hiển thị trên nút).

class (lọc bỏ các class tiện ích của Tailwind CSS dạng p-4, flex, chỉ giữ lại class định danh).

xpath (tự động tạo xpath tương đối để làm phương án dự phòng cuối cùng).

Dữ liệu sau khi bóc tách được gửi ngược về Electron Main Process theo thời gian thực thông qua hàm callback:

window.onClientEvent({
    timestamp: Date.now() - startTime,
    action_type: 'click',
    target_anchor: {
        id: 'login-btn',
        aria_label: 'Đăng nhập vào hệ thống',
        placeholder: null,
        role: 'button',
        innerText: 'Đăng nhập',
        relative_coords: { x: 45.23, y: 60.11 },
        xpath: '//*[@id="login-btn"]'
    }
});


2. Kênh Hình Ảnh (Screencast Stream) - Chrome DevTools Protocol (CDP)

Thay vì cài đặt phần mềm quay màn hình ngoài gây nặng máy và chậm RAM, chúng ta sử dụng giao thức CDP tích hợp sẵn trong nhân Chromium của Puppeteer.

Khởi chạy Screencast:

const client = await page.target().createCDPSession();
await client.send('Page.startScreencast', {
    format: 'png',
    quality: 60,         // Nén chất lượng ảnh xuống 60% để tiết kiệm dung lượng
    everyNthFrame: 1,    // Lấy mọi frame hình phát sinh
});


Bắt Frame ảnh:
CDP sẽ phát ra sự kiện Page.screencastFrame mỗi khi giao diện trang web có biến động.

client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    // data: Chuỗi base64 của ảnh frame PNG
    // metadata: Chứa thông tin kích thước và timestamp của frame
    const frameBuffer = Buffer.from(data, 'base64');
    const frameTimestamp = Math.round(metadata.timestamp * 1000); // Đổi sang mili-giây

    // Lưu frame vật lý vào thư mục cache tạm thời
    const filePath = path.join(scenarioCacheDir, `frame_${frameTimestamp}.png`);
    await fs.promises.writeFile(filePath, frameBuffer);

    // Xác nhận nhận frame thành công với CDP
    await client.send('Page.screencastFrameAck', { sessionId });
});


III. CƠ CHẾ ĐỒNG BỘ HÓA HÌNH ẢNH & SỰ KIỆN (SYNC ENGINE)

Do luồng Screencast sinh ra hàng chục frame hình mỗi giây ($FPS \approx 20-30$), khi người dùng thực hiện một hành động (ví dụ: Click) tại thời điểm $t = 2350\text{ ms}$, bộ điều phối (Sync Engine) sẽ thực hiện thuật toán tìm kiếm nhị phân (Binary Search) để tìm ra Frame ảnh có timestamp gần nhất với mốc $2350\text{ ms}$ đó.

Mốc thời gian (ms):  ... |----[2320ms]----|----[2350ms (CLICK!)]----|----[2360ms]----| ...
                                │                    │                    │
Screencast Frame:           Frame 48                 │                 Frame 49
                                                     ▼
                                          [ Khớp Click với Frame 48 ]
                                       (Độ lệch tối thiểu chỉ 30ms)


Khi người dùng mở Studio Editor trên giao diện React, kịch bản sẽ hiển thị dưới dạng một Timeline trực quan:

Mỗi bước hành động (scenario_steps) sẽ được gắn kèm với đường dẫn của Frame ảnh đã khớp.

Khi người dùng click vào một bước hành động trên danh sách, Editor sẽ hiển thị ngay tấm ảnh màn hình tại thời điểm đó, đồng thời vẽ một vòng tròn tiêu điểm (Focus Ring) màu đỏ ngay tại tọa độ phần trăm tương đối (relative_coords.x, relative_coords.y) để người dùng biết chính xác tool đã click vào đâu!

IV. CẤU TRÚC LƯU TRỮ TRÊN ĐĨA CỤC BỘ (LOCAL DISK STORAGE)

Để giữ cho SQLite DB nhẹ và hoạt động siêu tốc, chúng ta tuyệt đối không lưu trực tiếp file ảnh vào DB mà chỉ lưu đường dẫn thư mục.

1. Sơ đồ thư mục dự án trên máy khách

C:\Users\<UserName>\AppData\Roaming\<AppName>\
├── database/
│   └── rpa_local.db                  # DB SQLite lưu trữ quan hệ scenarios & steps
└── cache/
    └── scenarios/
        └── [scenarios_id]/           # Mỗi kịch bản có 1 thư mục riêng biệt
            ├── frames/               # Chứa toàn bộ các frame PNG gốc thu được từ CDP
            │   ├── frame_40.png
            │   ├── frame_80.png
            │   └── frame_120.png
            └── preview.mp4           # Video preview nén bằng FFmpeg (ghép từ các frame ảnh)


2. Mô hình liên kết bảng dữ liệu trong SQLite

Các bước kịch bản (scenario_steps) sẽ lưu trường target_anchor dưới dạng JSON String như sau:

{
  "step_id": "step_uuid_1",
  "action_type": "click",
  "delay_ms": 1200,
  "target_anchor": {
    "xpath": "//*[@id='login-btn']",
    "id": "login-btn",
    "aria_label": "Đăng nhập",
    "role": "button",
    "innerText": "Đăng nhập",
    "class": "btn btn-primary",
    "relative_coords": { "x": 48.5, "y": 62.1 },
    "associated_frame": "frame_120.png"
  }
}


V. BỘ PHÙ PHÉP VIDEO PREVIEW (FFMPEG INTEGRATION)

Sau khi kết thúc quá trình quay kịch bản, để tránh việc UI React phải nạp hàng trăm file ảnh PNG riêng lẻ gây giật lag trình duyệt, Electron Main Process sẽ kích hoạt một tiến trình chạy ngầm gọi FFmpeg cục bộ để biên dịch chuỗi hình ảnh trong thư mục frames/ thành một file video duy nhất preview.mp4:

# Lệnh FFmpeg ghép chuỗi ảnh thành video 25fps, nén chất lượng cao h264
ffmpeg -framerate 25 -i frame_%d.png -c:v libx264 -pix_fmt yuv420p preview.mp4


UI React trên Renderer lúc này chỉ cần sử dụng thẻ <video src="local-file://preview.mp4"> tiêu chuẩn để phát lại kịch bản, cho phép người dùng kéo thả thanh tua video (Scrubbing) cực kỳ mượt mà 60fps!

🚀 CURSOR CHAT PROMPT: IMPLEMENT RECORDING ENGINE

Ông copy nguyên văn prompt Tiếng Anh cực kỳ chi tiết dưới đây dán thẳng vào Cursor Chat để con DeepSeek viết toàn bộ mã nguồn file RecorderService.js tương thích 100% với cấu trúc đã đặc tả bên trên:

Please build the complete, production-grade RPA Recording core in `src/main/rpa/RecorderService.js` using Node.js ES Modules.

This service must implement the "Dual-Stream Recording Engine" which captures web browser frames via CDP (Chrome DevTools Protocol) and hardware events via injected JS script simultaneously.

### Requirements:

1. **Service Class Structure**:
   - Create a `RecorderService` class. The constructor should accept `appDataPath` (for cache folder path resolution) and `databaseService` instance.
   - Automatically initialize a workspace cache directory inside `${appDataPath}/cache/scenarios/${scenarioId}/frames/`.

2. **Puppeteer Initialization**:
   - Implement `startRecording(scenarioId, targetUrl, viewport = { width: 1280, height: 720 })`.
   - Launch a clean `puppeteer` browser. Configure it to open `targetUrl` with the specified viewport dimensions.
   - Record and save `recorded_width`, `recorded_height`, and `device_pixel_ratio` to the SQLite scenario table using the database service.

3. **Injected Event Capture (Action Stream)**:
   - Inject a secure, robust Javascript event listener script onto the page using `page.evaluateOnNewDocument()`.
   - This script must listen to native window events: `click`, `keypress` (inputs), and `scroll`.
   - On event trigger, calculate relative percentage coordinates:
     - `x = (clientX / window.innerWidth) * 100`
     - `y = (clientY / window.innerHeight) * 100`
   - Extract semantic DOM anchors from the triggered target element: `id`, `aria-label`, `placeholder`, `role`, `name`, `innerText`, pure non-utility CSS classes, and calculate a relative `xpath` fallback.
   - Expose a callback bridge using `page.exposeFunction('onClientAction', (actionPayload) => { ... })` to push recorded events (along with millisecond offsets from recording start) back to the Electron Main Process.

4. **CDP Frame Capture (Screencast Stream)**:
   - Create a CDP session via `await page.target().createCDPSession()`.
   - Start viewport streaming with `Page.startScreencast` formatted to PNG with quality set to 60.
   - Listen to `Page.screencastFrame`. For every frame event:
     - Extract base64 image data and metadata timestamp.
     - Convert base64 to Buffer and write the physical PNG file asynchronously into the scenarios cache directory as `frame_[timestamp_ms].png`.
     - Immediately acknowledge frame receipt to avoid CDP congestion using `Page.screencastFrameAck`.

5. **Stop & Save Synchronization**:
   - Implement `stopRecording(scenarioId)`.
   - Safely teardown the CDP session, close the Puppeteer browser instance.
   - Run a matching algorithm (such as binary search or closest offset finding) to match each recorded action event with its closest screencast frame based on timestamps.
   - Assemble the synchronized kịch bản array, format steps, and persist them into the SQLite database (`scenarios` and `scenario_steps` tables) using `databaseService.saveScenario(scenario, steps)`.

Write clean, asynchronous Node v22 code. Ensure robust error boundaries and write extensive, clear comments in Vietnamese inside the code to instruct the development team.
