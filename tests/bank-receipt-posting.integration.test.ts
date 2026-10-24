import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { one, session, transaction } from '../apps/api/src/modules/shared/core-persistence.js';
import {
  bankReceiverDigest,
  lockBankReferences,
  postPayosReceipt,
} from '../apps/api/src/modules/payments/bank-receipt-posting.js';

const databaseName = 'thesis_bank_receipts_' + randomBytes(6).toString('hex');
const receiverDigest = bankReceiverDigest('970422', '1234567890');
let host: Database, db: Database;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('Bank receipt tests require an explicit isolated local PostgreSQL host.');
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const name of readdirSync('packages/database/prisma/migrations')
    .filter((x) => /^\d/.test(x))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + name + '/migration.sql', 'utf8'),
    );
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_bank_receipts_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);
async function fixture(quote = '10000', bill = '20000') {
  return transaction(db, async (c) => {
    const restaurant = await one(
      c,
      `INSERT INTO restaurant(name) VALUES('Isolated receipt fixture') RETURNING id`,
    );
    const area = await one(
      c,
      `INSERT INTO dining_area(restaurant_id,code,name) VALUES($1,'LAB','Lab') RETURNING id`,
      [restaurant.id],
    );
    const table = await one(
      c,
      `INSERT INTO dining_table(restaurant_id,area_id,code,name,capacity) VALUES($1,$2,'A1','Lab',4) RETURNING id`,
      [restaurant.id, area.id],
    );
    const s = await one(c, `INSERT INTO table_session(table_id) VALUES($1) RETURNING id`, [
      table.id,
    ]);
    await c.query(
      `INSERT INTO financial_charge(session_id,charge_type,amount) VALUES($1,'ADJUSTMENT',$2)`,
      [s.id, bill],
    );
    const pi = await one(
      c,
      `INSERT INTO payment_intent(session_id,method,provider,amount,client_request_id,expires_at)
      VALUES($1,'ONLINE','PAYOS',$2,$3,now()+interval '15 minutes') RETURNING *`,
      [s.id, quote, randomUUID()],
    );
    return { pi, restaurantId: restaurant.id as string };
  });
}
async function post(
  f: Awaited<ReturnType<typeof fixture>>,
  reference: string,
  amount = '10000',
  source: 'PAYOS_VERIFIED' | 'BANK_ADMIN_VERIFIED' = 'PAYOS_VERIFIED',
) {
  return transaction(db, async (c) => {
    await session(c, f.pi.session_id, f.restaurantId);
    const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [f.pi.id]);
    return postPayosReceipt(c, {
      pi,
      restaurantId: f.restaurantId,
      reference,
      amount,
      metadata: {},
      verificationSource: source,
      receiverDigest,
    });
  });
}
it('records one canonical receipt, allocation, audit and outbox across provider/admin replays', async () => {
  const f = await fixture(),
    reference = randomUUID();
  const first = await post(f, reference);
  const replay = await post(f, reference, '10000', 'BANK_ADMIN_VERIFIED');
  expect(first).toMatchObject({ created: true, appliedAmount: '10000', anomaly: false });
  expect(replay).toMatchObject({
    created: false,
    receiptId: first.receiptId,
    appliedAmount: '10000',
  });
  const counts = await db.pool.query(
    `SELECT
    (SELECT count(*)::int FROM payment_transaction WHERE payment_intent_id=$1) receipts,
    (SELECT count(*)::int FROM bank_receipt_claim WHERE payment_intent_id=$1) claims,
    (SELECT count(*)::int FROM outbox_event WHERE payment_transaction_id=$2) events,
    (SELECT count(*)::int FROM business_audit_event WHERE resource_id=$1) audits`,
    [f.pi.id, first.receiptId],
  );
  expect(counts.rows[0]).toEqual({ receipts: 1, claims: 1, events: 1, audits: 1 });
  const receipt = await db.pool.query('SELECT metadata FROM payment_transaction WHERE id=$1', [
    first.receiptId,
  ]);
  expect(receipt.rows[0].metadata.verificationSource).toBe('PAYOS_VERIFIED');
});
it('keeps excess partial payment refundable and never allocates beyond the staff quote', async () => {
  const f = await fixture();
  const result = await post(f, randomUUID(), '12000');
  expect(result).toMatchObject({ created: true, appliedAmount: '10000', anomaly: true });
  const account = await db.pool.query(
    'SELECT paid_total,outstanding_amount,refund_due_amount FROM session_financial_account WHERE session_id=$1',
    [f.pi.session_id],
  );
  expect(account.rows[0]).toEqual({
    paid_total: '12000',
    outstanding_amount: '10000',
    refund_due_amount: '2000',
  });
});
it('rejects a changed amount, intent or tenant for an existing receiver/reference', async () => {
  const f = await fixture(),
    other = await fixture(),
    reference = randomUUID();
  await post(f, reference);
  await expect(post(f, reference, '9999')).rejects.toMatchObject({ statusCode: 409 });
  await expect(post(other, reference)).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM payment_transaction WHERE payment_intent_id=$1',
        [other.pi.id],
      )
    ).rows[0].count,
  ).toBe(0);
});
it('blocks a bank reference already recorded through a manual BANK_TRANSFER route', async () => {
  const f = await fixture(),
    reference = randomUUID();
  const actor = (
    await db.pool.query(
      `INSERT INTO app_user(restaurant_id,username,password_hash,display_name)
      VALUES($1,'lab-admin','synthetic-unused-hash','Lab') RETURNING id`,
      [f.restaurantId],
    )
  ).rows[0];
  await db.pool.query(
    `INSERT INTO payment_transaction(session_id,method,amount,status,confirmed_by,confirmed_at,metadata)
    VALUES($1,'BANK_TRANSFER',10000,'SUCCEEDED',$2,now(),$3)`,
    [f.pi.session_id, actor.id, JSON.stringify({ reference })],
  );
  await expect(post(f, reference)).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM bank_receipt_claim WHERE payment_intent_id=$1',
        [f.pi.id],
      )
    ).rows[0].count,
  ).toBe(0);
});
it('serializes simultaneous claims for the same physical bank receipt across tenants', async () => {
  const a = await fixture(),
    b = await fixture(),
    reference = randomUUID();
  const results = await Promise.allSettled([post(a, reference), post(b, reference)]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM bank_receipt_claim WHERE receiver_digest=$1 AND bank_reference=$2',
        [receiverDigest, reference],
      )
    ).rows[0].count,
  ).toBe(1);
});
it('rolls back receipt, allocation, claim, outbox and audit when the caller fails', async () => {
  const f = await fixture(),
    reference = randomUUID();
  await expect(
    transaction(db, async (c) => {
      await session(c, f.pi.session_id, f.restaurantId);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [f.pi.id]);
      await postPayosReceipt(c, {
        pi,
        restaurantId: f.restaurantId,
        reference,
        amount: '10000',
        metadata: {},
        verificationSource: 'PAYOS_VERIFIED',
        receiverDigest,
      });
      throw Error('synthetic-posting-failure');
    }),
  ).rejects.toThrow('synthetic-posting-failure');
  for (const table of ['payment_transaction', 'bank_receipt_claim'])
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int count FROM ' + table + ' WHERE payment_intent_id=$1',
          [f.pi.id],
        )
      ).rows[0].count,
    ).toBe(0);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM business_audit_event WHERE resource_id=$1',
        [f.pi.id],
      )
    ).rows[0].count,
  ).toBe(0);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM payment_allocation a JOIN financial_charge f ON f.id=a.financial_charge_id WHERE f.session_id=$1',
        [f.pi.session_id],
      )
    ).rows[0].count,
  ).toBe(0);
});
it('enforces immutable canonical claim facts in PostgreSQL', async () => {
  const f = await fixture(),
    result = await post(f, randomUUID());
  await expect(
    db.pool.query('UPDATE bank_receipt_claim SET amount=9999 WHERE receipt_id=$1', [
      result.receiptId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('DELETE FROM bank_receipt_claim WHERE receipt_id=$1', [result.receiptId]),
  ).rejects.toBeDefined();
});
it('derives receiver identity from exact bank BIN/full account and rejects a suffix', () => {
  expect(bankReceiverDigest('970422', '1234567890')).toBe(receiverDigest);
  expect(bankReceiverDigest('970422', '01234567890')).not.toBe(receiverDigest);
  expect(() => bankReceiverDigest('970422', '7890')).toThrow();
});

it('preserves confirmed bank proof/preview/evidence scope and forbids rewriting historical facts', async () => {
  const f = await fixture(),
    reference = randomUUID(),
    posted = await post(f, reference, '10000', 'BANK_ADMIN_VERIFIED');
  const actor = (
    await db.pool.query(
      `INSERT INTO app_user(restaurant_id,username,password_hash,display_name)
    VALUES($1,'lab-evidence','synthetic-unused-hash','Lab') RETURNING id`,
      [f.restaurantId],
    )
  ).rows[0];
  const proof = (
    await db.pool.query(
      `INSERT INTO payment_bank_proof(restaurant_id,payment_intent_id,uploaded_by,filename,sha256,mime,byte_size)
    VALUES($1,$2,$3,$4,$5,'image/png',16) RETURNING id`,
      [f.restaurantId, f.pi.id, actor.id, randomUUID() + '.png', 'a'.repeat(64)],
    )
  ).rows[0];
  const preview = (
    await db.pool.query(
      `INSERT INTO payment_bank_preview(token_hash,restaurant_id,payment_intent_id,actor_id,proof_id,
    bank_reference,amount,bank_transaction_at,reason,snapshot,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,10000,now(),'Independent bank statement','{}',now()+interval '2 minutes') RETURNING id`,
      [randomBytes(32).toString('hex'), f.restaurantId, f.pi.id, actor.id, proof.id, reference],
    )
  ).rows[0];
  await db.pool.query(
    'UPDATE payment_bank_preview SET confirmed_at=now(),receipt_id=$2 WHERE id=$1',
    [preview.id, posted.receiptId],
  );
  const evidence = (
    await db.pool.query(
      `INSERT INTO payment_bank_evidence(preview_id,receipt_id,restaurant_id,payment_intent_id,
    actor_id,proof_id,bank_reference,amount,bank_transaction_at,receiver_digest)
    SELECT id,receipt_id,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,$2
    FROM payment_bank_preview WHERE id=$1 RETURNING id`,
      [preview.id, receiverDigest],
    )
  ).rows[0];
  await expect(
    db.pool.query('UPDATE payment_bank_proof SET sha256=$2 WHERE id=$1', [
      proof.id,
      'b'.repeat(64),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE payment_bank_preview SET confirmed_at=NULL,receipt_id=NULL WHERE id=$1', [
      preview.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.pool.query('UPDATE payment_bank_evidence SET amount=9999 WHERE id=$1', [evidence.id]),
  ).rejects.toMatchObject({ code: '23514' });
  const other = await fixture();
  await expect(
    db.pool.query(
      `INSERT INTO payment_bank_preview(token_hash,restaurant_id,payment_intent_id,actor_id,proof_id,
    bank_reference,amount,bank_transaction_at,reason,snapshot,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,10000,now(),'Wrong scope','{}',now()+interval '2 minutes')`,
      [
        randomBytes(32).toString('hex'),
        other.restaurantId,
        other.pi.id,
        actor.id,
        proof.id,
        reference,
      ],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('locks overlapping multi-receipt snapshots in one order even when provider arrays are reversed', async () => {
  const a = await fixture('20000', '40000'),
    b = await fixture('20000', '40000');
  const references = [randomUUID(), randomUUID()];
  const apply = async (f: Awaited<ReturnType<typeof fixture>>, ordered: string[]) =>
    transaction(db, async (c) => {
      await session(c, f.pi.session_id, f.restaurantId);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [f.pi.id]);
      await lockBankReferences(
        c,
        ordered.map((reference) => ({ restaurantId: f.restaurantId, reference, receiverDigest })),
      );
      for (const reference of ordered)
        await postPayosReceipt(c, {
          pi,
          restaurantId: f.restaurantId,
          reference,
          amount: '10000',
          metadata: {},
          verificationSource: 'PAYOS_VERIFIED',
          receiverDigest,
        });
    });
  const results = await Promise.allSettled([
    apply(a, references),
    apply(b, [...references].reverse()),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((x) => x.status === 'rejected');
  expect(failure?.status === 'rejected' && failure.reason).toMatchObject({ statusCode: 409 });
  expect(failure?.status === 'rejected' && failure.reason.code).not.toBe('40P01');
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int count FROM bank_receipt_claim WHERE receiver_digest=$1 AND bank_reference=ANY($2::text[])',
        [receiverDigest, references],
      )
    ).rows[0].count,
  ).toBe(2);
});
