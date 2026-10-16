import { matchesMenuPromotion, type MenuPromotion } from '@thesis/contracts';
import { dishImage, media } from '../../lib/media';
import { vnd, type Product } from '../shared/components';
import type { MarketingSlide } from '../shared/marketing-carousel';

type PromotionProduct = Pick<Product, 'code'> &
  Partial<Pick<Product, 'id' | 'base_price' | 'components' | 'image_url' | 'image_promotion'>>;
export const matchesPromotion = matchesMenuPromotion;

export function safeProductImage(product: PromotionProduct): string {
  const source = dishImage(product.image_url),
    promotion = product.image_promotion;
  return promotion && source === promotion.image_url && !matchesMenuPromotion(product, promotion)
    ? media.dishPlaceholder
    : source;
}

export function comboPoster(product: Product): string | undefined {
  const promotion = product.image_promotion;
  if (
    product.product_kind !== 'COMBO' ||
    promotion?.presentation !== 'POSTER' ||
    product.image_url !== promotion.image_url ||
    !matchesMenuPromotion(product, promotion)
  )
    return undefined;
  return promotion.image_url;
}

export function menuSlides(
  products: Product[],
  promotions: MenuPromotion[] = [],
): MarketingSlide[] {
  return [...promotions]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((promotion) => {
      if (!promotion.is_active) return [];
      const product = products.find(
        (item) =>
          item.id === promotion.product_id &&
          item.is_active &&
          item.availability_status === 'AVAILABLE' &&
          matchesMenuPromotion(item, promotion),
      );
      if (!product) return [];
      return [
        {
          id: promotion.id,
          target: product.id,
          image: promotion.image_url,
          imageWidth: promotion.image_width,
          imageHeight: promotion.image_height,
          presentation: promotion.presentation === 'POSTER' ? 'poster' : undefined,
          alt: product.name,
          imageNote: promotion.image_note ?? undefined,
          eyebrow:
            promotion.eyebrow ??
            (product.product_kind === 'COMBO' ? 'Combo trọn bữa' : 'Gợi ý từ bếp'),
          title: product.name,
          description: [
            product.product_kind === 'COMBO' && product.components?.length
              ? product.components.map((item) => `${item.quantity} × ${item.name}`).join(' + ')
              : String(product.description ?? ''),
            vnd(product.base_price) + (product.product_kind === 'COMBO' ? ' / combo' : ' / phần'),
          ]
            .filter(Boolean)
            .join(' - '),
          actionLabel: product.product_kind === 'COMBO' ? 'Xem combo' : 'Chọn món này',
        },
      ];
    });
}
