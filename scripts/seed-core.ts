import { createDatabase } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { transaction, one } from '../apps/api/src/modules/core/common.js';
const db = createDatabase(process.env.DATABASE_URL!);
try {
  await seed(db, process.env.SEED_PASSWORD!);
  await transaction(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(450045)');
    const actor = await one(
      c,
      "SELECT id FROM app_user WHERE restaurant_id=$1 AND username='admin'",
      [restaurantId],
    );
    const unit = await one(
      c,
      "INSERT INTO unit_of_measure(code,name,dimension,decimal_scale) VALUES('KG','Kilogram','MASS',6) ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code RETURNING id",
    );
    const location = await one(
      c,
      "INSERT INTO stock_location(restaurant_id,code,name) VALUES($1,'KHO-BEP','Kho bếp') ON CONFLICT(restaurant_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id",
      [restaurantId],
    );
    const ingredients: Record<string, string> = {};
    for (const [code, name, cost] of [
      ['GAO', 'Gạo', '20000'],
      ['GA', 'Thịt gà', '90000'],
      ['BO', 'Thịt bò', '200000'],
      ['HEO', 'Thịt heo', '100000'],
      ['BANH-PHO', 'Bánh phở', '25000'],
      ['BUN', 'Bún', '20000'],
    ] as const) {
      const i = await one(
        c,
        'INSERT INTO ingredient(restaurant_id,code,name,base_unit_id,min_stock) VALUES($1,$2,$3,$4,2) ON CONFLICT(restaurant_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id',
        [restaurantId, code, name, unit.id],
      );
      ingredients[code] = i.id;
      const existing = await c.query(
        'SELECT id FROM inventory_balance WHERE location_id=$1 AND ingredient_id=$2',
        [location.id, i.id],
      );
      if (!existing.rowCount) {
        await c.query(
          'INSERT INTO inventory_balance(location_id,ingredient_id,on_hand_qty,reserved_qty,available_qty,avg_cost) VALUES($1,$2,50,0,50,$3)',
          [location.id, i.id, cost],
        );
        await c.query(
          "INSERT INTO inventory_movement(location_id,ingredient_id,movement_type,quantity,unit_cost,value,source_type,created_by) VALUES($1,$2,'ADJUSTMENT_IN',50,$3,50*$3::numeric,'MANUAL',$4)",
          [location.id, i.id, cost, actor.id],
        );
      }
    }
    for (const [code, lines] of [
      [
        'COM-GA',
        [
          ['GAO', '0.15'],
          ['GA', '0.2'],
        ],
      ],
      [
        'PHO-BO',
        [
          ['BANH-PHO', '0.2'],
          ['BO', '0.15'],
        ],
      ],
      [
        'BUN-CHA',
        [
          ['BUN', '0.2'],
          ['HEO', '0.15'],
        ],
      ],
    ] as const) {
      const product = await one(c, 'SELECT id FROM product WHERE restaurant_id=$1 AND code=$2', [
        restaurantId,
        code,
      ]);
      if ((await c.query('SELECT id FROM recipe_bom WHERE product_id=$1', [product.id])).rowCount)
        continue;
      const bom = await one(
        c,
        "INSERT INTO recipe_bom(product_id,version_no,yield_quantity,status) VALUES($1,1,1,'ACTIVE') RETURNING id",
        [product.id],
      );
      for (const [ingredient, qty] of lines)
        await c.query(
          'INSERT INTO recipe_bom_item(recipe_bom_id,ingredient_id,quantity,waste_percent) VALUES($1,$2,$3,0)',
          [bom.id, ingredients[ingredient], qty],
        );
    }
  });
  console.log(
    'CORE demo ready: accounts preserved, 3 recipes and opening stock available. Issue a table QR from Admin to begin.',
  );
} finally {
  await db.close();
}
