import { readFileSync } from 'node:fs';
const manifest = JSON.parse(
  readFileSync(
    new URL('../../packages/database/resources/menu-images/manifest.json', import.meta.url),
    'utf8',
  ),
) as { products: Record<string, string>; promotions: Record<string, string> };
import type { MenuPromotion } from '../../packages/contracts/src/menu-promotions';
import { expect, test, type Page } from '@playwright/test';
type LayoutProduct = {
  image_url?: string | null;
  image_promotion?: MenuPromotion | null;
  id: string;
  code: string;
  name: string;
  base_price: string;
  version: number;
  is_active: boolean;
  availability_status: 'AVAILABLE';
  product_kind: 'DISH' | 'COMBO';
  category_name: string;
  description: string;
  regular_price?: string;
  components?: { product_id: string; code: string; name: string; quantity: number }[];
};

const dish = (id: string, code: string, name: string, price: string): LayoutProduct => ({
  id,
  code,
  name,
  base_price: price,
  version: 1,
  is_active: true,
  availability_status: 'AVAILABLE',
  product_kind: 'DISH',
  category_name: 'Món Việt',
  description: 'Món ăn được chuẩn bị tại bếp.',
});
const component = (code: string, name: string, quantity = 1) => ({
  product_id: code,
  code,
  name,
  quantity,
});
function state(filled: boolean) {
  const products: LayoutProduct[] = [
    dish('balls', 'CHINH-11', 'Cơm nắm bò sốt tiêu đen', '18000'),
    dish('pork', 'NUONG-09', 'Ba rọi mắm ruốc', '89000'),
    {
      ...dish('set', 'COMBO-05', 'Set cơm 69k', '69000'),
      product_kind: 'COMBO',
      regular_price: '100000',
      components: [
        component('CHINH-14', 'Cơm gà kho gừng'),
        component('NUONG-10', 'Thịt ba rọi mắm ruốc (phần cơm)'),
        component('KHAI-10', 'Trứng chiên (phần cơm)'),
        component('KHAI-09', 'Rau cải xào tỏi (phần cơm)'),
        component('LAU-10', 'Canh rau củ (phần cơm)'),
        component('DESSERT-09', 'Tráng miệng trái cây'),
      ],
    },
    {
      ...dish('weekend', 'COMBO-04', 'Combo cuối tuần', '499000'),
      product_kind: 'COMBO',
      regular_price: '526000',
      components: [
        component('LAU-09', 'Lẩu Thái bò & tôm'),
        component('CHINH-13', 'Mâm cuốn thịt luộc & chả giò'),
        component('DRINK-09', 'Trà dâu', 2),
      ],
    },
    dish('rice', 'CHINH-01', 'Cơm tấm sườn nướng', '79000'),
    dish('pho', 'CHINH-02', 'Phở bò', '69000'),
    dish('rolls', 'KHAI-01', 'Gỏi cuốn tôm thịt', '45000'),
    dish('spring-rolls', 'KHAI-02', 'Chả giò giòn', '75000'),
    dish('pancake', 'CHINH-09', 'Bánh xèo tôm thịt', '79000'),
    dish('fish-noodles', 'CHINH-10', 'Bún cá', '69000'),
    dish('beef', 'CHINH-12', 'Bò sốt tiêu đen', '149000'),
    dish('chicken', 'CHINH-14', 'Cơm gà kho gừng', '45000'),
    dish('set-pork', 'NUONG-10', 'Thịt ba rọi mắm ruốc (phần cơm)', '20000'),
    dish('egg', 'KHAI-10', 'Trứng chiên (phần cơm)', '10000'),
    dish('vegetables', 'KHAI-09', 'Rau cải xào tỏi (phần cơm)', '10000'),
    dish('soup', 'LAU-10', 'Canh rau củ (phần cơm)', '10000'),
    dish('fruit', 'DESSERT-09', 'Tráng miệng trái cây', '5000'),
    dish('hotpot', 'LAU-09', 'Lẩu Thái bò & tôm', '299000'),
    dish('platter', 'CHINH-13', 'Mâm cuốn thịt luộc & chả giò', '149000'),
    dish('tea', 'DRINK-09', 'Trà dâu', '39000'),
  ];
  const promotions: MenuPromotion[] = products.slice(0, 4).map((product, index) => ({
    id: 'banner-' + product.id,
    product_id: product.id,
    image_url:
      '/api/menu-images/' + manifest.promotions[product.code as keyof typeof manifest.promotions],
    image_width: index === 0 ? 1024 : index === 1 ? 820 : index === 2 ? 721 : 681,
    image_height: 1024,
    presentation: 'POSTER',
    expected_price: index === 0 ? '18000' : index === 2 ? '69000' : null,
    expected_components: product.product_kind === 'COMBO' ? [...(product.components ?? [])] : [],
    eyebrow: ['Món mới', 'Món mới từ bếp', 'Set cơm đủ vị', 'Combo đặc biệt'][index]!,
    image_note:
      index === 2
        ? 'Set có cả gà, thịt và trứng; cơm và các phần ăn kèm được liệt kê bên dưới.'
        : null,
    sort_order: index,
    is_active: true,
    version: 1,
  }));
  for (const product of products) {
    product.image_url = manifest.products[product.code as keyof typeof manifest.products]
      ? '/api/menu-images/' + manifest.products[product.code as keyof typeof manifest.products]
      : null;
    product.image_promotion =
      promotions.find((p) => p.product_id === product.id && p.image_url === product.image_url) ??
      null;
  }
  return {
    participant: { id: 'guest-a', displayName: 'Minh Anh' },
    participants: [{ id: 'guest-a', display_name: 'Minh Anh' }],
    session: {
      id: 'layout-session-a',
      table_id: 'table-a',
      table_name: 'Bàn A10',
      area_name: 'Trong nhà',
      access_code: '1234',
      version: 1,
    },
    products,
    promotions,
    cart: { cart_version: 1 },
    items: filled
      ? products
          .filter((p) => ['balls', 'set', 'weekend'].includes(p.id))
          .map((p) => ({
            id: 'cart-' + p.id,
            product_id: p.id,
            product_kind: p.product_kind ?? 'DISH',
            product_version_preview: p.version,
            name: p.name,
            quantity: p.id === 'balls' ? 2 : 1,
            unit_price_preview: p.base_price,
            current_price: p.base_price,
            owner_participant_id: 'guest-a',
            available: true,
            created_at: '2026-10-12T09:00:00Z',
          }))
      : [],
    orders: [],
    support: [],
    payments: [],
    refundTransactions: [],
    account: {
      id: 'account-a',
      charge_total: '0',
      paid_total: '0',
      refunded_total: '0',
      outstanding_amount: '0',
      refund_due_amount: '0',
    },
  };
}
async function mock(page: Page, payload: ReturnType<typeof state>) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/guest/state', (route) => route.fulfill({ json: payload }));
}
async function fit(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

for (const filled of [false, true]) {
  test(`laptop menu has a compact banner and a sticky right cart when ${filled ? 'filled' : 'empty'}`, async ({
    page,
  }, info) => {
    await mock(page, state(filled));
    for (const width of [900, 1024, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/guest');
      const banner = page.locator('.guest-menu-promotions');
      const cart = page.locator('.cart-sidebar');
      await expect(cart).toBeVisible();
      await expect(cart).toHaveCSS('position', 'sticky');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const banner = document
              .querySelector('.guest-menu-promotions')!
              .getBoundingClientRect();
            const menu = document.querySelector('.menu-layout > section')!.getBoundingClientRect();
            const cart = document.querySelector('.cart-sidebar')!.getBoundingClientRect();
            return {
              sameMenuLeft: Math.abs(banner.x - menu.x) <= 2,
              sameMenuWidth: Math.abs(banner.width - menu.width) <= 2,
              compact: banner.height > 0 && banner.height <= 440,
              cartToRight: cart.x > banner.right + 10,
              cartAtColumnStart: Math.abs(cart.y - banner.y) <= 3,
              cartInsideViewport: cart.right <= innerWidth + 1,
            };
          }),
        )
        .toEqual({
          sameMenuLeft: true,
          sameMenuWidth: true,
          compact: true,
          cartToRight: true,
          cartAtColumnStart: true,
          cartInsideViewport: true,
        });
      if (filled) await expect(cart).toContainText('604.000');
      else await expect(cart).toContainText('Bạn chưa thêm món nào');
      await fit(page);
      for (const slideIndex of [0, 2, 3]) {
        await banner.locator('.marketing-carousel-dots button').nth(slideIndex).click();
        await expect
          .poll(() =>
            page.evaluate(() => {
              const banner = document
                .querySelector('.guest-menu-promotions')!
                .getBoundingClientRect();
              const cart = document.querySelector('.cart-sidebar')!.getBoundingClientRect();
              return {
                compact: banner.height > 0 && banner.height <= 440,
                cartToRight: cart.x > banner.right + 10,
                cartInsideViewport: cart.right <= innerWidth + 1,
              };
            }),
          )
          .toEqual({ compact: true, cartToRight: true, cartInsideViewport: true });
        await fit(page);
        await page.screenshot({
          path: info.outputPath(
            `${filled ? 'filled' : 'empty'}-laptop-${width}-poster-${slideIndex}.png`,
          ),
          animations: 'disabled',
        });
      }

      const stickyTop = await cart.evaluate((element) => parseFloat(getComputedStyle(element).top));
      const initialY = await cart.evaluate(
        (element) => element.getBoundingClientRect().y + scrollY,
      );
      for (const offset of [180, 400]) {
        const target = initialY + offset;
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
        ).toBeGreaterThanOrEqual(target);
        await page.evaluate((y) => window.scrollTo(0, y), target);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(target - 2);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(target + 2);
        await expect
          .poll(async () => Math.abs((await cart.boundingBox())!.y - stickyTop))
          .toBeLessThanOrEqual(3);
        await expect(cart.getByRole('button', { name: /Xem giỏ món/ })).toBeInViewport();
      }
    }
  });

  test(`mobile keeps complete square and portrait posters without excess frame space when cart is ${filled ? 'filled' : 'empty'}`, async ({
    page,
  }, info) => {
    await mock(page, state(filled));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/guest');
      const banner = page.locator('.guest-menu-promotions');
      await expect(page.locator('.cart-sidebar')).not.toBeVisible();
      for (const slideIndex of [0, 1, 2, 3, 0]) {
        await banner.locator('.marketing-carousel-dots button').nth(slideIndex).click();
        const slide = banner.locator('.marketing-slide[aria-hidden="false"]');
        const image = slide.locator('.marketing-slide-photo img');
        await expect(image).toHaveCSS('object-fit', 'contain');
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
        await expect
          .poll(() =>
            image.evaluate((element) => {
              const image = element as HTMLImageElement;
              const box = image.getBoundingClientRect();
              const frame = image.parentElement!.getBoundingClientRect();
              const scale = Math.min(
                box.width / image.naturalWidth,
                box.height / image.naturalHeight,
              );
              const horizontalSpace = frame.width - image.naturalWidth * scale;
              const verticalSpace = frame.height - image.naturalHeight * scale;
              const article = image.closest('.marketing-slide')!;
              const slide = article.getBoundingClientRect();
              const copy = article.querySelector('.marketing-slide-copy')!.getBoundingClientRect();
              const note = article
                .querySelector('.marketing-slide-image-note')
                ?.getBoundingClientRect();
              const leftover = slide.height - frame.height - copy.height - (note?.height ?? 0);
              const window = article.closest('.marketing-carousel-window')!.getBoundingClientRect();
              return {
                horizontalSpaceBounded: horizontalSpace >= -1 && horizontalSpace <= 5,
                verticalSpaceBounded: verticalSpace >= -1 && verticalSpace <= 5,
                imageWithinFrame:
                  box.left >= frame.left - 1 &&
                  box.top >= frame.top - 1 &&
                  box.right <= frame.right + 1 &&
                  box.bottom <= frame.bottom + 1,
                copyBelowPhoto: copy.y >= frame.bottom - 1,
                noExcessSlideSpace: leftover >= -3 && leftover <= 6,
                windowMatchesActiveSlide: Math.abs(window.height - slide.height) <= 4,
              };
            }),
          )
          .toEqual({
            horizontalSpaceBounded: true,
            verticalSpaceBounded: true,
            imageWithinFrame: true,
            copyBelowPhoto: true,
            noExcessSlideSpace: true,
            windowMatchesActiveSlide: true,
          });
        await fit(page);
        if (slideIndex === 0 || slideIndex === 2) {
          await banner.evaluate((element) => element.scrollIntoView({ block: 'start' }));
          await banner.screenshot({
            path: info.outputPath(
              `${filled ? 'filled' : 'empty'}-mobile-${width}-poster-${slideIndex}.png`,
            ),
            animations: 'disabled',
          });
        }
      }
    }
  });
}

test('an empty catalog leaves no promotional gap and still uses the desktop right cart', async ({
  page,
}) => {
  const payload = state(false);
  payload.products = [];
  await mock(page, payload);
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/guest');
    await expect(page.locator('.guest-menu-promotions')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Thực đơn đang được cập nhật', exact: true }),
    ).toBeVisible();
    const cart = page.locator('.cart-sidebar');
    if (width >= 1024) {
      await expect(cart).toBeVisible();
      const menuBox = await page.locator('.menu-layout > section').boundingBox();
      const cartBox = await cart.boundingBox();
      expect(cartBox!.x).toBeGreaterThan(menuBox!.x + menuBox!.width + 10);
    } else await expect(cart).not.toBeVisible();
    await fit(page);
  }
});
