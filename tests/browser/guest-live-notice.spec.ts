import { test, expect, type Page } from '@playwright/test';

type Dish = { [key: string]: string | number | boolean | null; id: string };
const item = (status = 'SUBMITTED', id = 'one', owner = 'person-a'): Dish => ({
  id: 'order-' + id,
  item_id: 'item-' + id,
  item_status: status,
  status: 'SUBMITTED',
  quantity: 1,
  product_name_snapshot: id === 'one' ? 'Gỏi cuốn tôm thịt' : 'Cá kho tộ',
  owner_participant_id: owner,
  owner_name: owner === 'person-a' ? 'Lan' : 'Minh',
  created_at: '2026-10-10T04:00:00Z',
  charge_status: 'ACTIVE',
  line_total: '45000',
});
function state(orders: Dish[] = []) {
  return {
    participant: { id: 'person-a', displayName: 'Lan' },
    participants: [
      { id: 'person-a', display_name: 'Lan' },
      { id: 'person-b', display_name: 'Minh' },
    ],
    session: {
      id: 'session-a',
      table_id: 'table-a',
      table_name: 'Bàn A01',
      area_name: 'Trong nhà',
      version: 1,
    },
    cart: { cart_version: 1 },
    items: [],
    products: [],
    orders,
    support: [],
    payments: [],
    refundTransactions: [],
    account: {
      id: 'account',
      charge_total: '0',
      paid_total: '0',
      refunded_total: '0',
      outstanding_amount: '0',
      refund_due_amount: '0',
    },
  };
}
const strip = (page: Page) => page.getByRole('region', { name: 'Cập nhật món tại bàn' });
async function resume(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('guest sees new kitchen states without replaying history or moving focus', async ({
  page,
}, info) => {
  const current = state([item('ACCEPTED')]);
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: current }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/guest');
  await expect(strip(page)).toBeVisible();
  await expect(strip(page).getByRole('status')).toHaveText('');
  await expect(strip(page)).toContainText('Bếp đã nhận 1 phần món');
  const policy = page.getByRole('button', { name: 'Quy định & chính sách', exact: true });
  await policy.focus();
  current.orders = [item('IN_PREPARATION')];
  await resume(page);
  await expect(strip(page).getByRole('status')).toContainText('Món của bạn');
  await expect(strip(page)).toContainText('đang được chế biến');
  await expect(policy).toBeFocused();
  current.orders = [item('READY'), item('READY', 'two', 'person-b')];
  await resume(page);
  await expect(strip(page).getByRole('status')).toContainText('Món của bàn');
  await expect(strip(page).locator('.guest-live-notice-message')).toContainText(
    'chờ nhân viên mang ra',
  );
  await expect(strip(page).getByRole('button', { name: 'Thông báo tiếp theo' })).toBeVisible();
  await strip(page).getByRole('button', { name: 'Thông báo tiếp theo' }).click();
  await expect(strip(page).locator('.guest-live-notice-message')).toContainText('Món của bàn');
  await expect(strip(page)).toHaveAttribute('data-paused', 'true');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(
      strip(page).getByRole('button', { name: 'Món đã gọi', exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize(info.project.use.viewport!);
  await page.screenshot({
    path: info.outputPath('guest-kitchen-notice.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await strip(page).getByRole('button', { name: 'Món đã gọi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Món đã gọi', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('long cancellation notices fit, pause and reset on another table session', async ({
  page,
}, info) => {
  let current = state([item('ACCEPTED')]);
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: current }));
  await page.goto('/guest');
  await expect(strip(page)).toBeVisible();
  current.orders = [
    {
      ...item('UNAVAILABLE'),
      product_name_snapshot:
        'Gỏi rau củ theo mùa với đậu phộng rang, rau thơm và nước sốt riêng dành cho khách ăn chay',
    },
  ];
  await resume(page);
  await expect(strip(page)).toHaveAttribute('data-tone', 'attention');
  await expect(strip(page).getByRole('status')).toContainText('Nhân viên sẽ trao đổi tại bàn');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(strip(page).locator('.guest-live-notice-message')).toHaveAttribute(
    'data-scroll',
    'true',
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.mouse.move(0, 0);
  const pause = strip(page).getByRole('button', { name: 'Tạm dừng thông báo' });
  await pause.click();
  await expect(strip(page)).toHaveAttribute('data-paused', 'true');
  await expect(
    strip(page).getByRole('button', { name: 'Tiếp tục chạy thông báo' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: info.outputPath('guest-long-notice-320.png'),
    animations: 'disabled',
  });
  current = {
    ...state([item('SERVED', 'new')]),
    session: {
      ...current.session,
      id: 'session-b',
      table_id: 'table-b',
      table_name: 'Bàn A02',
      version: 2,
    },
  };
  await resume(page);
  await expect(strip(page).getByRole('status')).toHaveText('');
  await expect(strip(page)).not.toContainText('Nhân viên sẽ trao đổi tại bàn');
  await expect(page.locator('.guest-table')).toContainText('Bàn A02');
  await page.setViewportSize(info.project.use.viewport!);
});

test('reduced motion keeps the full message still and leaves updates readable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let current = state();
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: current }));
  await page.goto('/guest');
  await expect(strip(page)).toBeVisible();
  current = state([
    {
      ...item('IN_PREPARATION'),
      product_name_snapshot:
        'Gỏi rau củ theo mùa với đậu phộng rang, rau thơm và nước sốt riêng dành cho khách ăn chay',
    },
  ]);
  await resume(page);
  await expect(strip(page).getByRole('status')).toContainText('đang được chế biến');
  await page.setViewportSize({ width: 320, height: 844 });
  const text = strip(page).locator('.guest-live-notice-text');
  await expect
    .poll(() => text.evaluate((node) => getComputedStyle(node).animationName))
    .toBe('none');
  await expect
    .poll(() => text.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true);
  await expect(strip(page).getByRole('button', { name: 'Tạm dừng thông báo' })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
});

test('guest photograph loads and keeps the menu usable at desktop and small widths', async ({
  page,
}, info) => {
  await page.route('**/api/guest/state', (route) =>
    route.fulfill({ json: state([item('READY')]) }),
  );
  await page.goto('/guest');
  const photograph = page.getByRole('img', { name: 'Món Việt dùng tại bàn', exact: true });
  await expect(photograph).toBeVisible();
  await expect
    .poll(() =>
      photograph.evaluate((node) => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(photograph).toBeVisible();
    await expect(page.locator('.guest-header .brand-lockup strong')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('guest-photo-' + width + '.png'),
      fullPage: true,
      animations: 'disabled',
      scale: 'css',
    });
  }
});

test('a missing photograph leaves a clean text hero and does not block ordering', async ({
  page,
}, info) => {
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: state() }));
  await page.route('**/images/banners/guest.webp', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto('/guest');
  await expect(page.locator('.guest-photo-hero')).toHaveClass(/is-without-photo/);
  await expect(page.locator('.guest-hero-photo')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Hôm nay bạn muốn dùng món gì?', exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await strip(page).getByRole('button', { name: 'Món đã gọi', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Món đã gọi', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Điều hướng khách' })
      .getByRole('button', { name: 'Thực đơn', exact: true })
      .click();
  }
  await page.screenshot({
    path: info.outputPath('guest-photo-unavailable-320.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
});
