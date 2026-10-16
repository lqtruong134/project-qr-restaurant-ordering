import { test, expect } from '@playwright/test';
import { selectAdmin } from './admin-navigation';

test('admin manages an uploaded banner for a new product and guest reads the same record', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Quản trị', exact: true })).toBeVisible();
  const catalog = await (await context.request.get('/api/core/catalog')).json();
  const name = 'Món ảnh giới thiệu ' + testInfo.project.name;
  const created = await context.request.post('/api/core/products', {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data: {
      categoryId: catalog.categories[0].id,
      code: 'PROMO-' + Date.now() + '-' + testInfo.project.name,
      name,
      price: '35000',
      stockManaged: false,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  const product = await created.json();
  await page.getByRole('button', { name: 'Tải lại dữ liệu', exact: true }).click();
  await selectAdmin(page, 'Thực đơn', 'Ảnh giới thiệu');
  await page.getByRole('button', { name: 'Thêm ảnh giới thiệu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm ảnh giới thiệu', exact: true });
  await dialog.getByLabel('Món được giới thiệu', { exact: true }).selectOption(product.id);
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(
    dialog.getByText('Ảnh đã sẵn sàng. Chọn Lưu ảnh giới thiệu để hoàn tất.', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Dòng giới thiệu ngắn', { exact: true }).fill('Món mới từ nhà hàng');
  await dialog.getByLabel('Thứ tự hiển thị', { exact: true }).fill('0');
  await dialog
    .getByLabel('Tôi đã kiểm tra ảnh đúng món, giá và phần ăn hiện tại.', { exact: true })
    .check();
  await dialog.getByRole('button', { name: 'Lưu ảnh giới thiệu', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByPlaceholder('Tìm món hoặc nội dung giới thiệu…').fill(name);
  const card = page.getByRole('article', { name: 'Ảnh giới thiệu ' + name, exact: true });
  await expect(card.getByText('Đang hiển thị', { exact: true })).toBeVisible();
  let current = await (await context.request.get('/api/core/catalog')).json();
  const saved = current.promotions.find((p: { product_id: string }) => p.product_id === product.id);
  expect(saved.image_url).toMatch(/^[/]api[/]menu-images[/][a-f0-9-]{36}[.]png$/);
  const guest = await context.newPage();
  await guest.route('**/api/guest/state', (route) =>
    route.fulfill({
      json: {
        participant: { id: 'viewer', displayName: 'Khách xem ảnh' },
        participants: [],
        session: {
          id: 'viewer-session',
          table_name: 'Bàn A10',
          table_code: 'A10',
          area_name: 'Trong nhà',
          access_code: '1234',
        },
        cart: { cart_version: 1 },
        items: [],
        orders: [],
        support: [],
        account: {
          charge_total: '0',
          paid_total: '0',
          outstanding_amount: '0',
          refund_due_amount: '0',
        },
        products: current.products,
        promotions: current.promotions.filter(
          (p: { product_id: string }) => p.product_id === product.id,
        ),
      },
    }),
  );
  await guest.goto('/guest');
  await expect(guest.locator('.marketing-carousel').getByText(name, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Ẩn ảnh', exact: true }).click();
  await expect(card.getByText('Đã ẩn', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Sửa', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Sửa ảnh giới thiệu', exact: true });
  await edit.getByLabel('Dòng giới thiệu ngắn', { exact: true }).fill('Ảnh quản trị đã sửa');
  await edit.getByLabel('Hiển thị với khách', { exact: true }).selectOption('true');
  await edit
    .getByLabel('Tôi đã kiểm tra ảnh đúng món, giá và phần ăn hiện tại.', { exact: true })
    .check();
  await edit.getByRole('button', { name: 'Lưu ảnh giới thiệu', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(card.getByText('Ảnh quản trị đã sửa', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('admin-promotion-editor.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await card.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Xóa ảnh giới thiệu?', exact: true })
    .getByRole('button', { name: 'Xóa ảnh giới thiệu', exact: true })
    .click();
  await expect(card).toHaveCount(0);
  current = await (await context.request.get('/api/core/catalog')).json();
  expect(current.promotions.some((p: { product_id: string }) => p.product_id === product.id)).toBe(
    false,
  );
  await guest.close();
});

test('licensed dish photos keep attribution and the full image in menu cards and picker', async ({
  page,
}, info) => {
  const photos = [
    {
      id: 'licensed-one',
      code: 'ADMIN-NEW-1',
      name: 'Bún thịt nướng',
      image_url: '/api/menu-images/5c63ea2f-6d20-8157-9fdd-366d32a1f0dc.jpg',
      author: 'Takeaway',
    },
    {
      id: 'licensed-two',
      code: 'ADMIN-NEW-2',
      name: 'Mì Quảng tôm thịt',
      image_url: '/api/menu-images/ba74d017-10ce-80b2-bf7f-23ffc334dffb.jpg',
      author: 'Jpatokal',
    },
    {
      id: 'licensed-three',
      code: 'ADMIN-NEW-3',
      name: 'Thịt kho trứng',
      image_url: '/api/menu-images/89834677-fcc4-8a5c-adea-125ce567ca1c.jpg',
      author: 'HungryHuy',
    },
  ];
  await page.route('**/api/guest/state', (route) =>
    route.fulfill({
      json: {
        participant: { id: 'credit-viewer', displayName: 'Khách xem thực đơn' },
        participants: [],
        session: {
          id: 'credit-session',
          table_name: 'Bàn A10',
          table_code: 'A10',
          area_name: 'Trong nhà',
          access_code: '1234',
        },
        cart: { cart_version: 1 },
        items: [],
        orders: [],
        support: [],
        promotions: [],
        account: {
          charge_total: '0',
          paid_total: '0',
          outstanding_amount: '0',
          refund_due_amount: '0',
        },
        products: photos.map((photo) => ({
          ...photo,
          base_price: '79000',
          is_active: true,
          availability_status: 'AVAILABLE',
          product_kind: 'DISH',
          category_name: 'Món Việt',
          version: 1,
        })),
      },
    }),
  );
  await page.goto('/guest');
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const photo of photos) {
      const card = page
        .locator('.dish-card')
        .filter({ has: page.getByRole('heading', { name: photo.name, exact: true }) });
      const frame = card.locator('.dish-credit-frame');
      const credit = frame.getByRole('link', { name: photo.author, exact: true });
      await expect(credit).toBeVisible();
      await expect(frame.locator('img')).toHaveCSS('object-fit', 'contain');
      await expect
        .poll(() =>
          frame.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const frameBox = await frame.boundingBox();
      const creditBox = await frame.locator('.dish-photo-credit').boundingBox();
      expect(creditBox!.x).toBeGreaterThanOrEqual(frameBox!.x);
      expect(creditBox!.x + creditBox!.width).toBeLessThanOrEqual(
        frameBox!.x + frameBox!.width + 1,
      );
      expect(creditBox!.y + creditBox!.height).toBeLessThanOrEqual(
        frameBox!.y + frameBox!.height + 1,
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.getByRole('button', { name: 'Chọn Bún thịt nướng', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chọn món', exact: true });
  await expect(dialog.getByRole('link', { name: 'Takeaway', exact: true })).toBeVisible();
  await expect(dialog.locator('.dish-media img')).toHaveCSS('object-fit', 'contain');
  const sourceBox = await dialog.locator('.dish-photo-credit').boundingBox();
  const previewBox = await dialog.locator('.add-dish-preview').boundingBox();
  expect(sourceBox!.width).toBeGreaterThan(previewBox!.width / 2);
  await dialog.screenshot({
    path: info.outputPath('licensed-photo-picker-320.png'),
    animations: 'disabled',
  });
});
