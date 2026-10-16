import { vnd, type Product } from '../shared/components';
import { DishImage } from '../shared/dish-image';
import { Icon } from '../shared/primitives';
import { ComboContents } from './combo-contents';
import { ComboGallery } from './combo-gallery';
import { safeProductImage } from './menu-promotions';

export function MenuCard({
  product: p,
  select,
}: {
  product: Product;
  select: (p: Product) => void;
}) {
  const combo = p.product_kind === 'COMBO';
  const unavailable = p.availability_status !== 'AVAILABLE';
  const savings = combo && p.regular_price ? BigInt(p.regular_price) - BigInt(p.base_price) : 0n;
  return (
    <article
      className={
        'dish-card' + (combo ? ' combo-card' : '') + (unavailable ? ' dish-unavailable' : '')
      }
    >
      <div className="dish-visual">
        {combo ? (
          <ComboGallery product={p} />
        ) : (
          <DishImage
            code={p.code}
            name={p.name}
            url={safeProductImage(p)}
            poster={p.image_promotion?.presentation === 'POSTER'}
          />
        )}
        <span className="guest-dish-tag">
          {combo ? 'Combo' : String(p.category_name ?? 'Món Việt')}
        </span>
      </div>
      <div className="dish-content">
        <h3>{p.name}</h3>
        {combo ? (
          <ComboContents components={p.components} compact />
        ) : (
          <p>{String(p.description ?? '')}</p>
        )}
        <div className="dish-bottom">
          <div className="guest-dish-prices">
            {savings > 0n && (
              <del aria-label={'Giá món lẻ ' + vnd(p.regular_price)}>{vnd(p.regular_price)}</del>
            )}
            <strong>
              {vnd(p.base_price)}
              {combo && <small> / combo</small>}
            </strong>
            {savings > 0n && <small className="combo-saving">Tiết kiệm {vnd(savings)}</small>}
          </div>
          {!unavailable ? (
            <button aria-label={'Chọn ' + p.name} onClick={() => select(p)}>
              <Icon name="plus" size={18} />
              <span>{combo ? 'Xem combo' : 'Chọn món'}</span>
            </button>
          ) : (
            <small>Tạm hết {combo ? 'combo' : 'món'}</small>
          )}
        </div>
      </div>
    </article>
  );
}
