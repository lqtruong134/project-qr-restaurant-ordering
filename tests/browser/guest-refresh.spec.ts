import { readFileSync } from 'node:fs';
const manifest = JSON.parse(
  readFileSync(
    new URL('../../packages/database/resources/menu-images/manifest.json', import.meta.url),
    'utf8',
  ),
) as { products: Record<string, string>; promotions: Record<string, string> };
import type { MenuPromotion } from '../../packages/contracts/src/menu-promotions';
import { test, expect, type Page } from '@playwright/test';

const products = [
  {
    id: 'rice',
    code: 'CHINH-01',
    name: 'Cơm tấm sườn nướng',
    base_price: '79000',
    description: 'Sườn nướng, cơm tấm và đồ chua.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'DISH',
    category_name: 'Cơm & món chính',
    version: 1,
  },
  {
    id: 'rolls',
    code: 'KHAI-01',
    name: 'Gỏi cuốn tôm thịt',
    base_price: '45000',
    description: 'Tôm, thịt và rau tươi cuốn bánh tráng.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'DISH',
    category_name: 'Khai vị',
    version: 1,
  },
  {
    id: 'pho',
    code: 'CHINH-02',
    name: 'Phở bò',
    base_price: '69000',
    description: 'Nước dùng thanh và thịt bò.',
    is_active: true,
    availability_status: 'UNAVAILABLE',
    product_kind: 'DISH',
    category_name: 'Cơm & món chính',
    version: 1,
  },
  {
    id: 'combo',
    code: 'COMBO-02',
    name: 'Combo cuốn & trà',
    base_price: '149000',
    regular_price: '168000',
    description: 'Gỏi cuốn và trà cho hai người.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'COMBO',
    category_name: 'Combo',
    version: 1,
    components: [
      {
        product_id: 'rolls',
        code: 'KHAI-01',
        name: 'Gỏi cuốn tôm thịt',
        quantity: 2,
        image_url: null,
        unit_price: '45000',
        available: true,
      },
      {
        product_id: 'tea',
        code: 'DRINK-01',
        name: 'Trà tắc mật ong',
        quantity: 2,
        image_url: null,
        unit_price: '39000',
        available: true,
      },
    ],
  },
  {
    id: 'rice-combo',
    code: 'COMBO-01',
    name: 'Combo cơm trưa',
    base_price: '99000',
    regular_price: '108000',
    description: 'Cơm tấm và nước sâm.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'COMBO',
    category_name: 'Combo',
    version: 1,
    components: [
      {
        product_id: 'rice',
        code: 'CHINH-01',
        name: 'Cơm tấm sườn nướng',
        quantity: 1,
        image_url: null,
        unit_price: '79000',
        available: true,
      },
      {
        product_id: 'lemon',
        code: 'DRINK-03',
        name: 'Nước sâm nhà nấu',
        quantity: 1,
        image_url: null,
        unit_price: '29000',
        available: true,
      },
    ],
  },
  {
    id: 'rice-ball',
    code: 'CHINH-11',
    name: 'Cơm nắm bò sốt tiêu đen',
    base_price: '18000',
    description: 'Cơm nắm và bò sốt tiêu đen.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'DISH',
    category_name: 'Cơm & món chính',
    version: 1,
  },
  {
    id: 'pork',
    code: 'NUONG-09',
    name: 'Ba rọi mắm ruốc',
    base_price: '89000',
    description: 'Thịt ba rọi và mắm ruốc.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'DISH',
    category_name: 'Món nướng',
    version: 1,
  },
  {
    id: 'chicken-set',
    code: 'COMBO-05',
    name: 'Set cơm 69k',
    base_price: '69000',
    regular_price: '100000',
    description: 'Set cơm có gà, thịt, trứng và món ăn kèm cho một người.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'COMBO',
    category_name: 'Combo',
    version: 1,
    components: [
      {
        product_id: 'chicken',
        code: 'CHINH-14',
        name: 'Cơm gà kho gừng',
        quantity: 1,
        image_url: null,
        unit_price: '45000',
        available: true,
      },
      {
        product_id: 'set-pork',
        code: 'NUONG-10',
        name: 'Thịt ba rọi mắm ruốc (phần cơm)',
        quantity: 1,
        image_url: null,
        unit_price: '20000',
        available: true,
      },
      {
        product_id: 'set-egg',
        code: 'KHAI-10',
        name: 'Trứng chiên (phần cơm)',
        quantity: 1,
        image_url: null,
        unit_price: '10000',
        available: true,
      },
      {
        product_id: 'vegetables',
        code: 'KHAI-09',
        name: 'Rau cải xào tỏi (phần cơm)',
        quantity: 1,
        image_url: null,
        unit_price: '10000',
        available: true,
      },
      {
        product_id: 'broth',
        code: 'LAU-10',
        name: 'Canh rau củ (phần cơm)',
        quantity: 1,
        image_url: null,
        unit_price: '10000',
        available: true,
      },
      {
        product_id: 'fruit',
        code: 'DESSERT-09',
        name: 'Tráng miệng trái cây',
        quantity: 1,
        image_url: null,
        unit_price: '5000',
        available: true,
      },
    ],
  },
  {
    id: 'weekend',
    code: 'COMBO-04',
    name: 'Combo cuối tuần',
    base_price: '499000',
    regular_price: '526000',
    description: 'Combo dùng chung cho ba người.',
    is_active: true,
    availability_status: 'AVAILABLE',
    product_kind: 'COMBO',
    category_name: 'Combo',
    version: 1,
    components: [
      {
        product_id: 'hotpot',
        code: 'LAU-09',
        name: 'Lẩu Thái bò & tôm',
        quantity: 1,
        image_url: null,
        unit_price: '299000',
        available: true,
      },
      {
        product_id: 'platter',
        code: 'CHINH-13',
        name: 'Mâm cuốn thịt luộc & chả giò',
        quantity: 1,
        image_url: null,
        unit_price: '149000',
        available: true,
      },
      {
        product_id: 'strawberry',
        code: 'DRINK-09',
        name: 'Trà dâu',
        quantity: 2,
        image_url: null,
        unit_price: '39000',
        available: true,
      },
    ],
  },
];
const promotions: MenuPromotion[] = products
  .filter((product) =>
    Boolean(manifest.promotions[product.code as keyof typeof manifest.promotions]),
  )
  .map((product, index) => ({
    id: 'promotion-' + product.id,
    product_id: product.id,
    image_url:
      '/api/menu-images/' + manifest.promotions[product.code as keyof typeof manifest.promotions],
    image_width:
      product.code === 'CHINH-11'
        ? 1024
        : product.code === 'NUONG-09'
          ? 820
          : product.code === 'COMBO-05'
            ? 721
            : 681,
    image_height: 1024,
    presentation: 'POSTER',
    expected_price:
      product.code === 'CHINH-11' ? '18000' : product.code === 'COMBO-05' ? '69000' : null,
    expected_components: product.product_kind === 'COMBO' ? (product.components ?? []) : [],
    eyebrow: 'Gợi ý từ bếp',
    image_note: null,
    sort_order: index,
    is_active: true,
    version: 1,
  }));

