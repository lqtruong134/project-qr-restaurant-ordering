import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseTarget } from './payos-recipient-diagnostic.mjs';

export async function hiddenAccount(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || !output.isTTY) throw Error('INTERACTIVE_TERMINAL_REQUIRED');
  output.write(
    'Mở đúng kênh payOS đang dùng, đối chiếu tài khoản MB chính với app MB.\nNhập tài khoản MB chính (không hiện ký tự; không gửi vào chat): ',
  );
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const terminal = createInterface({ input, output: muted, terminal: true, historySize: 0 });
  const controller = new AbortController();
  try {
    terminal.on('SIGINT', () => controller.abort());
    return await terminal.question('', { signal: controller.signal });
  } finally {
    terminal.close();
    muted.destroy();
    output.write('\n');
  }
}
// This function is passed as STATIC code in argv. The private account and tool
// source travel only over stdin, never argv, env, shell history or a temp file.
export async function containerComparison() {
  let db;
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 100000) throw Error();
    }
    const data = JSON.parse(input);
    if (!/^[0-9]{10}$/.test(data.account)) throw Error();
    const tool = await import(
      'data:text/javascript;base64,' + Buffer.from(data.script).toString('base64')
    );
    // Revalidate target inside the container, before opening the database.
    const target = tool.parseTarget([
      '--table',
      data.target.table,
      '--session',
      data.target.session,
    ]);
    const { pathToFileURL } = await import('node:url');
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
      throw Error();
    db = createDatabase(process.env.DATABASE_URL);
    const provider = adapter.officialPayosProvider(config);
    const report = await tool.diagnose(
      {
        pool: db.pool,
        get: (order) => provider.get(order),
        normalization,
        trustedPrimaryForRequest:
          typeof adapter.trustedPayosPrimary === 'function'
            ? (row, link, restaurant) =>
                adapter.trustedPayosPrimary(
                  config,
                  restaurant,
                  row.account_number,
                  row.qr_code,
                  row.payment_link_id,
                  link.id,
                )
            : undefined,
        compareAccount: (value) => {
          const normalized = normalization.normalizePayosAccount(value);
          return normalized === null ? null : normalized === data.account;
        },
      },
      target,
      process.env.RESTAURANT_ID,
    );
    const output = {
      format: 'payos-private-mb-comparison-v1',
      target,
      readOnly: true,
      accountInputSource: 'OPERATOR_ENTERED_LINKED_MB_ACCOUNT',
      paymentAuthorizationChanged: false,
      requests: report.requests.map((request) => ({
        signedGetVerified: request.get.signatureVerifiedByRuntimeAdapter === true,
        providerPaid: request.get.status === 'PAID',
        getChecksAllMatch: Object.values(request.get.checks).every((value) => value === true),
        createMatchesQrAccount: request.qr.createMatchesQrAccount,
        quoteExpiredNow: request.stored.quoteExpiredNow,
        cancelRequested: request.stored.cancelRequested,
        transactions: request.transactions.map((transaction) => ({
          getMatchesEnteredMb: transaction.privateAccountMatches.get,
          eligibleWebhookMatchesEnteredMb: transaction.privateAccountMatches.webhook,
          eligibleWebhookPresent: transaction.webhookCandidates.some((event) => event.eligible),
          getAndWebhookSamePrimary: transaction.recipient.equals.getAccount_webhookAccount,
          getVirtualAbsent: !transaction.recipient.getVirtualAccount.present,
          webhookVirtualAbsent: !transaction.recipient.webhookVirtualAccount.present,
          currentRecipientAccepted: transaction.recipient.matched,
          currentDecision: transaction.recipient.decision,
        })),
      })),
    };
    // Close before reporting success; the outer catch never prints raw errors.
    await db.close();
    db = undefined;
    console.log(JSON.stringify(output, null, 2));
  } catch {
    console.error(
      JSON.stringify({
        format: 'payos-private-mb-comparison-v1',
        error: 'PRIVATE_COMPARISON_FAILED',
      }),
    );
    process.exitCode = 1;
  } finally {
    if (db) await db.close().catch(() => {});
  }
}
export function invokeComparison({ account, target, script }, execute = execFile) {
  return new Promise((resolve, reject) => {
    const child = execute(
      'docker',
      [
        'compose',
        '--env-file',
        'deploy/.env.production',
        '-f',
        'compose.production.yaml',
        'exec',
        '-T',
        'api',
        'node',
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        '(' + containerComparison.toString() + ')()',
      ],
      { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        // Do not echo stderr, stdout or Error objects on failure.
        if (error) reject(Error('PRIVATE_COMPARISON_FAILED'));
        else resolve(stdout);
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ account, target, script }));
  });
}
export async function runPrivateComparison(
  args,
  {
    read = hiddenAccount,
    invoke = invokeComparison,
    source = () => readFile(new URL('./payos-recipient-diagnostic.mjs', import.meta.url), 'utf8'),
    output = console,
  } = {},
) {
  try {
    const target = parseTarget(args);
    const account = await read();
    // Exact 10 digits is input validation for the operator's reported MB
    // account. Matching still uses complete string equality, never length.
    if (!/^[0-9]{10}$/.test(account)) throw Error();
    const stdout = await invoke({ account, target, script: await source() });
    const report = JSON.parse(stdout);
    if (
      report.format !== 'payos-private-mb-comparison-v1' ||
      report.readOnly !== true ||
      !Array.isArray(report.requests) ||
      report.requests.length > 10
    )
      throw Error();
    // Render only booleans and known statuses. Even a noisy container cannot
    // echo the private input, raw SDK error or connection string through here.
    const flag = (value) => (typeof value === 'boolean' ? value : null);
    const decisions = [
      'MATCH',
      'MATCH_VIA_VERIFIED_WEBHOOK',
      'MATCH_VIA_BACKEND_BINDING',
      'MISSING_CREATE_ANCHOR',
      'WEBHOOK_EXPLICIT_VA_DIFFERS_FROM_CREATE',
      'GET_WEBHOOK_RECIPIENTS_DIFFER',
      'GET_EXPLICIT_VA_DIFFERS_FROM_CREATE',
      'GET_PRIMARY_DIFFERS_NO_ELIGIBLE_WEBHOOK',
      'GET_PRIMARY_MISSING',
      'GET_WEBHOOK_PRIMARY_ACCOUNTS_DIFFER',
      'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE',
    ];
    output.log(
      JSON.stringify(
        {
          format: 'payos-private-mb-comparison-v1',
          target,
          readOnly: true,
          accountInputSource: 'OPERATOR_ENTERED_LINKED_MB_ACCOUNT',
          paymentAuthorizationChanged: false,
          requests: report.requests.map((request) => ({
            signedGetVerified: flag(request.signedGetVerified),
            providerPaid: flag(request.providerPaid),
            getChecksAllMatch: flag(request.getChecksAllMatch),
            createMatchesQrAccount: flag(request.createMatchesQrAccount),
            quoteExpiredNow: flag(request.quoteExpiredNow),
            cancelRequested: flag(request.cancelRequested),
            transactions: (Array.isArray(request.transactions) ? request.transactions : [])
              .slice(0, 100)
              .map((transaction) => ({
                getMatchesEnteredMb: flag(transaction.getMatchesEnteredMb),
                eligibleWebhookMatchesEnteredMb: flag(transaction.eligibleWebhookMatchesEnteredMb),
                eligibleWebhookPresent: flag(transaction.eligibleWebhookPresent),
                getAndWebhookSamePrimary: flag(transaction.getAndWebhookSamePrimary),
                getVirtualAbsent: flag(transaction.getVirtualAbsent),
                webhookVirtualAbsent: flag(transaction.webhookVirtualAbsent),
                currentRecipientAccepted: flag(transaction.currentRecipientAccepted),
                currentDecision: decisions.includes(transaction.currentDecision)
                  ? transaction.currentDecision
                  : 'UNKNOWN',
              })),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  } catch {
    output.error(
      'PRIVATE_COMPARISON_FAILED: cần terminal tương tác trong WSL, tài khoản MB 10 số và container API đang chạy. Không gửi số tài khoản hoặc lỗi thô; công cụ không thay đổi thanh toán.',
    );
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPrivateComparison(process.argv.slice(2));
}
