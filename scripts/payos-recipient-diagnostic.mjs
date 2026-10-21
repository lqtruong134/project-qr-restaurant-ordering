import { pathToFileURL } from 'node:url';

// Stream this file into the existing API container. No server, worker, refresh,
// create/cancel API, environment-file loader, or payment mutation is imported.
class DiagnosticFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function parseTarget(args) {
  if (
    args.length !== 4 ||
    args[0] !== '--table' ||
    !/^[A-Z0-9-]{1,20}$/.test(args[1]) ||
    args[2] !== '--session' ||
    !/^[A-Fa-f0-9]{8}$/.test(args[3])
  )
    throw new DiagnosticFailure('INVALID_TARGET');
  return { table: args[1], session: args[3].toUpperCase() };
}
const money = (value) => (/^(0|[1-9][0-9]{0,11})$/.test(String(value)) ? String(value) : null);
const state = (value) =>
  [
    'CREATE_PENDING',
    'CREATED',
    'PENDING',
    'PROCESSING',
    'UNDERPAID',
    'PAID',
    'SUCCEEDED',
    'REQUIRES_RECONCILIATION',
    'ERROR',
    'FAILED',
    'EXPIRED',
    'CANCEL_PENDING',
    'CANCELLED',
    'OPEN',
    'RESOLVED',
    'RECEIVED',
    'REJECTED',
    'UNMATCHED',
    'PROCESSED',
  ].includes(value)
    ? value
    : value == null
      ? null
      : 'UNKNOWN';
