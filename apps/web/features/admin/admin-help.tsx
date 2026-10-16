'use client';
import { useState } from 'react';
import { Icon, Modal } from '../shared/primitives';

export const adminGuides = {
  overview: {
    title: 'Hướng dẫn quản trị',
    bullets: [
      'Món và nguyên liệu: kiểm tra sự cố bếp báo; xử lý tiền món hoặc kiểm tra kho theo từng trường hợp.',
      'Thanh toán & hoàn tiền: đối chiếu giao dịch, duyệt phiếu hoàn và theo dõi nhân viên trả tiền cho khách.',
      'Kho: đối chiếu hàng thực nhận trước khi duyệt nhập; điều chỉnh tồn phải có lý do.',
      'Công & lương: đặt mức lương riêng, chính sách tính công và lịch ngày nghỉ; đối chiếu từng khoản trước khi chốt.',
      'Quyền truy cập: chỉ cấp quyền phù hợp với công việc thực tế.',
    ],
    note: 'Mở hướng dẫn tại từng chức năng để xem các bước xử lý cụ thể.',
  },
  incident: {
    title: 'Cách xử lý món lỗi',
    bullets: [
      'Kiểm tra thông tin món, lý do và ghi chú bếp báo. Bếp dừng món nhưng chưa quyết định tiền.',
      'Nếu đúng lỗi nhà hàng, xác nhận để khách không phải trả tiền món đó.',
      'Nếu khách đổi ý sau khi bếp đã bắt đầu chế biến, ghi nhận đúng lý do; khách vẫn phải trả tiền món đó.',
      'Nếu khách đã thanh toán và trả dư, hệ thống tính số cần hoàn. Tiếp tục ở mục Hoàn tiền.',
    ],
    note: 'Nguyên liệu đã dùng vẫn tính là tiêu hao. Quyết định được lưu trong lịch sử thao tác.',
  },
  waive: {
    title: 'Miễn tiền món',
    bullets: [
      'Chọn đúng món, lý do và kiểm tra số tiền trước khi xác nhận miễn tiền.',
      'Miễn tiền chỉ giảm số tiền khách phải trả. Nguyên liệu đã sử dụng vẫn được tính là tiêu hao.',
      'Món vẫn có trong lịch sử và phiếu thanh toán, kèm thông tin không tính tiền.',
      'Nếu khách đã thanh toán, có thể phát sinh khoản cần hoàn.',
    ],
    note: 'Nếu khách đã thanh toán, hệ thống tính khoản cần hoàn. Nhân viên phải trả tiền thực tế rồi xác nhận giao dịch hoàn.',
  },
  refund: {
    title: 'Cách xử lý hoàn tiền',
    bullets: [
      'Kiểm tra số cần hoàn, lý do đã được quản trị quyết định và giao dịch đã thu.',
      'Quản trị lập và duyệt phiếu hoàn cho đúng giao dịch gốc. Nhân viên sẽ nhận việc trả tiền cho khách.',
      'Nhân viên trả tiền theo phiếu đã duyệt bằng tiền mặt hoặc chuyển khoản; kiểm tra đúng số tiền.',
      'Nhân viên xác nhận đã hoàn sau khi trả tiền. Quản trị theo dõi kết quả, không xác nhận thay.',
    ],
    note: 'Duyệt phiếu chưa phải đã trả tiền. Chỉ xác nhận đã hoàn sau khi khách thực sự nhận tiền.',
  },
  inventory: {
    title: 'Nhập hàng & điều chỉnh kho',
    bullets: [
      'Phiếu nhập nháp chưa tăng tồn. Chỉ duyệt nhập kho sau khi kiểm tra số lượng thực nhận.',
      'Kiểm kê: nhập tổng lượng thực đếm, bao gồm phần đã giữ cho món đang chờ chế biến.',
      'Xuất hủy: nhập lượng nguyên liệu hỏng hoặc hết hạn cần loại bỏ. Không ghi lại phần nguyên liệu đã sử dụng để chế biến món.',
      'Điều chỉnh phải có lý do. Tra lịch sử kho để đối chiếu người thực hiện và lượng thay đổi.',
    ],
    note: 'Các thay đổi đã ghi nhận không được xóa lịch sử.',
  },
  payroll: {
    title: 'Chốt công & lương',
    bullets: [
      'Đặt đơn giá cơ bản riêng cho từng người. Thêm chính sách tính lương với ngày áp dụng và ghi đủ ngày lễ, ngày nghỉ hằng tuần của từng nhân viên.',
      'Đối chiếu giờ vào, ra trước khi duyệt. Ca có nghỉ không tính công cần ghi rõ khoảng nghỉ; thiếu chấm công cần nhập khoảng làm việc đã kiểm tra, giữ nguyên giờ chấm công gốc.',
      'Giờ làm ngoài ca không tự tính là làm thêm. Xác nhận với nhân viên, chọn khoảng làm thêm và ghi lý do duyệt.',
      'Kiểm tra tiền công dự kiến: công thường, tiền làm đêm, làm thêm, ngày nghỉ và ngày lễ được tách riêng. Tiền nghỉ lễ hưởng lương ghi riêng, không tạo giờ chấm công.',
      'Bảng lương nháp dùng công đã duyệt và mức lương đã lưu. Kiểm tra các khoản thưởng, khấu trừ có lý do trước khi chốt.',
      'Chốt bảng lương khi số liệu đúng: kết quả được khóa và nhân viên được xem phiếu lương.',
      'Ghi nhận chi trên từng phiếu sau khi trả đủ cho nhân viên đó. Kỳ chỉ đã chi đủ khi mọi phiếu cần trả đều có xác nhận.',
    ],
    note: 'Công đã duyệt và phiếu lương đã chốt giữ nguyên khi thay chính sách hoặc mức lương. Bảng lương nháp chưa hiển thị cho nhân viên.',
  },
  access: {
    title: 'Quản lý quyền truy cập',
    bullets: [
      'Quản trị: quản lý và quyết định ngoại lệ. Phục vụ: hỗ trợ bàn và thu tiền. Bếp: tiếp nhận và chế biến món.',
      'Chỉ cấp quyền đúng công việc; không cấp quyền quản trị để thay thế thao tác phục vụ thông thường.',
      'Trước khi đổi quyền hoặc khóa tài khoản, yêu cầu nhân viên xử lý xong hoặc bàn giao các việc đã nhận.',
      'Nhập lý do thay đổi. Mọi lần cập nhật tài khoản đều kết thúc các phiên đăng nhập cũ; nhân viên cần đăng nhập lại.',
    ],
    note: 'Thay đổi tài khoản và quyền được lưu trong lịch sử thao tác.',
  },
  finance: {
    title: 'Đọc số tiền & đối soát',
    bullets: [
      'Tiền món hiện tại không gồm món đã bỏ tính tiền. Tiền thanh toán còn lại đã trừ khoản hoàn cho khách.',
      'Còn phải thu và cần hoàn được tính riêng cho từng phiên; không bù tiền giữa các bàn.',
      'Khách đưa 100.000 đ cho món 49.000 đ: thối 51.000 đ, ghi nhận thanh toán tiền món 49.000 đ. Tiền thối không phải tiền hoàn do hủy món.',
      'Mở chi tiết phiên để kiểm tra giao dịch, tiền đã hoàn và lịch sử quyết định.',
    ],
    note: 'Báo cáo hiển thị theo kỳ và bộ lọc bạn chọn. Trong Tổng quan, mục “Tiền trong các phiên đang mở” chỉ tính những bàn chưa kết thúc.',
  },
  shortfall: {
    title: 'Xử lý hồ sơ thiếu tiền',
    bullets: [
      'Kiểm tra phiên bàn, lý do khách rời đi và số tiền thực tế còn thiếu.',
      'Nếu tiền đã được thu hồi đủ, đối chiếu giao dịch trước khi xác nhận đã thu hồi.',
      'Chỉ chấp nhận tổn thất khi quyết định không tiếp tục thu phần còn thiếu; nhập lý do cụ thể.',
      'Hệ thống vẫn kiểm tra món, giao dịch và việc còn mở trước khi kết thúc phiên.',
    ],
    note: 'Chấp nhận tổn thất thành công sẽ đóng phiên, giữ lịch sử và chuyển bàn sang Chờ dọn.',
  },
  risk: {
    title: 'Thay đổi quy tắc vận hành',
    bullets: [
      'Ngưỡng cần duyệt chuyển lượt gọi bất thường cho nhân viên kiểm tra. Lượt vượt giới hạn tối đa sẽ không được gửi.',
      'Kiểm tra đúng nhóm: gọi món, bàn/thanh toán hoặc ca/chấm công trước khi áp dụng.',
      'Thay đổi áp dụng cho nghiệp vụ tiếp theo. Lượt gọi món đã gửi giữ kết quả đánh giá lúc gửi.',
    ],
    note: 'Đối chiếu cách vận hành thực tế trước khi thay đổi giới hạn.',
  },
} as const;
export type AdminGuide = keyof typeof adminGuides;
export function AdminHelp({ topic, text }: { topic: AdminGuide; text?: string }) {
  const [open, setOpen] = useState(false);
  const guide = adminGuides[topic];
  return (
    <>
      <button
        type="button"
        className="secondary-button admin-help-button"
        title={guide.title}
        aria-label={text ?? guide.title}
        onClick={() => setOpen(true)}
      >
        <Icon name="info" size={17} />
        {text ?? guide.title}
      </button>
      {open && (
        <Modal title={guide.title} close={() => setOpen(false)}>
          <div className="admin-guide">
            <ol>
              {guide.bullets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <p className="context-notice">
              <Icon name="info" size={18} />
              {guide.note}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