function guestState() {
  return {
    participant: { id: 'person-a', displayName: 'Minh Anh' },
    participants: [{ id: 'person-a', display_name: 'Minh Anh' }],
    session: {
      id: '9c01858c-0000-0000-0000-000000000001',
      table_id: 'table-a',
      table_name: 'Bàn A10',
      area_name: 'Trong nhà',
      access_code: '1234',
      version: 1,
    },
    products: products.map((product) => ({
      ...product,
      // Keep one combo without its own photo to verify the component gallery and placeholder.
      image_url:
        product.code !== 'COMBO-02' &&
        manifest.products[product.code as keyof typeof manifest.products]
          ? '/api/menu-images/' + manifest.products[product.code as keyof typeof manifest.products]
          : null,
      image_promotion:
        promotions.find(
          (p) =>
            p.product_id === product.id &&
            p.image_url ===
              '/api/menu-images/' +
                manifest.products[product.code as keyof typeof manifest.products],
        ) ?? null,
      components: product.components?.map((component) => ({
        ...component,
        image_url:
          component.code !== 'DRINK-01' &&
          manifest.products[component.code as keyof typeof manifest.products]
            ? '/api/menu-images/' +
              manifest.products[component.code as keyof typeof manifest.products]
            : null,
      })),
    })),
    promotions,

    cart: { cart_version: 1 },
    items: [
      {
        id: 'cart-combo',
        product_id: 'combo',
        product_kind: 'COMBO',
        product_version_preview: 1,
        name: 'Combo cuốn & trà',
        quantity: 1,
        unit_price_preview: '149000',
        current_price: '149000',
        owner_participant_id: 'person-a',
        available: true,
        created_at: '2026-10-11T04:00:00Z',
      },
    ],
    orders: [
      {
        id: 'order-one',
        item_id: 'order-combo',
        product_name_snapshot: 'Combo cuốn & trà',
        product_kind_snapshot: 'COMBO',
        combo_components_snapshot: products[3]!.components,
        quantity: 1,
        status: 'ACCEPTED',
        item_status: 'ACCEPTED',
        owner_participant_id: 'person-a',
        created_by_participant_id: 'person-a',
        owner_name: 'Minh Anh',
        charge_status: 'ACTIVE',
        unit_price_snapshot: '149000',
        line_total: '149000',
        created_at: '2026-10-11T04:00:00Z',
      },
    ],
    support: [],
    payments: [],
    refundTransactions: [],
    account: {
      id: 'account',
      charge_total: '149000',
      paid_total: '0',
      refunded_total: '0',
      outstanding_amount: '149000',
      refund_due_amount: '0',
    },
  };
}
async function fit(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  for (const target of [
    '.guest-welcome-panel',
    '.marketing-carousel-controls',
    '.combo-card',
    '.shopping-cart-row',
  ]) {
    for (const element of await page.locator(target).all()) {
      if (!(await element.isVisible())) continue;
      const box = await element.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}

test('photo welcome preserves QR validation and combo contents remain clear at narrow widths', async ({
  page,
}, info) => {
  let joined = false;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/guest/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/qr-info'))
      return route.fulfill({
        json: { table_name: 'Bàn A10', area_name: 'Trong nhà', already_joined: false },
      });
    if (path.endsWith('/access-request/status')) return route.fulfill({ json: null });
    if (path.endsWith('/join')) {
      const body = route.request().postDataJSON();
      expect(body.name).toBe('Minh Anh');
      expect(body.accessCode).toBe('1234');
      joined = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.startsWith('/api/menu-images/')) return route.continue();
    if (path.endsWith('/state') && joined) return route.fulfill({ json: guestState() });
    return route.fulfill({ status: 401, json: { userMessage: 'Vui lòng vào bàn.' } });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/guest#table-token');
  await expect(page.locator('.guest-welcome-table')).toContainText('Bàn A10');
  await page.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
  await expect(page.locator('.guest-join-form').getByRole('alert')).toContainText(
    'Vui lòng nhập tên',
  );
  await fit(page);
  await page.screenshot({
    path: info.outputPath('guest-welcome-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await fit(page);
    await page.screenshot({
      path: info.outputPath(`guest-welcome-${width}.png`),
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByLabel('Tên của bạn', { exact: true }).fill('Minh Anh');
  await page.getByLabel('Mã vào bàn', { exact: true }).fill('1234');
  const agreement = page.getByRole('checkbox', {
    name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn',
  });
  await expect(agreement).not.toBeChecked();
  await page.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
  await expect(page.locator('.guest-join-form').getByRole('alert')).toContainText(
    'Vui lòng đồng ý',
  );
  expect(joined).toBe(false);
  await agreement.check();
  await page.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
  await expect(page.locator('.guest-combo-section')).toContainText('Combo cuốn & trà');
  await expect(page.locator('.guest-combo-section')).toContainText('149.000');
  await expect(page.locator('.guest-combo-section')).toContainText('19.000');
  const categories = page.getByRole('group', { name: 'Danh mục món', exact: true });
  await expect(categories.getByRole('button').nth(0)).toHaveText('Tất cả');
  await expect(categories.getByRole('button').nth(1)).toHaveText('Combo');
  await categories.getByRole('button', { name: 'Combo', exact: true }).click();
  await expect(page.locator('.combo-card')).toHaveCount(4);
  await expect(page.locator('.dish-card:not(.combo-card)')).toHaveCount(0);
  await categories.screenshot({
    path: info.outputPath('guest-combo-filter-320.png'),
    animations: 'disabled',
  });
  for (const [name, file] of [
    ['Set cơm 69k', 'set'],
    ['Combo cuối tuần', 'weekend'],
  ]) {
    const card = page
      .locator('.combo-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.locator('.guest-combo-poster img')).toHaveCSS('object-fit', 'contain');
    await card.screenshot({
      path: info.outputPath(`guest-${file}-card-320.png`),
      animations: 'disabled',
    });
  }
  await categories.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await expect(page.locator('.combo-card')).toHaveCount(4);
  await expect(page.locator('.dish-card:not(.combo-card)')).toHaveCount(5);
  const carousel = page.getByRole('region', { name: 'Gợi ý từ thực đơn', exact: true });
  await expect(carousel.locator('.marketing-slide:not([data-clone])')).toHaveCount(4);
  await expect(carousel).not.toContainText('Phở bò');
  const mobileCart = page.getByRole('button', { name: 'Xem giỏ món của tôi', exact: true });
  await expect(mobileCart).toContainText('1 combo');
  await expect(mobileCart.locator('strong')).toHaveCSS('white-space', 'nowrap');
  const buttonBox = await mobileCart.boundingBox();
  const amountBox = await mobileCart.locator('strong').boundingBox();
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(buttonBox!.x + buttonBox!.width);
  expect(amountBox!.height).toBeLessThan(28);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('guest-menu-320.png'), animations: 'disabled' });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const slide = carousel.locator('.marketing-slide[aria-hidden="false"]');
    await expect(slide).toHaveAttribute('data-presentation', 'poster');
    await expect(slide.locator('img')).toHaveCSS('object-fit', 'contain');
    await expect
      .poll(() =>
        slide.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const imageBox = await slide.locator('.marketing-slide-photo').boundingBox();
    const copyBox = await slide.locator('.marketing-slide-copy').boundingBox();
    if (width > 850) expect(copyBox!.x).toBeGreaterThanOrEqual(imageBox!.x + imageBox!.width - 1);
    else expect(copyBox!.y).toBeGreaterThanOrEqual(imageBox!.y + imageBox!.height - 1);
    await fit(page);
    await carousel.screenshot({
      path: info.outputPath(`guest-poster-${width}.png`),
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await carousel.getByRole('button', { name: 'Xem ảnh 3: Set cơm 69k', exact: true }).click();
  await carousel.getByRole('button', { name: 'Xem combo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Chọn món', exact: true })).toContainText(
    'Set cơm 69k',
  );
  await expect(page.getByRole('dialog').locator('.guest-combo-poster img')).toHaveCSS(
    'object-fit',
    'contain',
  );
  await expect(page.getByRole('dialog').locator('.combo-contents')).toContainText(
    'Tráng miệng trái cây',
  );
  await expect(page.getByRole('dialog').locator('.combo-contents li')).toHaveCount(6);
  await expect(page.getByRole('dialog').locator('.combo-contents')).toContainText(
    'Thịt ba rọi mắm ruốc',
  );
  await expect(page.getByRole('dialog').locator('.combo-contents')).toContainText('Trứng chiên');
  await page
    .getByRole('dialog')
    .screenshot({ path: info.outputPath('guest-set-picker-320.png'), animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page
    .locator('.combo-card')
    .filter({ has: page.getByRole('heading', { name: 'Combo cuốn & trà', exact: true }) })
    .getByRole('button', { name: 'Chọn Combo cuốn & trà', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Chọn món', exact: true });
  await expect(dialog).toContainText('149.000 đ / combo');
  await expect(dialog.locator('.combo-contents')).toContainText('2 phần');
  await expect(dialog.locator('.combo-contents')).toContainText('Trà tắc mật ong');
  const missingPhoto = dialog.locator('.photo-placeholder-label').first();
  const photoFrame = await missingPhoto.locator('..').boundingBox();
  const photoLabel = await missingPhoto.boundingBox();
  expect(photoLabel!.x).toBeGreaterThanOrEqual(photoFrame!.x);
  expect(photoLabel!.x + photoLabel!.width).toBeLessThanOrEqual(photoFrame!.x + photoFrame!.width);
  await fit(page);
  await page.screenshot({
    path: info.outputPath('guest-combo-picker-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Điều hướng khách' });
  await nav.getByRole('button', { name: /Giỏ món/ }).click();
  await expect(page.locator('.shopping-cart-row')).toContainText('149.000 đ / combo');
  await expect(page.locator('.shopping-cart-row')).toContainText('2 × Trà tắc mật ong');
  await fit(page);
  await nav.getByRole('button', { name: 'Món đã gọi', exact: true }).click();
  await expect(page.locator('.guest-ordered-combo')).toContainText(
    'Mỗi combo gồm: 2 × Gỏi cuốn tôm thịt',
  );
  await expect(page.locator('.guest-order-item')).toContainText('1 × Combo cuốn & trà');
  await nav.getByRole('button', { name: 'Thanh toán', exact: true }).click();
  await expect(page.locator('.guest-bill-lines')).toContainText(
    'Mỗi combo gồm: 2 × Gỏi cuốn tôm thịt',
  );
  await expect(page.locator('.guest-bill-lines')).toContainText('149.000 đ / combo');
  await expect(page.locator('.guest-bill-lines')).toContainText('1 combo');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await fit(page);
  }
  expect(errors).toEqual([]);
});

test('centered circular dots select promotions while the three-second loop continues and reduced motion stops it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: guestState() }));
  await page.goto('/guest');
  const carousel = page.getByRole('region', { name: 'Gợi ý từ thực đơn', exact: true });
  await expect(carousel.locator('.marketing-slide:not([data-clone])')).toHaveCount(4);
  await expect(carousel).toHaveAttribute('data-reduced-motion', 'false');
  const dots = carousel.locator('.marketing-carousel-dots button');
  await expect(carousel.getByRole('button', { name: 'Ảnh trước', exact: true })).toHaveCount(0);
  await expect(carousel.getByRole('button', { name: 'Ảnh tiếp theo', exact: true })).toHaveCount(0);
  await expect(carousel.locator('.marketing-carousel-pause')).toHaveCount(0);
  await expect(dots.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(dots.first().locator('span')).toHaveCSS('border-radius', '50%');
  await expect(dots.first().locator('span')).toHaveCSS('width', '12px');
  await expect(dots.nth(1).locator('span')).toHaveCSS('width', '7px');
  await page.clock.runFor(3100);
  await expect(dots.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(3000);
  await expect(dots.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(3000);
  await expect(dots.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(carousel.locator('.marketing-carousel-track')).toHaveAttribute('style', /-300%/);
  await page.clock.runFor(3000);
  await expect(dots.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(carousel.locator('.marketing-carousel-track')).toHaveAttribute('style', /-400%/);
  await expect(carousel.locator('.marketing-slide[aria-hidden="false"]')).toHaveCount(1);
  await page.clock.runFor(700);
  await expect(carousel.locator('.marketing-carousel-track')).toHaveAttribute(
    'style',
    /translateX\(-?0%\)/,
  );
  await dots.nth(2).click();
  await expect(dots.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(3000);
  await expect(dots.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(carousel).toHaveAttribute('data-reduced-motion', 'true');
  await dots.nth(1).click();
  await expect(dots.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(14000);
  await expect(dots.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 320, height: 844 });
  await fit(page);
});

test('updated combo needs guest confirmation even when price is unchanged and mismatched posters leave promotions', async ({
  page,
}) => {
  const state = structuredClone(guestState());
  state.products[3]!.version = 2;
  state.products[3]!.components![1]!.quantity = 3;
  state.products.find((product) => product.code === 'COMBO-05')!.base_price = '70000';
  state.products.find((product) => product.code === 'COMBO-04')!.components = [];
  let patches = 0;
  await page.route('**/api/guest/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) return route.fulfill({ json: state });
    if (path.endsWith('/cart/cart-combo') && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toMatchObject({ quantity: 1, cartVersion: 1 });
      state.items[0]!.product_version_preview = 2;
      state.cart.cart_version = 2;
      patches += 1;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { userMessage: 'Không tìm thấy thao tác.' } });
  });
  await page.goto('/guest');
  const carousel = page.getByRole('region', { name: 'Gợi ý từ thực đơn', exact: true });
  await expect(carousel.locator('.marketing-slide:not([data-clone])')).toHaveCount(2);
  await expect(carousel).not.toContainText('Set cơm 69k');
  await expect(carousel).not.toContainText('Combo cuối tuần');
  await page
    .getByRole('navigation', { name: 'Điều hướng khách' })
    .getByRole('button', { name: /Giỏ món/ })
    .click();
  const cartRow = page.locator('.shopping-cart-row');
  await expect(cartRow).toContainText('3 × Trà tắc mật ong');
  await expect(cartRow).toContainText('149.000 đ / combo');
  await expect(page.getByRole('button', { name: 'Gửi món đã chọn', exact: true })).toBeDisabled();
  await expect(cartRow.getByRole('button', { name: /^Tăng số lượng/ })).toBeDisabled();
  await cartRow.getByRole('button', { name: 'Xác nhận combo mới', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gửi món đã chọn', exact: true })).toBeEnabled();
  await expect(
    cartRow.getByRole('button', { name: 'Xác nhận combo mới', exact: true }),
  ).toHaveCount(0);
  expect(patches).toBe(1);
  await fit(page);
});

test('the Combo filter stays beside All and has a clear empty state when no combo is sold', async ({
  page,
}) => {
  const state = structuredClone(guestState());
  state.products = state.products.filter((product) => product.product_kind !== 'COMBO');
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: state }));
  await page.goto('/guest');
  const categories = page.getByRole('group', { name: 'Danh mục món', exact: true });
  await expect(categories.getByRole('button').nth(0)).toHaveText('Tất cả');
  await expect(categories.getByRole('button').nth(1)).toHaveText('Combo');
  await categories.getByRole('button', { name: 'Combo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Không tìm thấy món phù hợp', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.dish-card')).toHaveCount(0);
  await categories.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await expect(page.locator('.dish-card')).toHaveCount(5);
  await fit(page);
});
