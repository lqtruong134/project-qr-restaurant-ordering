export type MenuPromotionComponent = {
  product_id: string;
  code: string;
  name: string;
  quantity: number;
};
export type MenuPromotion = {
  id: string;
  product_id: string;
  image_url: string;
  image_width: number;
  image_height: number;
  presentation: 'PHOTO' | 'POSTER';
  eyebrow: string | null;
  image_note: string | null;
  expected_price: string | null;
  expected_components: MenuPromotionComponent[];
  sort_order: number;
  is_active: boolean;
  version: number;
  product_code?: string;
  product_name?: string;
  matches_current_menu?: boolean;
};
export type PromotionProduct = {
  id?: string;
  code?: string;
  base_price?: string;
  components?: { product_id: string; code: string; name?: string; quantity: number }[];
};

/** Printed promises remain hidden until the manager updates them to match the current menu. */
export function matchesMenuPromotion(
  product: PromotionProduct,
  promotion: Pick<MenuPromotion, 'product_id' | 'expected_price' | 'expected_components'>,
): boolean {
  if (product.id && product.id !== promotion.product_id) return false;
  if (promotion.expected_price !== null && String(product.base_price) !== promotion.expected_price)
    return false;
  if (promotion.expected_components.length) {
    const actual = product.components ?? [];
    if (
      actual.length !== promotion.expected_components.length ||
      promotion.expected_components.some(
        (expected) =>
          !actual.some(
            (component) =>
              component.product_id === expected.product_id &&
              component.quantity === expected.quantity &&
              (!expected.name || component.name === expected.name),
          ),
      )
    )
      return false;
  }
  return true;
}
