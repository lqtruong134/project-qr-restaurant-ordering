import { readMenuImage, menuImageDimensions, validateMenuImageUrl } from './menu-images.js';
import { menuPromotionMedia } from './menu-media.js';
import {
  matchesMenuPromotion,
  type MenuPromotion,
  type MenuPromotionComponent,
} from '@thesis/contracts';
import type { Database } from './index.js';

type Queryable = Pick<Database['pool'], 'query'>;
type Values = Record<string, unknown>;
export class MenuPromotionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const positiveInteger = (value: unknown, minimum = 0, maximum = 1000): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new MenuPromotionError('Kiểm tra lại thứ tự hoặc phiên bản ảnh giới thiệu.');
  return value;
};
const optionalText = (value: unknown, previous: string | null, maximum: number): string | null => {
  if (value === undefined) return previous;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maximum)
    throw new MenuPromotionError(`Nội dung không được vượt quá ${maximum} ký tự.`);
  return value.trim() || null;
};
const price = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{1,12}$/.test(String(value)))
    throw new MenuPromotionError('Nhập giá ghi trên ảnh bằng số nguyên không âm.');
  return BigInt(String(value)).toString();
};
const productQuery = `SELECT p.id,p.code,p.name,p.base_price::text,p.product_kind,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',child.id,'code',child.code,'name',child.name,'quantity',ci.quantity) ORDER BY ci.sort_order,ci.id)
    FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id WHERE ci.combo_product_id=p.id),'[]'::jsonb) AS components
  FROM product p WHERE p.id=$1 AND p.restaurant_id=$2`;

export function productPromotionField(alias = 'p'): string {
  return `(SELECT jsonb_build_object('id',mp.id,'product_id',mp.product_id,'image_url',mp.image_url,'image_width',mp.image_width,'image_height',mp.image_height,'presentation',mp.presentation,'eyebrow',mp.eyebrow,'image_note',mp.image_note,'expected_price',mp.expected_price::text,'expected_components',mp.expected_components,'sort_order',mp.sort_order,'is_active',mp.is_active,'version',mp.version)
    FROM menu_promotion mp WHERE mp.product_id=${alias}.id AND mp.restaurant_id=${alias}.restaurant_id AND mp.image_url=${alias}.image_url)`;
}

export async function listMenuPromotions(
  c: Queryable,
  restaurant: string,
  activeOnly = false,
): Promise<MenuPromotion[]> {
  const rows = (
    await c.query(
      `SELECT mp.*,mp.expected_price::text,p.code AS product_code,p.name AS product_name,p.base_price::text AS current_price,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',child.id,'code',child.code,'name',child.name,'quantity',ci.quantity) ORDER BY ci.sort_order,ci.id)
      FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id WHERE ci.combo_product_id=p.id),'[]'::jsonb) AS current_components
    FROM menu_promotion mp JOIN product p ON p.id=mp.product_id AND p.restaurant_id=mp.restaurant_id
    WHERE mp.restaurant_id=$1 AND NOT mp.is_deleted ${activeOnly ? 'AND mp.is_active' : ''} ORDER BY mp.sort_order,mp.created_at,mp.id`,
      [restaurant],
    )
  ).rows;
  return rows.map(
    ({ current_price, current_components, ...row }) =>
      ({
        ...row,
        matches_current_menu: matchesMenuPromotion(
          { id: row.product_id, base_price: current_price, components: current_components },
          row,
        ),
      }) as MenuPromotion,
  );
}

