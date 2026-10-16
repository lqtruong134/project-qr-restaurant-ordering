# Bộ ảnh khởi tạo thực đơn

Đây là tài nguyên cài đặt, không phải thư mục ảnh được web phục vụ trực tiếp. `importMenuMedia()` dùng cùng `storeMenuImage()` với thao tác tải ảnh của quản trị để đưa các file vào `var/menu-images`.

- `manifest.json`: tên món → tên file, banner món → tên file và đường dẫn cũ → tên file dùng khi chuyển dữ liệu hiện có.
- Tên file là UUID xác định từ nội dung ảnh. Nội dung khác tạo URL khác; cài đặt lại giữ nguyên URL của cùng ảnh.
- Ảnh món được lưu trong `product.image_url` bằng đường dẫn `/api/menu-images/<UUID>.<đuôi>`.
- `photo-metadata.json` giữ nguồn của bộ ảnh có sẵn. Các ảnh bổ sung đi kèm metadata nguồn riêng khi có.
- Logo, biểu tượng, ảnh nền và hình thay thế vẫn thuộc tài nguyên giao diện trong `apps/web/public`.

Đường dẫn mặc định của kho dùng khi chạy ứng dụng là `var/menu-images` tại gốc repository, không phụ thuộc nơi thực thi lệnh. Có thể cấu hình `MENU_UPLOAD_DIR` bằng đường dẫn tuyệt đối, hoặc đường dẫn tương đối tính từ gốc repository.
