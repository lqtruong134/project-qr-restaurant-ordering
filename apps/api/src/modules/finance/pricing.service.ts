import { resolveVatRate } from './tax-classification.js';
import type {
  BillingSummary,
  DiscountOffer,
  DiscountProgram,
  PromotionView,
  TaxPolicy,
  TaxSettings,
} from '@thesis/contracts';
import {
  allocateDiscount,
  allocateMoney,
  inclusiveVat,
  promotionDiscount,
  summarizeBilling,
  type ChargeBillingRow,
} from './billing-math.js';
import {
  integer,
  money,
  one,
  reject,
  text,
  uuid,
  type Actor,
  type Connection,
} from '../shared/core-persistence.js';

type ProgramRow = Record<string, unknown>;
type ChargeRow = ChargeBillingRow & {
  product_id: string | null;
  category_id: string | null;
  product_kind_snapshot: string | null;
};
const iso = (value: unknown) =>
  new Date(value instanceof Date ? value : String(value)).toISOString();
const programQuery = `SELECT p.*,
 ARRAY(SELECT x.name FROM product x WHERE x.id=ANY(p.product_ids) ORDER BY x.name) AS product_names,
 ARRAY(SELECT x.name FROM menu_category x WHERE x.id=ANY(p.category_ids) ORDER BY x.name) AS category_names, (SELECT count(*)::int FROM session_promotion x WHERE x.program_id=p.id AND x.status='USED') AS used_count,
 (SELECT count(*)::int FROM session_promotion x WHERE x.program_id=p.id AND x.status='RESERVED' AND x.expires_at>now()) AS reserved_count FROM discount_program p`;
