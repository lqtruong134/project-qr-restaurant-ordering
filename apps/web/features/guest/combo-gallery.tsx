import { media } from '../../lib/media';
import type { Product } from '../shared/components';
import { DishImage } from '../shared/dish-image';
import { comboPoster, safeProductImage } from './menu-promotions';

export function ComboGallery({ product, eager = false }: { product: Product; eager?: boolean }) {
  const poster = comboPoster(product);
  const image = safeProductImage(product);
  if (image !== media.dishPlaceholder)
    return (
      <div className="guest-combo-poster">
        <DishImage
          code={product.code}
          name={product.name}
          url={image}
          poster={Boolean(poster)}
          eager={eager}
        />
      </div>
    );
  const items = product.components?.slice(0, 3) ?? [];
  if (!items.length)
    return (
      <DishImage
        code={product.code}
        name={product.name}
        url={safeProductImage(product)}
        eager={eager}
      />
    );
  return (
    <div
      className="guest-combo-gallery"
      data-count={items.length}
      aria-label={'Các món trong ' + product.name}
    >
      {items.map((item) => (
        <figure key={item.product_id}>
          <DishImage
            code={item.code}
            name={item.name}
            url={safeProductImage({
              id: item.product_id,
              image_promotion: item.image_promotion,
              code: item.code,
              image_url: item.image_url,
              base_price: item.unit_price,
            })}
            eager={eager}
          />
          <figcaption>
            {item.quantity} × {item.name}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
