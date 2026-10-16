# Thư mục ảnh

| Thư mục | Nội dung | Quy ước |
| --- | --- | --- |
| `brand/` | Logo, ảnh chào khách và nền đăng nhập | Tên theo mục đích sử dụng |
| `menu/` | Ảnh của từng món ăn, thức uống | Mã món viết thường: `chinh-09.webp` |
| `combos/` | Ảnh đại diện cho combo | Mã combo: `combo-01.webp` |
| `banners/` | Ảnh đầu trang theo khu vực | Tên theo vai trò hoặc chủ đề |
| `banners/promotions/` | Poster quảng cáo món mới và combo đặc biệt | Tên theo món hoặc chương trình |
| `placeholders/` | Hình giữ chỗ khi chưa có ảnh phù hợp | Không dùng ảnh món khác để lấp chỗ trống |

Ảnh khách bắt đầu: `brand/guest-welcome.webp`. Nền đăng nhập nội bộ: `brand/internal-login.webp`. Logo: `brand/logo.webp`. Logo và ảnh chào khách do chủ dự án cung cấp; nền đăng nhập là ảnh không gian cafe/bistro của Elist Nguyen trên Unsplash, nguồn và giấy phép ghi trong `SOURCES.md`.

Các banner thực đơn liên kết mã sản phẩm thực tế; tên, giá hiện hành và thành phần được hiển thị bằng HTML lấy từ dữ liệu. Poster có thể đã in chữ hoặc giá; giữ nguyên khung bằng `object-fit: contain` và chỉ hiện khi giá/thành phần trong ảnh khớp danh mục. Các poster có tên nhà hàng khác, giá khác hoặc món không có trong thực đơn không được sử dụng làm quảng cáo của quán.

Danh mục phía web: `apps/web/lib/media.ts`. Danh mục ảnh khởi tạo dữ liệu: `packages/database/src/menu-media.ts`. Khi thêm mã mới, cập nhật cả hai danh mục. Nguồn, tác giả, giấy phép và bước chuyển đổi ghi trong [SOURCES.md](SOURCES.md) và [photo-metadata.json](photo-metadata.json).

Cách thay ảnh dễ nhất: **Admin → Thực đơn → Chỉnh sửa món → Thay ảnh**. API lưu tệp trong `var/menu-images/` (hoặc `MENU_UPLOAD_DIR`), database lưu URL. Ảnh quản trị tải lên được ưu tiên. Không phải sửa từng giao diện hoặc đổi tên UUID bằng tay.

Để thay ảnh có sẵn trong mã nguồn, giữ tên tệp và thay nội dung bằng ảnh món tương ứng. Ảnh được xoay theo EXIF, giảm kích thước theo tỉ lệ và chuyển WebP; không kéo giãn. Ưu tiên ảnh ngang 4:3 khoảng 1200 × 900 px cho món, ảnh ngang rộng cho banner. Ảnh dọc vẫn giữ tỉ lệ trong khung; xem trên cả điện thoại và máy tính trước khi chốt.

Ảnh từ bên ngoài không được xem là ảnh chụp tại Quyết Trường Bistro. Giữ ghi công và giấy phép khi thay đổi nguồn; bản chuyển đổi CC BY-SA giữ giấy phép gốc. Ảnh do chủ dự án cung cấp được ghi riêng, không tự gán giấy phép công khai. Tệp gốc trong thư mục người dùng không bị sửa.

Danh mục có 62 món lẻ, trong đó 31 món có hình (30 ảnh món thật và 1 poster đúng món), 31 món còn thiếu ảnh riêng. Danh sách nằm trong [menu/MISSING.md](menu/MISSING.md), có hai phần ăn kèm KHAI-10 Trứng chiên và NUONG-10 Thịt ba rọi mắm ruốc. Poster COMBO-04/05 chỉ đại diện combo, không được tính thành ảnh từng món con. Hướng dẫn đầy đủ: `docs/20-anh-va-giao-dien.md`.

Poster quảng cáo gốc: [banners/promotions/README.md](banners/promotions/README.md). Dùng `object-fit: contain` để giữ toàn bộ chữ, giá và khung ảnh. Các sản phẩm dùng poster có `poster: true` trong metadata; giá in trên poster phải khớp dữ liệu. Nội dung HTML không đặt đè lên poster.
