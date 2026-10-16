# Tài liệu hệ thống gọi món bằng QR

Bộ tài liệu hiện hành của dự án QR Restaurant Ordering. Bản `Tai-lieu` trên Windows được xuất từ thư mục `docs/` này; Markdown là nguồn chính, HTML là bản đọc cục bộ. Không cần gửi lại tệp trên máy khi chia sẻ các liên kết GitHub bên dưới.

## Đọc trên Internet

- [Bắt đầu và lộ trình đọc](00-bat-dau.md)
- [Tổng quan, phạm vi và vai trò](01-tong-quan.md)
- [Hồ sơ đối chiếu và giới hạn đã kiểm tra](15-doi-chieu.md)
- [Nền tảng AI Menu Assistant và hướng phát triển](14-mo-rong.md)
- [Vận hành, cài đặt và bàn giao](12-van-hanh.md)
- [Danh mục API](17-api.md) · [OpenAPI](openapi.yaml)
- [Từ điển dữ liệu](16-tu-dien-du-lieu.md) · [Chi tiết bảng và cột](database/data-dictionary.md)

GitHub hiển thị trực tiếp các tệp `.md`. Các tệp `.html` được giữ để tải về và mở bằng trình duyệt; liên kết GitHub tới HTML là trang xem mã nguồn, không phải website đã triển khai. Chưa bật GitHub Pages trong lần cập nhật này.

Nếu công cụ AI cần nội dung thô, dùng [bản Markdown bắt đầu](https://raw.githubusercontent.com/lqtruong134/project-qr-restaurant-ordering/main/docs/00-bat-dau.md) hoặc [bài AI Menu Assistant](https://raw.githubusercontent.com/lqtruong134/project-qr-restaurant-ordering/main/docs/14-mo-rong.md). Khả năng truy cập liên kết vẫn phụ thuộc công cụ AI có hỗ trợ đọc web hay không.

## Mã nguồn và tài liệu AI v2 — 16/10/2026

Phần AI v2 cập nhật ngày 16/10/2026, lưu cùng mã nguồn và tài liệu trong commit tương ứng; bản HTML Windows được xuất từ cùng nguồn. Biên bản kiểm thử ghi trạng thái trước khi công bố. Khi đọc GitHub, đối chiếu theo commit đang mở. Các phần đối chiếu PostgreSQL giữ mốc 15/10/2026. Hai commit `88ba324` và `bd3fcac` ban đầu chỉ công bố tài liệu. Bản cập nhật mã nguồn tiếp theo đưa ứng dụng, migration, tài nguyên ảnh cài đặt, kiểm thử và nền tảng AI tương ứng vào cùng repository. Khi đối chiếu, chọn mã nguồn và tài liệu ở cùng commit; checkout các mốc cũ hơn có thể chưa có các tệp/chức năng mới. Dữ liệu PostgreSQL, `.env`, ảnh tải lên khi vận hành, cache và mô hình AI không được công bố cùng mã nguồn.

Kết quả kiểm tra có ngày và phạm vi riêng ở [bài 15](15-doi-chieu.md); không coi các số liệu cũ là kết quả của phiên bản khác. Nền tảng trợ lý thực đơn v2 đang **OFF**: AI tự đọc surface được phép và sở hữu tư vấn; API giữ bảo mật/schema, core giữ nghiệp vụ giao dịch. Chưa chạy model/huấn luyện/GPU hoặc UI AI. Tài liệu không thay thế mã nguồn, dữ liệu cấu hình triển khai hoặc xác nhận nghiệp vụ thực tế.

## Mục lục

| Bài | Nội dung |
| --- | --- |
| 00 | [Bắt đầu](00-bat-dau.md) |
| 01 | [Tổng quan](01-tong-quan.md) |
| 02 | [Nền tảng](02-nen-tang.md) |
| 03 | [Giao diện](03-giao-dien.md) |
| 04 | [Gọi món](04-goi-mon.md) |
| 05 | [Bếp và hủy món](05-bep-huy-mon.md) |
| 06 | [Thanh toán, khuyến mãi và VAT](06-thanh-toan.md) |
| 07 | [Database](07-database.md) |
| 08 | [Kho và công thức](08-kho.md) |
| 09 | [Nhân sự, ca làm và lương](09-nhan-su.md) |
| 10 | [Đọc mã nguồn](10-doc-code.md) |
| 11 | [Bảo mật](11-bao-mat.md) |
| 12 | [Vận hành](12-van-hanh.md) |
| 13 | [Thực hành](13-thuc-hanh.md) |
| 14 | [Mở rộng và AI Menu Assistant](14-mo-rong.md) |
| 15 | [Đối chiếu và bằng chứng](15-doi-chieu.md) |
| 16 | [Từ điển dữ liệu](16-tu-dien-du-lieu.md) |
| 17 | [API](17-api.md) |
| 18 | [Bản đồ tệp](18-ban-do-tep.md) |
| 19 | [Thuật ngữ](19-thuat-ngu.md) |
| 20 | [Ảnh và giao diện](20-anh-va-giao-dien.md) |
| 21 | [Chính sách và ma trận nghiệp vụ](21-chinh-sach-va-ma-tran.md) |
| 22 | [Hỗ trợ và bàn giao](22-ho-tro-va-ban-giao.md) |
| 23 | [Chuyển bàn](23-chuyen-ban.md) |
| 24 | [Sự cố món và phiếu thanh toán](24-su-co-mon-va-phieu-thanh-toan.md) |
| 25 | [Thu tiền tại bàn](25-thu-tien-tai-ban.md) |

## Cập nhật tài liệu

Sửa bài Markdown và metadata tương ứng trong `docs/`, rồi xuất lại HTML theo [hướng dẫn công cụ](tools/README.md). Hai tệp `openapi.yaml` và `core45/openapi-paths.json` còn là đầu vào của bước `prepare-docs` khi chạy/build web. Không dựng thêm một bộ nội dung độc lập ở thư mục `Tai-lieu/` trong repo.

Chỉ đưa tài liệu đã kiểm tra lên GitHub; không đưa `.env`, khóa API, token, bản sao database hoặc hồ sơ riêng tư. Các bằng chứng kiểm thử là ảnh/log được rà trong phạm vi công bố, không phải dữ liệu huấn luyện hay cam kết chất lượng mô hình.
