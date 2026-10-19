'use client';
import { Icon } from '../shared/primitives';
import { Action } from '../shared/components';
import styles from './payment-exceptions.module.css';

type Page = { id: string; label: string; title: string; description: string };
type Group = { id: string; label: string; icon: string; children?: Page[] };
export const adminNavigation: Group[] = [
  { id: 'overview', label: 'Tổng quan', icon: 'home' },
  {
    id: 'exceptions',
    label: 'Việc cần xử lý',
    icon: 'bell',
    children: [
      {
        id: 'all',
        label: 'Tất cả việc đang chờ',
        title: 'Việc cần xử lý',
        description:
          'Sự cố món và nguyên liệu, ngoại lệ thanh toán, khoản cần hoàn và hồ sơ thiếu tiền.',
      },
      {
        id: 'incident',
        label: 'Món & nguyên liệu',
        title: 'Sự cố món và nguyên liệu',
        description: 'Kiểm tra sự cố bếp báo, khoản tiền món và khả năng phục vụ.',
      },
      {
        id: 'payment',
        label: 'Ngoại lệ thanh toán',
        title: 'Trung tâm ngoại lệ thanh toán',
        description:
          'Kiểm tra khoản online bất thường, bằng chứng ngân hàng và việc cần xử lý tiếp theo.',
      },
      {
        id: 'refund',
        label: 'Khoản cần hoàn',
        title: 'Hoàn tiền cho khách',
        description: 'Kiểm tra số cần hoàn, trả tiền thực tế và xác nhận giao dịch hoàn.',
      },
      {
        id: 'shortfall',
        label: 'Hồ sơ thiếu tiền',
        title: 'Hồ sơ thiếu tiền đang mở',
        description: 'Đối chiếu khoản còn thiếu trước khi quyết định cách xử lý hồ sơ.',
      },
    ],
  },
  {
    id: 'menu',
    label: 'Thực đơn',
    icon: 'menu',
    children: [
      {
        id: 'products',
        label: 'Danh sách món',
        title: 'Quản lý món ăn',
        description: 'Cập nhật hình ảnh, giá bán và tình trạng kinh doanh của từng món.',
      },
      {
        id: 'promotions',
        label: 'Ảnh giới thiệu',
        title: 'Ảnh giới thiệu trên thực đơn',
        description: 'Chọn món, ảnh và nội dung giới thiệu ở đầu thực đơn khách.',
      },
      {
        id: 'categories',
        label: 'Danh mục món',
        title: 'Danh mục thực đơn',
        description: 'Sắp xếp các nhóm món và thứ tự hiển thị trên thực đơn.',
      },
    ],
  },
  {
    id: 'pricing',
    label: 'Khuyến mãi & VAT',
    icon: 'receipt',
    children: [
      {
        id: 'discounts',
        label: 'Chương trình khuyến mãi',
        title: 'Chương trình khuyến mãi',
        description: 'Quản lý ưu đãi, mã giảm giá và điều kiện áp dụng cho phiên bàn.',
      },
      {
        id: 'vat',
        label: 'Giá & VAT',
        title: 'Giá thực đơn và VAT',
        description: 'Giá bán đã gồm VAT; quản lý lịch chính sách và phân loại thuế từng món.',
      },
    ],
  },
  {
    id: 'tables',
    label: 'Bàn & QR',
    icon: 'table',
    children: [
      {
        id: 'tables',
        label: 'Danh sách bàn',
        title: 'Danh sách bàn',
        description: 'Quản lý khu vực, sức chứa và tình trạng sử dụng của từng bàn.',
      },
      {
        id: 'areas',
        label: 'Khu vực phục vụ',
        title: 'Khu vực phục vụ',
        description: 'Theo dõi các khu vực và số bàn được bố trí trong từng khu vực.',
      },
      {
        id: 'qr',
        label: 'Mã QR tại bàn',
        title: 'Mã QR tại bàn',
        description: 'Xem, in hoặc cấp lại mã QR để khách mở thực đơn của đúng bàn.',
      },
    ],
  },
  {
    id: 'inventory',
    label: 'Kho & công thức',
    icon: 'box',
    children: [
      {
        id: 'stock',
        label: 'Tồn kho',
        title: 'Tồn kho nguyên liệu',
        description: 'Kiểm tra tồn khả dụng và những nguyên liệu cần bổ sung.',
      },
      {
        id: 'receipts',
        label: 'Phiếu nhập',
        title: 'Quản lý phiếu nhập',
        description: 'Lập phiếu, kiểm tra hàng thực nhận và duyệt nhập kho.',
      },
      {
        id: 'recipes',
        label: 'Công thức món',
        title: 'Công thức nguyên liệu',
        description: 'Kiểm tra định lượng nguyên liệu dùng để chế biến từng món.',
      },
      {
        id: 'movements',
        label: 'Lịch sử kho',
        title: 'Biến động nguyên liệu',
        description: 'Tra cứu các lần nhập kho, chế biến, xuất hủy và kiểm kê nguyên liệu.',
      },
      {
        id: 'ingredients',
        label: 'Nguyên liệu',
        title: 'Danh mục nguyên liệu',
        description: 'Khai báo nguyên liệu, đơn vị và mức tồn tối thiểu.',
      },
      {
        id: 'locations',
        label: 'Kho lưu trữ',
        title: 'Kho lưu trữ',
        description: 'Quản lý các nơi lưu nguyên liệu của nhà hàng.',
      },
      {
        id: 'units',
        label: 'Đơn vị tính',
        title: 'Đơn vị tính nguyên liệu',
        description: 'Khai báo đơn vị khối lượng, thể tích hoặc số lượng.',
      },
    ],
  },
  { id: 'users', label: 'Nhân viên', icon: 'people' },
  {
    id: 'workforce',
    label: 'Ca làm & lương',
    icon: 'clock',
    children: [
      {
        id: 'templates',
        label: 'Quản lý ca làm',
        title: 'Mẫu ca cố định của nhà hàng',
        description: 'Khai báo giờ, nghỉ và đơn giá riêng; dùng lại khi lập lịch theo ngày.',
      },
      {
        id: 'schedule',
        label: 'Lịch phân ca',
        title: 'Lịch phân ca',
        description: 'Bố trí nhân viên theo ca làm và khu vực phục vụ.',
      },
      {
        id: 'attendance',
        label: 'Chấm công & duyệt',
        title: 'Quản lý giờ công',
        description: 'Đối chiếu giờ vào, ra và duyệt công sau khi ca kết thúc.',
      },
      {
        id: 'payroll',
        label: 'Bảng lương',
        title: 'Quản lý bảng lương',
        description: 'Kiểm tra công, thưởng và khấu trừ trước khi chốt lương.',
      },
      {
        id: 'rates',
        label: 'Đơn giá & chính sách',
        title: 'Mức lương theo giờ',
        description: 'Quản lý đơn giá và ngày bắt đầu áp dụng cho từng nhân viên.',
      },
    ],
  },
  {
    id: 'risk',
    label: 'Kiểm soát gọi món',
    icon: 'shield',
    children: [
      {
        id: 'ordering',
        label: 'Quy tắc gọi món',
        title: 'Quy tắc gọi món',
        description: 'Thiết lập điều kiện xét duyệt và giới hạn cho lượt gửi món mới.',
      },
      {
        id: 'tables',
        label: 'Bàn & thanh toán',
        title: 'Quy tắc bàn và thanh toán',
        description: 'Thiết lập giới hạn áp dụng cho phiên bàn và yêu cầu thanh toán.',
      },
      {
        id: 'workforce',
        label: 'Ca & chấm công',
        title: 'Quy tắc ca và chấm công',
        description: 'Thiết lập giới hạn thời gian ca làm, nghỉ và chấm công.',
      },
    ],
  },
  {
    id: 'reports',
    label: 'Báo cáo',
    icon: 'chart',
    children: [
      {
        id: 'sales',
        label: 'Doanh số món',
        title: 'Báo cáo doanh số món',
        description: 'Doanh số, giá vốn và món bán tốt theo kỳ bạn chọn.',
      },
      {
        id: 'online',
        label: 'Đối soát online',
        title: 'Trung tâm ngoại lệ thanh toán',
        description:
          'Tra cứu ngoại lệ online và lịch sử xử lý; giao dịch hợp lệ được tự động ghi nhận.',
      },
      {
        id: 'payments',
        label: 'Tiền đã thu',
        title: 'Báo cáo tiền đã thu',
        description: 'Theo dõi tiền đã thu, tiền đã hoàn và giao dịch theo kỳ.',
      },
      {
        id: 'reconciliation',
        label: 'Đối soát phiên',
        title: 'Đối soát phiên bàn',
        description: 'Đối chiếu khoản phải thu, tiền đã thu và đã hoàn theo từng phiên.',
      },
      {
        id: 'outstanding',
        label: 'Lịch sử thiếu tiền',
        title: 'Tra cứu hồ sơ thiếu tiền',
        description: 'Tra cứu hồ sơ và kết quả xử lý các khoản còn thiếu.',
      },
      {
        id: 'exceptions',
        label: 'Tra cứu & xử lý món',
        title: 'Tra cứu và xử lý món',
        description: 'Kiểm tra món trong các phiên và những quyết định đã ghi nhận.',
      },
      {
        id: 'support',
        label: 'Hỗ trợ tại bàn',
        title: 'Lịch sử hỗ trợ tại bàn',
        description: 'Tra cứu yêu cầu, người phụ trách và các lần bàn giao hỗ trợ.',
      },
    ],
  },
];

