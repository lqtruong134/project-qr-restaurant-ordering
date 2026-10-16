# Xuất lại bản đọc

Trong gốc repository chạy `node docs/tools/export-html.mjs` sau khi sửa bài Markdown. Script chỉ xuất HTML/CSS/JS từ Markdown, không đọc hoặc sửa database. Sau đó đồng bộ các tệp HTML và thư mục assets sang thư mục Tai-lieu trên Windows.

Nếu API hoặc schema đổi, cập nhật nội dung và metadata trước; exporter không tự rà lại code. Dòng ngày/commit trong exporter cũng cần cập nhật sau lần đối chiếu mới.


## Liên kết khi chia sẻ trên GitHub

Đọc trực tuyến qua `docs/README.md` và các bài Markdown. Khi xuất HTML, liên kết tới mã nguồn mặc định trỏ về repo GitHub; không còn trỏ tới đường dẫn WSL chỉ có trên máy tác giả. Nếu muốn mở mã nguồn cục bộ trong một bản xuất riêng, đặt `DOC_SOURCE_ROOT` thành gốc `file:///.../` trước khi chạy exporter. Biến này chỉ thay liên kết trong tài liệu, không đổi ứng dụng hoặc database.

Bản cập nhật tài liệu có thể đi trước mã nguồn đã đẩy lên GitHub. Xem ngày và phạm vi công bố trong `docs/README.md` trước khi đối chiếu một liên kết mã nguồn.