/** Shared domain validation for administrative forms and initial installation. */
export async function saveMenuPromotion(
  c: Queryable,
  restaurant: string,
  values: Values,
  previous?: MenuPromotion,
): Promise<MenuPromotion> {
  if (
    !previous &&
    typeof values.productId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values.productId)
  ) {
    const existing = (
      await c.query(
        'SELECT *,expected_price::text FROM menu_promotion WHERE restaurant_id=$1 AND product_id=$2 FOR UPDATE',
        [restaurant, values.productId],
      )
    ).rows[0];
    if (existing) {
      if (!existing.is_deleted)
        throw new MenuPromotionError('Món này đã có ảnh giới thiệu. Chọn Sửa để cập nhật.', 409);
      previous = existing as MenuPromotion;
      values = { ...values, version: existing.version, refreshChecks: true };
    }
  }
  if (previous && positiveInteger(values.version, 1, 2147483646) !== previous.version)
    throw new MenuPromotionError(
      'Ảnh giới thiệu đã được người khác cập nhật. Vui lòng tải lại.',
      409,
    );
  const productId = values.productId ?? previous?.product_id;
  if (
    typeof productId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(productId)
  )
    throw new MenuPromotionError('Chọn món cần giới thiệu.');
  const product = (await c.query(productQuery + ' FOR SHARE OF p', [productId, restaurant]))
    .rows[0];
  if (!product) throw new MenuPromotionError('Món không thuộc thực đơn của nhà hàng.');
  const imageUrl = await validateMenuImageUrl(
    values.imageUrl === undefined ? previous?.image_url : values.imageUrl,
  );
  if (!imageUrl) throw new MenuPromotionError('Chọn hoặc tải ảnh giới thiệu trước khi lưu.');
  const image = await readMenuImage(imageUrl.split('/').pop()!);
  const dimensions = menuImageDimensions(image.bytes);
  const presentation = values.presentation ?? previous?.presentation ?? 'PHOTO';
  if (presentation !== 'PHOTO' && presentation !== 'POSTER')
    throw new MenuPromotionError('Chọn ảnh món hoặc ảnh có sẵn chữ.');
  const expectedPrice =
    values.expectedPrice === undefined
      ? (previous?.expected_price ?? null)
      : price(values.expectedPrice);
  if (
    expectedPrice !== null &&
    expectedPrice !== product.base_price &&
    (!previous ||
      values.expectedPrice !== undefined ||
      values.refreshChecks === true ||
      previous.image_url !== imageUrl ||
      previous.product_id !== productId)
  )
    throw new MenuPromotionError(
      'Giá ghi trên ảnh khác giá bán hiện tại. Cập nhật ảnh hoặc giá đối chiếu trước khi lưu.',
    );
  const recapture =
    !previous ||
    previous.product_id !== productId ||
    previous.image_url !== imageUrl ||
    values.refreshChecks === true;
  const components: MenuPromotionComponent[] = recapture
    ? product.product_kind === 'COMBO'
      ? product.components
      : []
    : (previous?.expected_components ?? []);
  if (
    product.product_kind === 'COMBO' &&
    recapture &&
    (components.length < 2 || components.length > 20)
  )
    throw new MenuPromotionError(
      'Hoàn thiện các món thành phần của combo trước khi thêm ảnh giới thiệu.',
    );
  const isActive = values.isActive ?? previous?.is_active ?? true;
  if (typeof isActive !== 'boolean')
    throw new MenuPromotionError('Trạng thái ảnh phải là hiện hoặc ẩn.');
  const eyebrow = optionalText(values.eyebrow, previous?.eyebrow ?? null, 80);
  const imageNote = optionalText(values.imageNote, previous?.image_note ?? null, 300);
  const sortOrder = positiveInteger(values.sortOrder ?? previous?.sort_order ?? 0);
  const params = [
    restaurant,
    productId,
    imageUrl,
    dimensions.width,
    dimensions.height,
    presentation,
    eyebrow,
    imageNote,
    expectedPrice,
    JSON.stringify(components),
    sortOrder,
    isActive,
  ];
  const row = previous
    ? (
        await c.query(
          `UPDATE menu_promotion SET product_id=$2,image_url=$3,image_width=$4,image_height=$5,presentation=$6,eyebrow=$7,image_note=$8,expected_price=$9,expected_components=$10::jsonb,sort_order=$11,is_active=$12,is_deleted=false,version=version+1 WHERE restaurant_id=$1 AND id=$13 RETURNING *,expected_price::text`,
          [...params, previous.id],
        )
      ).rows[0]
    : (
        await c.query(
          `INSERT INTO menu_promotion(restaurant_id,product_id,image_url,image_width,image_height,presentation,eyebrow,image_note,expected_price,expected_components,sort_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING *,expected_price::text`,
          params,
        )
      ).rows[0];
  return row as MenuPromotion;
}

/** Missing defaults only. Edited, hidden or removed data is not overwritten by a routine seed. */
export async function seedMenuPromotions(db: Database, restaurant: string) {
  const defaults = [
    { code: 'CHINH-11', eyebrow: 'Món mới', expectedPrice: '18000' },
    { code: 'NUONG-09', eyebrow: 'Món mới từ bếp' },
    {
      code: 'COMBO-05',
      eyebrow: 'Set cơm đủ vị',
      expectedPrice: '69000',
      imageNote: 'Set có cả gà, thịt và trứng; cơm và các phần ăn kèm được liệt kê bên dưới.',
    },
    { code: 'COMBO-04', eyebrow: 'Combo đặc biệt' },
  ];
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    for (const [index, definition] of defaults.entries()) {
      const product = (
        await c.query('SELECT id FROM product WHERE restaurant_id=$1 AND code=$2', [
          restaurant,
          definition.code,
        ])
      ).rows[0];
      if (
        !product ||
        (
          await c.query('SELECT id FROM menu_promotion WHERE restaurant_id=$1 AND product_id=$2', [
            restaurant,
            product.id,
          ])
        ).rowCount
      )
        continue;
      await saveMenuPromotion(c, restaurant, {
        productId: product.id,
        imageUrl: menuPromotionMedia[definition.code],
        presentation: 'POSTER',
        eyebrow: definition.eyebrow,
        imageNote: definition.imageNote,
        expectedPrice: definition.expectedPrice ?? null,
        sortOrder: index,
        refreshChecks: true,
      });
    }
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
