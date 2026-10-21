import { test, expect, type Page } from '@playwright/test';
const adminNavigation: {
  id: string;
  label: string;
  children?: { id: string; label: string; title: string; description: string }[];
  icon: string;
}[] = [
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
        description: 'Sự cố món và nguyên liệu, khoản cần hoàn và hồ sơ thiếu tiền đang chờ xử lý.',
      },
      {
        id: 'incident',
        label: 'Món & nguyên liệu',
        title: 'Sự cố món và nguyên liệu',
        description: 'Kiểm tra sự cố bếp báo, khoản tiền món và khả năng phục vụ.',
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
        id: 'categories',
        label: 'Danh mục món',
        title: 'Danh mục thực đơn',
        description: 'Sắp xếp các nhóm món và thứ tự hiển thị trên thực đơn.',
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
import { selectAdmin } from './admin-navigation';

async function login(page: Page, username = 'quyettruong05', role = 'admin') {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('workspace/' + role));
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('every admin destination has a usable heading, local controls and contained mobile layout', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  const legacyReportRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/core/reports')
      legacyReportRequests.push(request.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500)
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await login(page);
  for (const group of adminNavigation) {
    for (const child of group.children ?? [undefined]) {
      await test.step(group.label + (child ? ' / ' + child.label : ''), async () => {
        await selectAdmin(page, group.label, child?.label);
        await expect(page.locator('.admin-content > .section-heading h2')).toBeVisible();
        if (child)
          await expect(page.locator('.admin-content > .section-heading h2')).toHaveText(
            child.title,
          );
        await expect(page.getByText(/^Đang (lấy|tải)/)).toHaveCount(0);
        await expect(page.locator('.admin-content > .form-error')).toHaveCount(0);
        await fits(page);
        await page.screenshot({
          path: info.outputPath(`admin-${group.id}-${child?.id ?? 'main'}.png`),
          fullPage: !info.project.use.isMobile,
          scale: 'css',
          animations: 'disabled',
        });
      });
    }
  }
  expect(legacyReportRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('role-specific guidance opens at its title and returns keyboard focus to the caller', async ({
  page,
}, info) => {
  await login(page, 'pv003', 'staff');
  const help = page.getByRole('button', { name: 'Hướng dẫn phục vụ', exact: true });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Hướng dẫn phục vụ', exact: true });
  await expect(
    dialog.getByRole('heading', { name: 'Hướng dẫn phục vụ', exact: true }),
  ).toBeFocused();
  await expect(dialog.locator('.procedure-topics summary')).toHaveText([
    'Đón khách và gọi món',
    'Mang món và trao đổi với khách',
    'Thu tiền, trả tiền thừa và phiếu',
    'Hỗ trợ, bàn giao và kết thúc bàn',
    'Ca làm, chấm công và lương của tôi',
  ]);
  await dialog.getByText('Thu tiền, trả tiền thừa và phiếu', { exact: true }).click();
  await expect(dialog).toContainText('xác nhận đã trả');
  await dialog.getByText('Ca làm, chấm công và lương của tôi', { exact: true }).click();
  await expect(dialog).toContainText('chấm ra muộn không tự tăng tiền công.');
  await expect(dialog).toContainText('Phiếu lương chỉ hiển thị sau khi quản trị chốt');
  await fits(page);
  await page.screenshot({
    path: info.outputPath('staff-contextual-help.png'),
    scale: 'css',
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…', exact: true })
    .fill('KHONG-CO-BAN-NAO');
  await expect(
    page.getByRole('heading', { name: 'Không có bàn phù hợp', exact: true }),
  ).toBeVisible();
  await fits(page);
});

test('shared forms keep accessible names, Vietnamese validation and optional-field hints', async ({
  page,
}, info) => {
  await login(page);
  await selectAdmin(page, 'Bàn & QR');
  await page.getByText('Thêm bàn mới', { exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Thêm bàn', exact: true }) });
  await form.getByRole('button', { name: 'Lưu', exact: true }).click();
  const field = form.getByLabel('Mã', { exact: true });
  await expect(field).toHaveJSProperty('validationMessage', 'Nhập mã.');
  await field.fill('AUDIT');
  await expect(field).toHaveJSProperty('validationMessage', '');
  await fits(page);
  await page.screenshot({
    path: info.outputPath('shared-form-labels.png'),
    scale: 'css',
    animations: 'disabled',
  });
});