export function adminPage(tab: string, section = '') {
  const group = adminNavigation.find((item) => item.id === tab) ?? adminNavigation[0]!;
  const child =
    group.children?.find(
      (item) => item.id === (section === 'settings' ? 'ingredients' : section),
    ) ?? group.children?.[0];
  return {
    group,
    section: child?.id ?? '',
    title: child?.title ?? (group.id === 'overview' ? 'Tổng quan nhà hàng' : 'Đội ngũ của bạn'),
    description:
      child?.description ??
      (group.id === 'overview'
        ? 'Xem tình hình nhà hàng và những việc cần bạn xử lý.'
        : 'Quản lý tài khoản nhân viên và quyền truy cập theo công việc.'),
  };
}

export default function AdminNavigation({
  tab,
  section,
  expanded,
  expand,
  collapsed,
  collapse,
  open,
  refresh,
  paymentExceptionCount = 0,
}: {
  tab: string;
  section: string;
  expanded: Record<string, boolean>;
  expand: (id: string, value: boolean) => void;
  collapsed: boolean;
  collapse: (value: boolean) => void;
  open: (tab: string, section?: string) => void;
  refresh: () => Promise<void>;
  paymentExceptionCount?: number;
}) {
  const current = adminPage(tab, section);
  return (
    <nav className="core-tabs admin-nested-nav" aria-label="Quản trị">
      <div className="sidebar-heading">
        <span className="brand-symbol">
          <Icon name="table" />
        </span>
        <span className="sidebar-label">
          Điều hành
          <br />
          <small>QUẢN TRỊ NHÀ HÀNG</small>
        </span>
      </div>
      <button
        className="sidebar-toggle secondary-button"
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        title={collapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        onClick={() => collapse(!collapsed)}
      >
        <Icon name={collapsed ? 'panel-open' : 'panel-close'} size={18} />
        <span className="sidebar-label">{collapsed ? 'Mở menu' : 'Thu gọn menu'}</span>
      </button>
      <span className="sidebar-mobile-current">{current.title}</span>
      {adminNavigation.map((group) => (
        <div className="sidebar-group" key={group.id} data-active={tab === group.id}>
          <button
            type="button"
            className="sidebar-parent secondary-button"
            title={group.label}
            aria-label={group.label}
            aria-current={!group.children && tab === group.id ? 'page' : undefined}
            aria-expanded={group.children ? !collapsed && !!expanded[group.id] : undefined}
            aria-controls={group.children ? 'admin-submenu-' + group.id : undefined}
            onClick={() => {
              if (group.children) {
                expand(group.id, collapsed || !expanded[group.id]);
                if (collapsed) collapse(false);
              } else open(group.id);
            }}
          >
            <Icon name={group.icon} size={18} />
            <span className="sidebar-label">{group.label}</span>
            {group.id === 'exceptions' && paymentExceptionCount > 0 && (
              <span
                className={styles.navBadge}
                aria-label={`${paymentExceptionCount} ngoại lệ thanh toán đang chờ`}
              >
                {paymentExceptionCount}
              </span>
            )}
            {group.children && (
              <svg
                className="sidebar-chevron"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            )}
          </button>
          {group.children && (
            <div
              className="sidebar-submenu"
              id={'admin-submenu-' + group.id}
              hidden={collapsed || !expanded[group.id]}
            >
              {group.children.map((child) => (
                <button
                  type="button"
                  className="sidebar-child secondary-button"
                  aria-label={child.label}
                  key={child.id}
                  aria-current={
                    tab === group.id && current.section === child.id ? 'page' : undefined
                  }
                  onClick={() => open(group.id, child.id)}
                >
                  <span>{child.label}</span>
                  {group.id === 'exceptions' &&
                    child.id === 'payment' &&
                    paymentExceptionCount > 0 && (
                      <span className={styles.navBadge} aria-hidden="true">
                        {paymentExceptionCount}
                      </span>
                    )}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <Action
        run={refresh}
        ariaLabel="Tải lại dữ liệu"
        busyContent={
          <>
            <Icon name="refresh" size={18} />
            <span className="sidebar-label">Đang tải…</span>
          </>
        }
      >
        <Icon name="refresh" size={18} />
        <span className="sidebar-label">Tải lại dữ liệu</span>
      </Action>
    </nav>
  );
}
