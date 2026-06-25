RPA Social Automation System (Standalone Standone Version)

Hệ thống tự động hóa tương tác mạng xã hội độc lập (Local-First RPA) tích hợp giả lập thị giác chống anti-bot và dynamic DOM. Được thiết kế tối ưu trên nền tảng Electron + React + SQLite và sẵn sàng đồng bộ hóa với hệ thống quản trị đám mây (Laravel Omnichannel) trong tương lai.

🚀 Tính Năng Cốt Lõi

Quản Lý Profiles & Cookies Độc Lập: Mỗi tài khoản mạng xã hội chạy trên một phân vùng (partition) cache/cookie biệt lập, tránh tối đa checkpoint.

Studio Quay/Biên Tập Kịch Bản:

Quay màn hình Viewport thực qua Puppeteer Chrome DevTools Protocol (Page.startScreencast).

Tự động bóc tách và phân tích các mỏ neo bất biến (Semantic Anchors) như aria-label, placeholder, role.

Biên tập, cắt nối timeline hành động bằng React Timeline UI và xử lý video preview qua fluent-ffmpeg.

Thực Thi Chống Lệch Toàn Diện: Chuyển đổi tọa độ pixel vật lý thành tỉ lệ phần trăm (%) so với Viewport gốc giúp kịch bản chạy chính xác trên mọi độ phân giải màn hình khác nhau.

AI Local Ready: Thiết kế sẵn luồng tích hợp AI Vision hỗ trợ phân tích và tương tác không phụ thuộc vào cấu trúc DOM.

🛠️ Cấu Trúc Thư Mục Dự Án (Project Folder Structure)

rpa-social-automation-system/
├── .cursorrules               # Kim chỉ nam cấu hình AI của Cursor/DeepSeek
├── package.json               # Cấu hình dự án và dependencies
├── README.md                  # Tài liệu hướng dẫn này
├── cursor_prompts_guide.md    # Bộ prompt hỗ trợ viết code bằng DeepSeek
│
├── src/
│   ├── main/                  # MAIN PROCESS (Node.js/Database/Puppeteer)
│   │   ├── main.js            # Entry point của Electron App
│   │   ├── preload.js         # Cầu nối an toàn IPC (Context Bridge)
│   │   ├── database/          # Module quản trị Cơ sở dữ liệu SQLite
│   │   │   └── DatabaseService.js
│   │   └── rpa/               # Core điều phối Puppeteer & automation
│   │       ├── RecorderService.js
│   │       └── ExecutorService.js
│   │
│   └── renderer/              # RENDERER PROCESS (React UI/Redux Toolkit)
│       ├── index.html         # HTML entry point
│       ├── src/
│       │   ├── main.jsx       # React bootstrap entry
│       │   ├── App.jsx        # Giao diện chính phân trang/tab
│       │   ├── index.css      # Tailwind CSS entry
│       │   ├── components/    # Reusable React UI (Common, Modals, Toasts)
│       │   ├── store/         # RTK Store và các slice (scenarios, profiles)
│       │   │   ├── index.js
│       │   │   └── slices/
│       │   └── views/         # 3 Màn hình lớn của hệ thống
│       │       ├── ProfilesView.jsx # Quản lý & Nuôi nick độc lập
│       │       ├── StudioView.jsx   # Thiết kế, quay, biên tập kịch bản
│       │       └── CampaignsView.jsx # Thiết lập và vận hành chiến dịch


💻 Hướng Dẫn Thiết Lập Môi Trường Phát Triển

1. Yêu Cầu Cài Đặt Ban Đầu

Node.js: Phiên bản LTS mới nhất (Khuyên dùng v18 hoặc v20).

FFmpeg: Máy tính cần cài đặt FFmpeg và cấu hình biến môi trường PATH để fluent-ffmpeg có thể tự động gọi cắt video preview.

2. Cài Đặt Dependencies & Rebuild Native Modules

Do better-sqlite3 là một thư viện native C++ được biên dịch riêng cho Node.js, khi chạy trong môi trường Electron, chúng ta bắt buộc phải rebuild nó tương thích với ABI của Electron.

Chạy tuần tự các lệnh sau trong terminal:

# 1. Khởi tạo dự án và cài đặt toàn bộ dependencies cần thiết
npm install

# 2. Cài đặt các gói hỗ trợ biên dịch Native Node.js module cho Electron
npm install --save-dev electron-rebuild

# 3. Thực hiện rebuild lại better-sqlite3 tương thích với Electron
npx electron-rebuild -f -w better-sqlite3


3. Scripts Vận Hành Trong package.json

Thêm các scripts sau vào file package.json của bạn để bắt đầu phát triển nhanh chóng:

"scripts": {
  "start": "electron .",
  "rebuild": "electron-rebuild -f -w better-sqlite3",
  "build:css": "tailwindcss -i ./src/renderer/src/index.css -o ./src/renderer/dist/output.css --watch"
}


💾 Thiết Kế Dữ Liệu SQLite & Chiến Lược Sync Đám Mây

Hệ thống sử dụng các khóa chính dạng UUID v4 thay vì định dạng AUTOINCREMENT INTEGER. Điều này đảm bảo khi hệ thống chạy ở chế độ Standalone offline, người dùng tự tạo kịch bản/tài khoản trên máy cá nhân, khi đồng bộ lên máy chủ đám mây (Laravel Omnichannel) sau này sẽ không bao giờ bị trùng lặp hay xung đột dữ liệu.

Cột is_dirty (INTEGER 0/1) đóng vai trò đánh dấu các bản ghi mới được tạo hoặc chỉnh sửa ở client nhưng chưa được đẩy lên cloud để tiến hành đồng bộ hóa khi có kết nối internet.