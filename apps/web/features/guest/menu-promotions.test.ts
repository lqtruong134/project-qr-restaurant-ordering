import { describe, expect, it } from 'vitest';
import type { MenuPromotion } from '@thesis/contracts';
import type { Product } from '../shared/components';
import { comboPoster, menuSlides, safeProductImage } from './menu-promotions';
import { media } from '../../lib/media';

const image = '/api/menu-images/12345678-1234-4234-8234-123456789abc.webp';
const dish = (): Product => ({
  id: 'rice',
  code: 'MON-TU-THEM',
  name: 'Cơm nắm bò xốt tiêu đen',
  base_price: '18000',
  version: 1,
  is_active: true,
  availability_status: 'AVAILABLE',
  product_kind: 'DISH',
  image_url: image,
});
const poster = (product = dish()): MenuPromotion => ({
  id: 'promotion',
  product_id: product.id,
  image_url: image,
  image_width: 820,
  image_height: 1024,
  presentation: 'POSTER',
  expected_price: product.base_price,
  expected_components: product.components?.map((c) => ({ ...c })) ?? [],
  eyebrow: 'Món mới từ bếp',
  image_note: null,
  sort_order: 0,
  is_active: true,
  version: 1,
});
const combo = (): Product => ({
  ...dish(),
  id: 'combo',
  code: 'COMBO-TU-THEM',
  name: 'Combo cuốn & trà',
  base_price: '149000',
  product_kind: 'COMBO',
  components: [
    { product_id: 'roll', code: 'CUON', name: 'Gỏi cuốn tôm thịt', quantity: 2 },
    { product_id: 'tea', code: 'TRA', name: 'Trà tắc mật ong', quantity: 2 },
  ],
});

describe('database-owned menu promotion promises', () => {
  it('links a configured poster to any real product without a fixed code list', () => {
    expect(menuSlides([dish()], [poster()])[0]).toMatchObject({
      target: 'rice',
      title: 'Cơm nắm bò xốt tiêu đen',
      presentation: 'poster',
      image,
    });
    expect(menuSlides([dish()])).toEqual([]);
  });
  it('hides a poster when the printed price differs, it is disabled or the dish cannot be ordered', () => {
    expect(menuSlides([{ ...dish(), base_price: '20000' }], [poster()])).toEqual([]);
    expect(menuSlides([{ ...dish(), availability_status: 'UNAVAILABLE' }], [poster()])).toEqual([]);
    expect(menuSlides([{ ...dish(), is_active: false }], [poster()])).toEqual([]);
    expect(menuSlides([dish()], [{ ...poster(), is_active: false }])).toEqual([]);
    expect(menuSlides([], [poster()])).toEqual([]);
  });
  it('hides a combo poster after its ingredients, portions or printed names change at the same price', () => {
    const original = combo(),
      promotion = poster(original);
    expect(menuSlides([original], [promotion])).toHaveLength(1);
    expect(
      menuSlides([{ ...original, components: original.components!.slice(0, 1) }], [promotion]),
    ).toEqual([]);
    expect(
      menuSlides(
        [{ ...original, components: original.components!.map((c) => ({ ...c, quantity: 3 })) }],
        [promotion],
      ),
    ).toEqual([]);
    expect(
      menuSlides(
        [
          {
            ...original,
            components: original.components!.map((c) => ({ ...c, name: 'Tên món mới' })),
          },
        ],
        [promotion],
      ),
    ).toEqual([]);
    expect(
      menuSlides(
        [
          {
            ...original,
            components: [
              ...original.components!,
              { product_id: 'extra', code: 'NUOC', name: 'Nước sâm', quantity: 1 },
            ],
          },
        ],
        [promotion],
      ),
    ).toEqual([]);
  });
  it('does not reuse an advertised photograph after a pictured component is removed from a combo', () => {
    const product = combo(),
      promotion = poster(product);
    expect(
      menuSlides([{ ...product, components: product.components!.slice(1) }], [promotion]),
    ).toEqual([]);
    expect(menuSlides([product], [promotion])[0]?.description).toContain('Gỏi cuốn tôm thịt');
  });
  it('uses a matching combo poster in cards even when sold out and stops using it after an edit', () => {
    const product = combo();
    product.image_promotion = poster(product);
    expect(comboPoster({ ...product, availability_status: 'UNAVAILABLE' })).toBe(image);
    expect(comboPoster({ ...product, base_price: '159000' })).toBeUndefined();
    expect(
      comboPoster({
        ...product,
        image_url: '/api/menu-images/22345678-1234-4234-8234-123456789abc.webp',
      }),
    ).toBeUndefined();
    expect(comboPoster({ ...product, image_url: null })).toBeUndefined();
  });
  it('prevents a stale printed promise from surviving in card/detail photos and respects a separate uploaded photo', () => {
    const product = dish();
    product.image_promotion = poster(product);
    expect(safeProductImage({ ...product, base_price: '20000' })).toBe(media.dishPlaceholder);
    const uploaded = '/api/menu-images/22345678-1234-4234-8234-123456789abc.webp';
    expect(safeProductImage({ ...product, base_price: '20000', image_url: uploaded })).toBe(
      uploaded,
    );
    expect(safeProductImage({ ...product, image_url: null })).toBe(media.dishPlaceholder);
    const bundle = combo();
    bundle.image_promotion = poster(bundle);
    expect(safeProductImage({ ...bundle, components: [] })).toBe(media.dishPlaceholder);
  });
  it('follows the order edited by admin and uses live names and prices as HTML text', () => {
    const first = dish(),
      second = {
        ...dish(),
        id: 'other',
        code: 'NEW',
        name: 'Món mới của nhà hàng',
        base_price: '25000',
      };
    const slides = menuSlides(
      [first, second],
      [
        { ...poster(first), id: 'later', sort_order: 5 },
        {
          ...poster(second),
          id: 'first',
          sort_order: 1,
          expected_price: null,
          presentation: 'PHOTO',
        },
      ],
    );
    expect(slides.map((s) => s.id)).toEqual(['first', 'later']);
    expect(slides[0]).toMatchObject({ target: 'other', title: 'Món mới của nhà hàng' });
    expect(slides[0]?.description).toContain('25.000 đ');
  });
});