export function programView(row: ProgramRow): DiscountProgram {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    mode: row.mode as DiscountProgram['mode'],
    code: row.code as string | null,
    type: row.discount_type as DiscountProgram['type'],
    percent: row.percent as number | null,
    fixedAmount: row.fixed_amount as string | null,
    minEligibleAmount: String(row.min_eligible_amount),
    maxDiscountAmount: row.max_discount_amount as string | null,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    weekdays: row.weekdays as number[],
    startTime: row.start_time as string | null,
    endTime: row.end_time as string | null,
    scope: row.scope as DiscountProgram['scope'],
    productNames: (row.product_names as string[] | undefined) ?? [],
    categoryNames: (row.category_names as string[] | undefined) ?? [],
    productIds: row.product_ids as string[],
    categoryIds: row.category_ids as string[],
    excludeCombos: Boolean(row.exclude_combos),
    usageLimit: row.usage_limit as number | null,
    status: row.status as DiscountProgram['status'],
    version: Number(row.version),
    usedCount: Number(row.used_count ?? 0),
    reservedCount: Number(row.reserved_count ?? 0),
    createdAt: iso(row.created_at),
  };
}
export async function listDiscountPrograms(c: Connection, restaurant: string) {
  return (
    await c.query(programQuery + ' WHERE p.restaurant_id=$1 ORDER BY p.created_at DESC,p.id', [
      restaurant,
    ])
  ).rows.map(programView);
}
function validDate(value: unknown) {
  const raw = text(value, 40),
    date = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(date.getTime()))
    reject('Ngày giờ cần có múi giờ hợp lệ.', 400);
  return date.toISOString();
}
const nullableMoney = (value: unknown) => (value == null || value === '' ? null : money(value));
export function discountInput(b: Record<string, unknown>) {
  const name = text(b.name, 120),
    description = b.description == null ? '' : String(b.description).trim();
  if (description.length > 500) reject('Mô tả tối đa 500 ký tự.', 400);
  const mode = String(b.mode),
    type = String(b.type),
    scope = String(b.scope ?? 'ALL'),
    status = String(b.status ?? 'ACTIVE');
  if (
    !['AUTO', 'CODE'].includes(mode) ||
    !['PERCENT', 'FIXED'].includes(type) ||
    !['ALL', 'PRODUCTS', 'CATEGORIES'].includes(scope) ||
    !['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status)
  )
    reject('Chọn loại chương trình hợp lệ.', 400);
  const code = mode === 'CODE' ? text(b.code, 32).toUpperCase() : null;
  if (code && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code))
    reject('Mã gồm 3–32 chữ, số, dấu gạch ngang hoặc gạch dưới.', 400);
  const percent = type === 'PERCENT' ? integer(b.percent, 1, 50) : null;
  const fixedAmount = type === 'FIXED' ? money(b.fixedAmount) : null;
  if (type === 'FIXED' && b.maxDiscountAmount != null && b.maxDiscountAmount !== '')
    reject('Mức giảm tối đa chỉ dùng cho chương trình giảm theo phần trăm.', 400);
  const minEligibleAmount = money(b.minEligibleAmount ?? '0', true),
    maxDiscountAmount = nullableMoney(b.maxDiscountAmount);
  if (
    fixedAmount &&
    (BigInt(minEligibleAmount) === 0n || BigInt(fixedAmount) * 2n > BigInt(minEligibleAmount))
  )
    reject('Giảm tiền cố định cần ngưỡng tiền món tối thiểu ít nhất gấp đôi mức giảm.', 400);
  const startsAt = validDate(b.startsAt),
    endsAt = validDate(b.endsAt);
  if (new Date(endsAt) <= new Date(startsAt)) reject('Ngày kết thúc phải sau ngày bắt đầu.', 400);
  const weekdays = b.weekdays ?? [];
  if (
    !Array.isArray(weekdays) ||
    weekdays.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 6) ||
    new Set(weekdays).size !== weekdays.length
  )
    reject('Ngày trong tuần không hợp lệ.', 400);
  const startTime = b.startTime == null || b.startTime === '' ? null : String(b.startTime),
    endTime = b.endTime == null || b.endTime === '' ? null : String(b.endTime);
  const time = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
  if (
    (startTime === null) !== (endTime === null) ||
    (startTime && (!time.test(startTime) || !time.test(endTime!) || endTime! <= startTime))
  )
    reject('Khung giờ phải nằm trong cùng ngày và giờ kết thúc sau giờ bắt đầu.', 400);
  const ids = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 200)
      reject('Phạm vi khuyến mãi không hợp lệ.', 400);
    const values = value.map(uuid);
    if (new Set(values).size !== values.length) reject('Phạm vi bị lặp.', 400);
    return values;
  };
  const productIds = scope === 'PRODUCTS' ? ids(b.productIds) : [],
    categoryIds = scope === 'CATEGORIES' ? ids(b.categoryIds) : [];
  if (
    (scope === 'PRODUCTS' && !productIds.length) ||
    (scope === 'CATEGORIES' && !categoryIds.length)
  )
    reject('Chọn ít nhất một món hoặc nhóm món.', 400);
  if (b.excludeCombos === false)
    reject('Combo đã có giá riêng; khuyến mãi cơ bản không giảm thêm combo.', 400);
  if (b.excludeCombos !== undefined && typeof b.excludeCombos !== 'boolean')
    reject('Cấu hình combo không hợp lệ.', 400);
  const usageLimit =
    b.usageLimit == null || b.usageLimit === '' ? null : integer(b.usageLimit, 1, 1000000);
  return {
    name,
    description,
    mode,
    code,
    type,
    percent,
    fixedAmount,
    minEligibleAmount,
    maxDiscountAmount,
    startsAt,
    endsAt,
    weekdays,
    startTime,
    endTime,
    scope,
    productIds,
    categoryIds,
    excludeCombos: b.excludeCombos !== false,
    usageLimit,
    status,
  };
}
export async function saveDiscountProgram(
  c: Connection,
  restaurant: string,
  actor: string,
  b: Record<string, unknown>,
  id?: string,
) {
  const input = discountInput(b);
  const old = id
    ? await one(c, 'SELECT * FROM discount_program WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [
        id,
        restaurant,
      ])
    : null;
  if (old && old.version !== integer(b.version, 1, 2147483646))
    reject('Chương trình đã thay đổi. Vui lòng tải lại.');
  if (old?.status === 'ARCHIVED') reject('Chương trình đã lưu trữ; hãy tạo chương trình mới.');
  if (input.usageLimit !== null && old) {
    const used = await one(
      c,
      "SELECT count(*)::int AS n FROM session_promotion WHERE program_id=$1 AND (status='USED' OR (status='RESERVED' AND expires_at>now()))",
      [id],
    );
    if (input.usageLimit < used.n)
      reject('Giới hạn lượt không được thấp hơn số lượt đã dùng và đang giữ.');
  }
  const values = [
    restaurant,
    input.name,
    input.description,
    input.mode,
    input.code,
    input.type,
    input.percent,
    input.fixedAmount,
    input.minEligibleAmount,
    input.maxDiscountAmount,
    input.startsAt,
    input.endsAt,
    input.weekdays,
    input.startTime,
    input.endTime,
    input.scope,
    input.productIds,
    input.categoryIds,
    input.excludeCombos,
    input.usageLimit,
    input.status,
    actor,
  ];
  const row = old
    ? await one(
        c,
        `UPDATE discount_program SET name=$2,description=$3,mode=$4,code=$5,discount_type=$6,percent=$7,fixed_amount=$8,min_eligible_amount=$9,max_discount_amount=$10,starts_at=$11,ends_at=$12,weekdays=$13,start_time=$14,end_time=$15,scope=$16,product_ids=$17,category_ids=$18,exclude_combos=$19,usage_limit=$20,status=$21,version=version+1 WHERE restaurant_id=$1 AND id=$22 RETURNING *`,
        [...values.slice(0, 21), id],
      )
    : await one(
        c,
        `INSERT INTO discount_program(restaurant_id,name,description,mode,code,discount_type,percent,fixed_amount,min_eligible_amount,max_discount_amount,starts_at,ends_at,weekdays,start_time,end_time,scope,product_ids,category_ids,exclude_combos,usage_limit,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        values,
      );
  await c.query(
    `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,$3,'DISCOUNT_PROGRAM',$4,$5,$6)`,
    [
      restaurant,
      actor,
      old ? 'DISCOUNT_PROGRAM_UPDATED' : 'DISCOUNT_PROGRAM_CREATED',
      row.id,
      input.name,
      JSON.stringify({ version: row.version, snapshot: programView(row) }),
    ],
  );
  return programView(row);
}

export async function ensureTaxPolicies(c: Connection, restaurant: string) {
  if (
    (
      await c.query('SELECT id FROM restaurant_tax_policy WHERE restaurant_id=$1 LIMIT 1', [
        restaurant,
      ])
    ).rowCount
  )
    return;
  await one(c, 'SELECT id FROM restaurant WHERE id=$1 FOR UPDATE', [restaurant]);
  await c.query(
    `INSERT INTO restaurant_tax_policy(restaurant_id,effective_at,default_rate_percent,version,reason)
    SELECT $1,now(),CASE WHEN now()<'2027-01-01T00:00:00+07'::timestamptz THEN 8 ELSE 10 END,1,'Giá thực đơn đã gồm VAT; cấu hình mặc định cho món mới.' WHERE NOT EXISTS(SELECT 1 FROM restaurant_tax_policy WHERE restaurant_id=$1)`,
    [restaurant],
  );
  await c.query(
    `INSERT INTO restaurant_tax_policy(restaurant_id,effective_at,default_rate_percent,version,reason)
    SELECT $1,'2027-01-01T00:00:00+07',10,2,'Kết thúc thời hạn giảm VAT 8%; mức thông thường 10% từ ngày 01/01/2027.' WHERE now()<'2027-01-01T00:00:00+07'::timestamptz AND NOT EXISTS(SELECT 1 FROM restaurant_tax_policy WHERE restaurant_id=$1 AND effective_at='2027-01-01T00:00:00+07'::timestamptz) AND NOT EXISTS(SELECT 1 FROM restaurant_tax_policy WHERE restaurant_id=$1 AND version>=2)`,
    [restaurant],
  );
}
const taxPolicyView = (row: ProgramRow): TaxPolicy => ({
  id: String(row.id),
  effectiveAt: iso(row.effective_at),
  defaultRatePercent: Number(row.default_rate_percent) as TaxPolicy['defaultRatePercent'],
  version: Number(row.version),
  reason: String(row.reason),
  createdAt: iso(row.created_at),
});
export async function readTaxSettings(c: Connection, restaurant: string): Promise<TaxSettings> {
  await ensureTaxPolicies(c, restaurant);
  const policies = (
    await c.query(
      'SELECT * FROM restaurant_tax_policy WHERE restaurant_id=$1 ORDER BY effective_at DESC,version DESC',
      [restaurant],
    )
  ).rows.map(taxPolicyView);
  return {
    priceIncludesVat: true,
    policies,
    current: policies.find((x) => new Date(x.effectiveAt).getTime() <= Date.now()) ?? null,
    products: (
      await c.query(
        'SELECT id,code,name,tax_treatment AS treatment,vat_rate_percent AS "ratePercent",version FROM product WHERE restaurant_id=$1 AND is_active ORDER BY code',
        [restaurant],
      )
    ).rows,
  };
}
export async function createTaxPolicy(
  c: Connection,
  restaurant: string,
  actor: string,
  b: Record<string, unknown>,
) {
  await ensureTaxPolicies(c, restaurant);
  await one(c, 'SELECT id FROM restaurant WHERE id=$1 FOR UPDATE', [restaurant]);
  const effectiveAt = validDate(b.effectiveAt),
    rate = integer(b.defaultRatePercent, 0, 10),
    reason = text(b.reason, 500);
  if (![0, 5, 8, 10].includes(rate) || reason.length < 5)
    reject('Chọn mức VAT và nhập lý do tối thiểu 5 ký tự.', 400);
  const now = await one(c, 'SELECT now() AS at');
  if (new Date(effectiveAt).getTime() < new Date(now.at).getTime() + 60000)
    reject(
      'Chính sách mới cần hiệu lực trong tương lai, ít nhất một phút. Không sửa VAT của món đã gọi.',
      400,
    );
  const row = await one(
    c,
    `INSERT INTO restaurant_tax_policy(restaurant_id,effective_at,default_rate_percent,version,reason,created_by) SELECT $1,$2,$3,COALESCE(max(version),0)+1,$4,$5 FROM restaurant_tax_policy WHERE restaurant_id=$1 RETURNING *`,
    [restaurant, effectiveAt, rate, reason, actor],
  );
  await c.query(
    `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'TAX_POLICY_CREATED','RESTAURANT_TAX_POLICY',$3,$4,$5)`,
    [restaurant, actor, row.id, reason, JSON.stringify(taxPolicyView(row))],
  );
  return taxPolicyView(row);
}
export async function productTaxSnapshot(
  c: Connection,
  restaurant: string,
  product: Record<string, unknown>,
) {
  await ensureTaxPolicies(c, restaurant);
  const policy = await one(
    c,
    'SELECT * FROM restaurant_tax_policy WHERE restaurant_id=$1 AND effective_at<=now() ORDER BY effective_at DESC,version DESC LIMIT 1',
    [restaurant],
  );
  const classification = resolveVatRate(product, policy, new Date());
  return {
    version: 1,
    priceIncludesVat: true,
    ...classification,
    policyId: policy.id,
    policyVersion: policy.version,
    categoryId: product.category_id,
    productVersion: product.version,
    capturedAt: new Date().toISOString(),
  };
}

function matches(program: DiscountProgram, row: ChargeRow) {
  return (
    row.product_id !== null &&
    !(program.excludeCombos && row.product_kind_snapshot === 'COMBO') &&
    (program.scope === 'ALL' ||
      (program.scope === 'PRODUCTS' && program.productIds.includes(row.product_id ?? '')) ||
      (program.scope === 'CATEGORIES' && program.categoryIds.includes(row.category_id ?? '')))
  );
}
export function offerFor(
  program: DiscountProgram,
  rows: ChargeRow[],
  now: Date,
  timezone: string,
  quotaAvailable = true,
): DiscountOffer {
  const eligible = rows
    .filter((row) => matches(program, row))
    .reduce((n, row) => n + BigInt(row.amount), 0n);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (name: string) => local.find((x) => x.type === name)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')),
    time = part('hour') + ':' + part('minute');
  let reason: string | null = null;
  if (program.status !== 'ACTIVE')
    reason =
      program.status === 'ARCHIVED' ? 'Chương trình đã lưu trữ.' : 'Chương trình đang tạm dừng.';
  else if (now.getTime() < new Date(program.startsAt).getTime())
    reason = 'Chương trình chưa bắt đầu.';
  else if (now.getTime() >= new Date(program.endsAt).getTime()) reason = 'Chương trình đã hết hạn.';
  else if (program.weekdays.length && !program.weekdays.includes(day))
    reason = 'Hôm nay không thuộc ngày áp dụng.';
  else if (program.startTime && (time < program.startTime || time >= program.endTime!))
    reason = 'Chưa thuộc khung giờ áp dụng.';
  else if (!quotaAvailable) reason = 'Chương trình đã hết lượt sử dụng.';
  else if (eligible === 0n)
    reason = program.excludeCombos
      ? 'Chưa có món đủ điều kiện. Combo không áp dụng ưu đãi này.'
      : 'Chưa có món đủ điều kiện.';
  else if (eligible < BigInt(program.minEligibleAmount))
    reason =
      'Còn thiếu ' +
      (BigInt(program.minEligibleAmount) - eligible).toLocaleString('vi-VN') +
      ' đ tiền món đủ điều kiện' +
      (program.excludeCombos ? ' (không gồm combo).' : '.');
  let discount = reason ? 0n : promotionDiscount(program, eligible);
  const capacity = rows
    .filter((row) => matches(program, row))
    .reduce((n, row) => n + BigInt(row.amount) / 2n, 0n);
  if (discount > capacity) {
    if (program.type === 'FIXED') {
      reason = 'Giá các món không đủ để phân bổ mức giảm cố định trong giới hạn 50% mỗi món.';
      discount = 0n;
    } else discount = capacity;
  }
  return {
    ...program,
    eligible: reason === null && discount > 0n,
    eligibleAmount: eligible.toString(),
    discountAmount: discount.toString(),
    reason,
  };
}
export async function sessionPricingLock(c: Connection, sid: string) {
  return one(
    c,
    `SELECT EXISTS(SELECT 1 FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED') AS paid,
  EXISTS(SELECT 1 FROM payment_intent p WHERE p.session_id=$1 AND ((p.status IN ('CREATED','PENDING') AND (p.expires_at>now() OR p.provider='PAYOS')) OR (p.provider='PAYOS' AND EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id AND (q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING') OR q.reconciliation_status='OPEN') AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED'))))) AS pending`,
    [sid],
  );
}
async function activeCharges(c: Connection, sid: string): Promise<ChargeRow[]> {
  return (
    await c.query(
      `SELECT f.*,i.product_id,COALESCE((i.tax_snapshot->>'categoryId')::uuid,p.category_id) AS category_id,i.product_kind_snapshot FROM financial_charge f LEFT JOIN order_item i ON i.id=f.order_item_id LEFT JOIN product p ON p.id=i.product_id WHERE f.session_id=$1 AND f.status='ACTIVE' ORDER BY f.id FOR UPDATE OF f`,
      [sid],
    )
  ).rows;
}
async function updateChargePricing(c: Connection, rows: ChargeRow[], offer: DiscountOffer | null) {
  const eligible = offer ? rows.filter((row) => matches(offer, row)) : [];
  const discounts = allocateDiscount(
    BigInt(offer?.discountAmount ?? '0'),
    eligible.map((row) => ({ id: row.id, amount: BigInt(row.amount) })),
  );
  const groups = new Map<string, ChargeRow[]>();
  for (const row of rows) {
    if (!row.tax_snapshot) continue;
    const key = row.tax_snapshot.treatment + ':' + row.tax_snapshot.ratePercent;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const taxes = new Map<string, bigint>();
  for (const group of groups.values()) {
    const rate =
      group[0]!.tax_snapshot!.treatment === 'EXEMPT'
        ? 0
        : Number(group[0]!.tax_snapshot!.ratePercent);
    const nets = group.map((row) => ({
      id: row.id,
      amount: BigInt(row.amount) - (discounts.get(row.id) ?? 0n),
    }));
    const vat = inclusiveVat(
      nets.reduce((n, row) => n + row.amount, 0n),
      rate,
    );
    for (const [id, value] of allocateMoney(vat, nets)) taxes.set(id, value);
  }
  for (const row of rows) {
    const discount = discounts.get(row.id) ?? 0n,
      promotion =
        discount > 0n && offer
          ? { id: offer.id, name: offer.name, code: offer.code, version: offer.version }
          : null,
      tax = taxes.get(row.id)?.toString() ?? null;
    if (
      String(row.discount_amount ?? '0') === discount.toString() &&
      JSON.stringify(row.promotion_snapshot) === JSON.stringify(promotion) &&
      (row.tax_amount ?? null) === tax
    )
      continue;
    await c.query(
      'UPDATE financial_charge SET discount_amount=$2,promotion_snapshot=$3::jsonb,tax_amount=$4 WHERE id=$1',
      [row.id, discount.toString(), promotion ? JSON.stringify(promotion) : null, tax],
    );
  }
}

export async function refreshSessionPricing(c: Connection, sid: string) {
  const s = await one(
    c,
    'SELECT s.*,t.restaurant_id,r.timezone,now() AS pricing_now FROM table_session s JOIN dining_table t ON t.id=s.table_id JOIN restaurant r ON r.id=t.restaurant_id WHERE s.id=$1 FOR UPDATE OF s',
    [sid],
  );
  if (s.session_status !== 'ACTIVE') return;
  const lock = await sessionPricingLock(c, sid);
  if (lock.paid || lock.pending) return;
  const selected = (await c.query('SELECT * FROM session_promotion WHERE session_id=$1', [sid]))
    .rows[0];
  if (selected?.status === 'USED') return;
  // All program locks use UUID order to avoid two sessions reserving different offers in reverse order.
  await c.query('SELECT id FROM discount_program WHERE restaurant_id=$1 ORDER BY id FOR UPDATE', [
    s.restaurant_id,
  ]);
  const rows = await activeCharges(c, sid);
  const programs = await listDiscountPrograms(c, s.restaurant_id);
  const offers: DiscountOffer[] = [];
  for (const program of programs) {
    const other = await one(
      c,
      `SELECT count(*)::int AS n FROM session_promotion WHERE program_id=$1 AND session_id<>$2 AND (status='USED' OR (status='RESERVED' AND expires_at>now()))`,
      [program.id, sid],
    );
    offers.push(
      offerFor(
        program,
        rows,
        new Date(s.pricing_now),
        s.timezone,
        program.usageLimit === null || other.n < program.usageLimit,
      ),
    );
  }
  let chosen: DiscountOffer | null = null;
  if (selected?.status !== 'REMOVED') {
    if (selected?.explicit_selection)
      chosen = offers.find((x) => x.id === selected.program_id) ?? null;
    else
      chosen =
        offers
          .filter((x) => x.mode === 'AUTO' && x.eligible)
          .sort((a, b) =>
            BigInt(a.discountAmount) === BigInt(b.discountAmount)
              ? a.id.localeCompare(b.id)
              : BigInt(a.discountAmount) > BigInt(b.discountAmount)
                ? -1
                : 1,
          )[0] ?? null;
  }
  const applied = chosen?.eligible ? chosen : null;
  await updateChargePricing(c, rows, applied);
  if (chosen) {
    await c.query(
      `INSERT INTO session_promotion(session_id,program_id,status,explicit_selection,program_snapshot,eligible_amount,discount_amount,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $3='RESERVED' THEN now()+interval '30 minutes' END)
    ON CONFLICT(session_id) DO UPDATE SET program_id=EXCLUDED.program_id,status=EXCLUDED.status,program_snapshot=EXCLUDED.program_snapshot,eligible_amount=EXCLUDED.eligible_amount,discount_amount=EXCLUDED.discount_amount,expires_at=EXCLUDED.expires_at`,
      [
        sid,
        chosen.id,
        applied ? 'RESERVED' : 'SELECTED',
        Boolean(selected?.explicit_selection),
        JSON.stringify(chosen),
        chosen.eligibleAmount,
        applied?.discountAmount ?? '0',
      ],
    );
  } else if (selected && selected.status !== 'REMOVED') {
    await c.query(
      "UPDATE session_promotion SET status='SELECTED',discount_amount=0,eligible_amount=0,expires_at=NULL WHERE session_id=$1",
      [sid],
    );
  }
}
export async function readBillingSummary(c: Connection, sid: string): Promise<BillingSummary> {
  const rows = await activeCharges(c, sid),
    lock = await sessionPricingLock(c, sid);
  const selected = (
    await c.query("SELECT * FROM session_promotion WHERE session_id=$1 AND status<>'REMOVED'", [
      sid,
    ])
  ).rows[0];
  const snapshot = selected?.program_snapshot as DiscountOffer | undefined;
  const promotion = snapshot
    ? {
        id: String(selected.program_id),
        name: snapshot.name,
        code: snapshot.code,
        status: selected.status,
        locked: Boolean(lock.paid || lock.pending || selected.status === 'USED'),
        eligibleAmount: lock.paid
          ? rows
              .filter((row) => row.promotion_snapshot?.id === snapshot.id)
              .reduce((n, row) => n + BigInt(row.amount), 0n)
              .toString()
          : String(selected.eligible_amount),
        discountAmount: rows
          .reduce((n, row) => n + BigInt(row.discount_amount ?? '0'), 0n)
          .toString(),
        reason: lock.paid ? null : (snapshot.reason ?? null),
      }
    : null;
  return summarizeBilling(rows, promotion);
}
export async function readPromotionView(
  c: Connection,
  sid: string,
  restaurant: string,
): Promise<PromotionView> {
  await refreshSessionPricing(c, sid);
  const s = await one(
    c,
    'SELECT r.timezone,now() AS pricing_now FROM table_session s JOIN dining_table t ON t.id=s.table_id JOIN restaurant r ON r.id=t.restaurant_id WHERE s.id=$1 AND r.id=$2',
    [sid, restaurant],
  );
  const rows = await activeCharges(c, sid),
    selected = (await c.query('SELECT * FROM session_promotion WHERE session_id=$1', [sid]))
      .rows[0],
    lock = await sessionPricingLock(c, sid);
  const programs = (await listDiscountPrograms(c, restaurant)).filter(
    (x) => x.status !== 'ARCHIVED',
  );
  const offers = [];
  for (const program of programs) {
    const other = await one(
      c,
      `SELECT count(*)::int AS n FROM session_promotion WHERE program_id=$1 AND session_id<>$2 AND (status='USED' OR (status='RESERVED' AND expires_at>now()))`,
      [program.id, sid],
    );
    const offer = offerFor(
      program,
      rows,
      new Date(s.pricing_now),
      s.timezone,
      program.usageLimit === null || other.n < program.usageLimit,
    );
    offers.push({
      ...offer,
      eligible: offer.eligible && !lock.paid && !lock.pending,
      reason: lock.paid
        ? 'Ưu đãi đã chốt khi thu tiền; món gọi thêm tính riêng.'
        : lock.pending
          ? 'Đang có yêu cầu thu tiền. Hủy yêu cầu trước khi đổi ưu đãi.'
          : offer.reason,
    });
  }
  void selected;
  return {
    billing: await readBillingSummary(c, sid),
    programs: offers,
    locked: Boolean(lock.paid || lock.pending),
  };
}
export async function selectPromotion(
  c: Connection,
  sid: string,
  restaurant: string,
  actor: Actor,
  b: Record<string, unknown>,
  remove = false,
) {
  const lock = await sessionPricingLock(c, sid);
  if (lock.paid || lock.pending)
    reject(
      lock.paid
        ? 'Không thể thay ưu đãi sau khi đã thu tiền.'
        : 'Hủy yêu cầu thanh toán đang chờ trước khi đổi ưu đãi.',
    );
  let program: DiscountProgram | null = null;
  if (!remove) {
    if ((b.code == null) === (b.programId == null))
      reject('Chọn chương trình hoặc nhập một mã khuyến mãi.', 400);
    await c.query('SELECT id FROM discount_program WHERE restaurant_id=$1 ORDER BY id FOR UPDATE', [
      restaurant,
    ]);
    const all = await listDiscountPrograms(c, restaurant);
    if (b.code != null) {
      const code = text(b.code, 32).toUpperCase();
      program = all.find((x) => x.mode === 'CODE' && x.code === code) ?? null;
    } else program = all.find((x) => x.id === uuid(b.programId)) ?? null;
    if (!program) reject('Không tìm thấy mã hoặc chương trình khuyến mãi.', 404);
    if (actor.type === 'GUEST' && program.mode === 'CODE' && b.code == null)
      reject('Vui lòng nhập mã để áp dụng chương trình này.', 400);
    await one(c, 'SELECT id FROM discount_program WHERE id=$1 FOR UPDATE', [program.id]);
    const s = await one(c, 'SELECT r.timezone,now() AS pricing_now FROM restaurant r WHERE id=$1', [
      restaurant,
    ]);
    const other = await one(
      c,
      `SELECT count(*)::int AS n FROM session_promotion WHERE program_id=$1 AND session_id<>$2 AND (status='USED' OR (status='RESERVED' AND expires_at>now()))`,
      [program.id, sid],
    );
    const offer = offerFor(
      program,
      await activeCharges(c, sid),
      new Date(s.pricing_now),
      s.timezone,
      program.usageLimit === null || other.n < program.usageLimit,
    );
    if (!offer.eligible) reject(offer.reason ?? 'Chương trình chưa đủ điều kiện.');
  }
  await c.query(
    `INSERT INTO session_promotion(session_id,program_id,status,explicit_selection,program_snapshot) VALUES($1,$2,$3,true,$4::jsonb)
    ON CONFLICT(session_id) DO UPDATE SET program_id=EXCLUDED.program_id,status=EXCLUDED.status,explicit_selection=true,program_snapshot=EXCLUDED.program_snapshot,eligible_amount=0,discount_amount=0,expires_at=NULL`,
    [
      sid,
      program?.id ?? null,
      remove ? 'REMOVED' : 'SELECTED',
      program ? JSON.stringify(program) : null,
    ],
  );
  if (actor.type === 'USER')
    await c.query(
      `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,$3,'TABLE_SESSION',$4,$5,$6)`,
      [
        restaurant,
        actor.type === 'USER' ? actor.id : null,
        remove ? 'PROMOTION_REMOVED' : 'PROMOTION_SELECTED',
        sid,
        remove ? 'Bỏ ưu đãi trước thanh toán' : program!.name,
        JSON.stringify({
          programId: program?.id ?? null,
          actorType: actor.type,
          participantId: null,
        }),
      ],
    );
  return readPromotionView(c, sid, restaurant);
}
export async function reservePromotionForIntent(c: Connection, sid: string, expiresAt: unknown) {
  await c.query(
    "UPDATE session_promotion SET expires_at=greatest(expires_at,$2::timestamptz) WHERE session_id=$1 AND status='RESERVED'",
    [sid, expiresAt],
  );
}
export async function consumePromotion(c: Connection, sid: string) {
  const selected = (
    await c.query("SELECT * FROM session_promotion WHERE session_id=$1 AND status='RESERVED'", [
      sid,
    ])
  ).rows[0];
  if (!selected) return;
  await one(c, 'SELECT id FROM discount_program WHERE id=$1 FOR UPDATE', [selected.program_id]);
  await c.query(
    "UPDATE session_promotion SET status='USED',locked_at=now(),expires_at=NULL WHERE session_id=$1 AND status='RESERVED'",
    [sid],
  );
}
