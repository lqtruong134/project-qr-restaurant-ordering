import { test, expect } from '@playwright/test';

test('guest cart success and table move use the shared dismissible countdown notice', async ({
  page,
}, info) => {
  const product = {
    id: 'toast-dish',
    code: 'TOAST-DISH',
    name: 'Gỏi cuốn tôm thịt',
    description: 'Phần cuốn tươi',
    base_price: '45000',
    category_id: 'starter',
    category_name: 'Khai vị & gỏi',
    version: 1,
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'DISH' as const,
    image_url: null,
  };
  const current = {
    participant: { id: 'toast-guest', displayName: 'Lan' },
    participants: [{ id: 'toast-guest', display_name: 'Lan' }],
    session: {
      id: 'toast-session',
      table_id: 'toast-table',
      table_name: 'Bàn A01',
      version: 1,
      session_status: 'ACTIVE',
      verification_status: 'VERIFIED',
      access_code: '1234',
      area_name: 'Trong nhà',
    },
    cart: { cart_version: 1 },
    items: [] as {
      id: string;
      product_id: string;
      owner_participant_id: string;
      name: string;
      quantity: number;
      unit_price_preview: string;
      created_at: string;
    }[],
    products: [product],
    promotions: [],
    orders: [],
    support: [],
    payments: [],
    refundTransactions: [],
    account: {
      id: 'toast-account',
      charge_total: '0',
      paid_total: '0',
      refunded_total: '0',
      outstanding_amount: '0',
      refund_due_amount: '0',
    },
  };
  const errors: string[] = [],
    writes: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (request.method() === 'GET') {
      if (path === '/guest/state') return route.fulfill({ json: current });
      if (path === '/guest/promotion')
        return route.fulfill({ json: { programs: [], locked: false } });
      return route.fulfill({ json: [] });
    }
    expect(path).toBe('/guest/cart');
    expect(request.method()).toBe('POST');
    writes.push(path);
    current.items = [
      {
        id: 'toast-cart-item',
        product_id: product.id,
        owner_participant_id: current.participant.id,
        name: product.name,
        quantity: 1,
        unit_price_preview: product.base_price,
        created_at: new Date().toISOString(),
      },
    ];
    current.cart.cart_version++;
    return route.fulfill({ json: current.items[0] });
  });
  await page.goto('/guest');
  await page.getByRole('button', { name: 'Chọn ' + product.name, exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chọn món', exact: true })
    .getByRole('button', { name: 'Thêm vào giỏ', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const success = page.locator('.operation-notice.success');
  await expect(success).toContainText('Đã thêm 1 × ' + product.name);
  await expect(success.locator('.operation-notice-progress')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(success.locator('.operation-notice-progress-fill')).toBeVisible();
  await success.hover();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await success.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.screenshot({
    path: info.outputPath('guest-countdown-notice-320.png'),
    animations: 'disabled',
  });
  await success.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  await expect(success).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  current.session = {
    ...current.session,
    table_id: 'toast-table-2',
    table_name: 'Bàn A02',
    version: 2,
  };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const moved = page.locator('.operation-notice.info');
  await expect(moved).toContainText('Bàn của bạn đã được chuyển sang Bàn A02');
  await expect
    .poll(() =>
      moved
        .locator('.operation-notice-progress-fill')
        .evaluate((e) => getComputedStyle(e).transitionDuration),
    )
    .toBe('0s');
  await moved.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();
  await expect(moved).toHaveCount(0);
  expect(writes).toEqual(['/guest/cart']);
  expect(errors).toEqual([]);
});