function field(value, normalize) {
  const normalized = normalize(value);
  return {
    type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    present: normalized !== null,
    normalizedLength: normalized?.length ?? 0,
    trimmed: typeof value === 'string' && normalized !== null && normalized !== value,
  };
}
function equal(left, right, normalize) {
  const a = normalize(left),
    b = normalize(right);
  return a !== null && b !== null ? a === b : null;
}
// Read just the domestic VietQR recipient subfield (38 / 01 / 01).
// This is a consistency hint, NOT signature/CRC validation or a new trust anchor.
export function qrAccount(qr) {
  function tag(value, wanted) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    for (let offset = 0; offset < value.length;) {
      const header = value.slice(offset, offset + 4);
      if (!/^[0-9]{4}$/.test(header)) return null;
      const length = Number(header.slice(2)),
        end = offset + 4 + length;
      if (end > value.length) return null;
      if (header.slice(0, 2) === wanted) return value.slice(offset + 4, end);
      offset = end;
    }
    return null;
  }
  return tag(tag(tag(qr, '38'), '01'), '01');
}
export function recipientReport(expected, bank, proof, normalization) {
  const {
    normalizePayosAccount: normalize,
    recipientMatches,
    sameRecipient,
    recipientMatchesWithEvidence,
  } = normalization;
  const matched = recipientMatchesWithEvidence(expected, bank, proof);
  let decision = 'MATCH';
  if (!normalize(expected)) decision = 'MISSING_CREATE_ANCHOR';
  else if (proof && normalize(proof.virtualAccountNumber) && !recipientMatches(expected, proof))
    decision = 'WEBHOOK_EXPLICIT_VA_DIFFERS_FROM_CREATE';
  else if (recipientMatches(expected, bank))
    decision = !proof || sameRecipient(bank, proof) ? 'MATCH' : 'GET_WEBHOOK_RECIPIENTS_DIFFER';
  else if (normalize(bank.virtualAccountNumber)) decision = 'GET_EXPLICIT_VA_DIFFERS_FROM_CREATE';
  else if (!proof) decision = 'GET_PRIMARY_DIFFERS_NO_ELIGIBLE_WEBHOOK';
  else if (!normalize(bank.accountNumber)) decision = 'GET_PRIMARY_MISSING';
  else if (normalize(bank.accountNumber) !== normalize(proof.accountNumber))
    decision = 'GET_WEBHOOK_PRIMARY_ACCOUNTS_DIFFER';
  else if (!recipientMatches(expected, proof)) decision = 'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE';
  else decision = 'MATCH_VIA_VERIFIED_WEBHOOK';
  return {
    matched,
    decision,
    getAccount: field(bank.accountNumber, normalize),
    getVirtualAccount: field(bank.virtualAccountNumber, normalize),
    webhookAccount: field(proof?.accountNumber, normalize),
    webhookVirtualAccount: field(proof?.virtualAccountNumber, normalize),
    equals: {
      create_getAccount: equal(expected, bank.accountNumber, normalize),
      create_getVirtual: equal(expected, bank.virtualAccountNumber, normalize),
      create_webhookAccount: equal(expected, proof?.accountNumber, normalize),
      create_webhookVirtual: equal(expected, proof?.virtualAccountNumber, normalize),
      getAccount_webhookAccount: equal(bank.accountNumber, proof?.accountNumber, normalize),
      getVirtual_webhookVirtual: equal(
        bank.virtualAccountNumber,
        proof?.virtualAccountNumber,
        normalize,
      ),
    },
  };
}
export function proofChecks(event, row, bank, link, restaurant) {
  const p = event.payload_snapshot ?? {};
  return {
    signaturePreviouslyVerified: event.signature_valid === true,
    referenceMatches: event.provider_event_id === bank.reference,
    restaurantMatches: p.restaurantId === restaurant,
    orderMatches: String(p.orderCode) === String(row.order_code),
    linkMatches: p.paymentLinkId === link.id,
    currencyVnd: p.currency === 'VND',
    successCode: p.code === '00',
    evidenceVersion2: String(p.recipientEvidenceVersion) === '2',
    amountMatches: String(p.amount) === String(bank.amount),
  };
}
export async function diagnose({ pool, get, normalization }, target, restaurant) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const sessions = (
      await client.query(
        `SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id
       WHERE t.restaurant_id=$1 AND t.code=$2 AND upper(left(s.id::text,8))=$3 LIMIT 2`,
        [restaurant, target.table, target.session],
      )
    ).rows;
    if (sessions.length !== 1)
      throw new DiagnosticFailure(sessions.length ? 'AMBIGUOUS_SESSION' : 'SESSION_NOT_FOUND');
    const rows = (
      await client.query(
        `SELECT q.order_code::text,q.payment_link_id,q.account_number,q.qr_code,
         q.status,q.provider_status,q.paid_amount::text,q.reconciliation_status,
         p.amount::text,p.status AS intent_status,
         COALESCE((SELECT sum(t.amount) FROM payment_transaction t
           WHERE t.payment_intent_id=p.id AND t.provider='PAYOS' AND t.status='SUCCEEDED'),0)::text AS recorded,
         COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount) FROM payment_allocation a
           JOIN payment_transaction t ON t.id=a.payment_transaction_id
           JOIN financial_charge c ON c.id=a.financial_charge_id
           WHERE t.payment_intent_id=p.id AND t.provider='PAYOS'
             AND t.status='SUCCEEDED' AND c.status='ACTIVE'),0)::text AS applied
       FROM payment_intent p JOIN payos_payment_request q ON q.payment_intent_id=p.id
       WHERE p.session_id=$1 ORDER BY q.created_at,q.id LIMIT 11`,
        [sessions[0].id],
      )
    ).rows;
    if (!rows.length || rows.length > 10)
      throw new DiagnosticFailure('REQUEST_COUNT_OUT_OF_BOUNDS');
    const requests = [];
    for (const row of rows) {
      const order = Number(row.order_code);
      if (!Number.isSafeInteger(order) || order <= 0)
        throw new DiagnosticFailure('INVALID_ORDER_CODE');
      // ONLY provider GET: official adapter verifies response HMAC before returning.
      const link = await get(order);
      if (!Array.isArray(link.transactions) || link.transactions.length > 100)
        throw new DiagnosticFailure('INVALID_TRANSACTION_LIST');
      const events = (
        await client.query(
          `SELECT provider_event_id,signature_valid,processing_status,payload_snapshot
         FROM payment_webhook_event WHERE provider='PAYOS'
           AND (payload_snapshot->>'orderCode'=$1 OR provider_event_id=ANY($2::text[]))
         ORDER BY received_at,id LIMIT 101`,
          [row.order_code, link.transactions.map((bank) => bank.reference)],
        )
      ).rows;
      if (events.length > 100) throw new DiagnosticFailure('WEBHOOK_COUNT_OUT_OF_BOUNDS');
      const normalize = normalization.normalizePayosAccount;
      const qr = qrAccount(row.qr_code);
      const transactions = link.transactions.map((bank, index) => {
        const candidates = events.map((event, i) => {
          const checks = proofChecks(event, row, bank, link, restaurant);
          const p = event.payload_snapshot ?? {};
          return {
            event: i + 1,
            eligible: Object.values(checks).every(Boolean),
            checks,
            processingStatus: state(event.processing_status),
            account: field(p.recipientAccountNumber, normalize),
            virtualAccount: field(p.recipientVirtualAccountNumber, normalize),
            equals: {
              create_account: equal(row.account_number, p.recipientAccountNumber, normalize),
              create_virtual: equal(row.account_number, p.recipientVirtualAccountNumber, normalize),
              getAccount_account: equal(bank.accountNumber, p.recipientAccountNumber, normalize),
              getVirtual_virtual: equal(
                bank.virtualAccountNumber,
                p.recipientVirtualAccountNumber,
                normalize,
              ),
            },
          };
        });
        // Same eligibility and iteration order as applyLink; never treat a
        // rejected/legacy/foreign-order proof as corroboration.
        let proof;
        for (let i = 0; i < events.length; i++) {
          if (candidates[i].eligible) {
            const p = events[i].payload_snapshot;
            proof = {
              accountNumber: p.recipientAccountNumber,
              virtualAccountNumber: p.recipientVirtualAccountNumber,
            };
          }
        }
        return {
          transaction: index + 1,
          amount: money(bank.amount),
          recipient: recipientReport(row.account_number, bank, proof, normalization),
          webhookCandidates: candidates,
        };
      });
      const amounts = link.transactions.map((bank) => money(bank.amount));
      const sum = amounts.every((value) => value !== null)
        ? amounts.reduce((total, value) => total + BigInt(value), 0n)
        : null;
      const amount = money(link.amount),
        paid = money(link.amountPaid);
      requests.push({
        request: requests.length + 1,
        stored: {
          status: state(row.status),
          intentStatus: state(row.intent_status),
          providerStatus: state(row.provider_status),
          reported: money(row.paid_amount),
          requested: money(row.amount),
          recorded: money(row.recorded),
          applied: money(row.applied),
          reconciliation: state(row.reconciliation_status),
        },
        createAccount: field(row.account_number, normalize),
        qr: {
          recipientParsed: qr !== null,
          createMatchesQrAccount: equal(row.account_number, qr, normalize),
        },
        get: {
          signatureVerifiedByRuntimeAdapter: true,
          status: state(link.status),
          amount,
          amountPaid: paid,
          amountRemaining: money(link.amountRemaining),
          checks: {
            orderMatches: link.orderCode === order,
            linkMatches: !!row.payment_link_id && row.payment_link_id === link.id,
            amountMatches: amount !== null && amount === money(row.amount),
            transactionSumMatches: sum !== null && paid !== null && sum === BigInt(paid),
            remainingMatches:
              sum !== null &&
              amount !== null &&
              money(link.amountRemaining) ===
                String(BigInt(amount) > sum ? BigInt(amount) - sum : 0n),
            positiveTransactions: link.transactions.every(
              (bank) =>
                typeof bank.amount === 'number' &&
                Number.isSafeInteger(bank.amount) &&
                bank.amount > 0,
            ),
            uniqueReferences:
              link.transactions.every(
                (bank) => typeof bank.reference === 'string' && bank.reference.trim().length > 0,
              ) &&
              new Set(link.transactions.map((bank) => bank.reference)).size ===
                link.transactions.length,
          },
        },
        transactions,
      });
    }
    return {
      format: 'payos-recipient-diagnostic-v1',
      target,
      readOnly: true,
      note: 'Comparisons only; no account values, QR, references, IDs, names or credentials. Stored webhook signature flag is historical, not a fresh re-verification. No payment was changed.',
      requests,
    };
  } finally {
    try {
      if (started) await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
export async function runDiagnostic(args, runtime, output) {
  try {
    const target = parseTarget(args);
    const { pool, get, normalization, restaurant, close } = await runtime();
    try {
      output.log(
        JSON.stringify(await diagnose({ pool, get, normalization }, target, restaurant), null, 2),
      );
    } finally {
      await close();
    }
    return 0;
  } catch (error) {
    // Never serialize exceptions: SDK/SQL errors can contain request headers,
    // full bank data, connection strings or personal information.
    const allowed = [
      'INVALID_TARGET',
      'AMBIGUOUS_SESSION',
      'SESSION_NOT_FOUND',
      'INVALID_ORDER_CODE',
      'REQUEST_COUNT_OUT_OF_BOUNDS',
      'INVALID_TRANSACTION_LIST',
      'WEBHOOK_COUNT_OUT_OF_BOUNDS',
      'RUNTIME_NOT_CONFIGURED',
    ];
    output.error(
      JSON.stringify({
        format: 'payos-recipient-diagnostic-v1',
        error:
          error instanceof DiagnosticFailure && allowed.includes(error.code)
            ? error.code
            : 'READ_OR_SIGNED_GET_FAILED',
        detail: 'No raw error is printed. No payment was changed.',
      }),
    );
    return 1;
  }
}
if (
  process.argv[1] === '-' ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  process.exitCode = await runDiagnostic(
    process.argv.slice(2),
    async () => {
      const root = process.cwd();
      const adapter = await import(
        pathToFileURL(root + '/src/modules/payments/payos-adapter.ts').href
      );
      const normalization = await import(
        pathToFileURL(root + '/src/modules/payments/payos-normalization.ts').href
      );
      const { createDatabase } = await import('@thesis/database');
      const config = adapter.readPayosConfig();
      if (
        !process.env.DATABASE_URL ||
        !process.env.RESTAURANT_ID ||
        !adapter.payosCapabilities(config).online
      )
        throw new DiagnosticFailure('RUNTIME_NOT_CONFIGURED');
      const db = createDatabase(process.env.DATABASE_URL);
      const provider = adapter.officialPayosProvider(config);
      return {
        pool: db.pool,
        get: (order) => provider.get(order),
        normalization,
        restaurant: process.env.RESTAURANT_ID,
        close: () => db.close(),
      };
    },
    console,
  );
}
