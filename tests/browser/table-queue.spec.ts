import { browserTableCode } from './table-code-fixture';
import { test, expect, type Page, type Route, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(p: Page, user: string, role: string) {
  await p.goto('/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(process.env.SEED_PASSWORD!);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(p).toHaveURL(new RegExp('workspace/' + role));
}
async function post(p: Page, path: string, data: unknown) {
  const r = await p.request.post('/api' + path, {
    headers: { origin: new URL(p.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test('one compact neutral card per table with several jobs; empty, cart, provisional and cancelled bills never claim payment', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ baseURL, ...info.project.use })),
  );
  const [admin, staff, guest, guestB, guestC] = (await Promise.all(
    contexts.map((c) => c.newPage()),
  )) as [Page, Page, Page, Page, Page];
  const errors: string[] = [];
  for (const p of [staff, guest]) p.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(admin, 'quyettruong05', 'admin');
    await login(staff, 'pv003', 'staff');
    const areas = await (await admin.request.get('/api/core/areas')).json();
    const prefix = 'QUEUE-' + randomUUID().slice(0, 8);
    const tables = [];
    for (const [i, p] of [guest, guestB, guestC].entries()) {
      const table = await post(admin, '/core/tables', {
        areaId: areas[0].id,
        code: prefix + '-' + i,
        name: 'Bàn A0' + (i + 2),
        capacity: 4,
      });
      tables.push(table);
      const qr = await post(admin, '/core/tables/' + table.id + '/qr', {});
      await p.goto(qr.joinPath);
      await p
        .getByLabel('Mã vào bàn', { exact: true })
        .fill(await browserTableCode(admin!, qr.joinPath, staff!));
      await p.getByLabel('Tên của bạn').fill('Khách kiểm tra ' + (i + 1));
      await p
        .getByRole('checkbox', {
          name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn',
        })
        .check();
      await p.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'Thực đơn tại bàn', exact: true })).toBeVisible();
    }
    const payment = async (payable = false) => {
      await guest.reload();
      await guest
        .getByRole('navigation', { name: 'Điều hướng khách' })
        .getByRole('button', { name: 'Thanh toán', exact: true })
        .click();
      await expect(guest.getByRole('form', { name: 'Yêu cầu thanh toán' })).toHaveCount(
        payable ? 1 : 0,
      );
      await expect(
        guest.getByRole('heading', { name: 'Bàn đã thanh toán đủ', exact: true }),
      ).toHaveCount(0);
    };
    await payment();
    // Keep a real quote read in flight during navigation: cleanup must abort it without a page error.
    await guest.bringToFront();
    const abortMarker = '__playwright_promotion_quote_cleanup__';
    await guest.evaluate((marker) => {
      sessionStorage.setItem(marker, '{}');
      sessionStorage.removeItem(marker + '_pagehide');
      window.addEventListener('pagehide', () =>
        sessionStorage.setItem(marker + '_pagehide', 'left'),
      );
      let readSequence = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          location.href,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (url.pathname === '/api/guest/promotion' && method.toUpperCase() === 'GET' && signal) {
          const id = String(++readSequence);
          const record = (state: 'started' | 'aborted' | 'fulfilled' | `rejected:${string}`) => {
            const reads = JSON.parse(sessionStorage.getItem(marker) ?? '{}') as Record<
              string,
              string
            >;
            reads[id] = state;
            sessionStorage.setItem(marker, JSON.stringify(reads));
          };
          record(signal.aborted ? 'aborted' : 'started');
          signal.addEventListener('abort', () => record('aborted'), { once: true });
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          // Correlate the held network request with its own real application signal.
          headers.set('x-playwright-read-id', id);
          return originalFetch(input, { ...init, headers }).then(
            (response) => {
              record('fulfilled');
              return response;
            },
            (error: Error) => {
              // Native navigation can reject before pagehide; the transport then retires this signal.
              record(`rejected:${error.name}`);
              throw error;
            },
          );
        }
        return originalFetch(input, init);
      };
    }, abortMarker);
    let heldRequest: Request | undefined;
    let releaseQuote!: () => void;
    const quoteGate = new Promise<void>((resolve) => {
      releaseQuote = resolve;
    });
    const holdQuote = async (route: Route) => {
      if (
        route.request().method() !== 'GET' ||
        !route.request().headers()['x-playwright-read-id'] ||
        heldRequest
      )
        return route.continue();
      heldRequest = route.request();
      await quoteGate;
      // A cancelled request can no longer be continued after its document has navigated.
      await route.continue().catch(() => undefined);
    };
    await guest.route('**/api/guest/promotion', holdQuote);
    try {
      await expect.poll(() => Boolean(heldRequest), { timeout: 10000 }).toBe(true);
      const heldId = heldRequest!.headers()['x-playwright-read-id']!;
      expect(heldId).toBeTruthy();
      const heldState = () =>
        guest.evaluate(
          ({ marker, id }) =>
            (JSON.parse(sessionStorage.getItem(marker) ?? '{}') as Record<string, string>)[id],
          { marker: abortMarker, id: heldId },
        );
      await expect.poll(heldState).toBe('started');
      await guest.reload();
      releaseQuote();
      // The held read must terminate without a response. Chromium can retire its signal
      // after native cancellation but before pagehide; WebKit may abort the signal first.
      await expect.poll(heldState).toMatch(/^(?:aborted|rejected:(?:AbortError|TypeError))$/);
      await expect
        .poll(() =>
          guest.evaluate((marker) => sessionStorage.getItem(marker + '_pagehide'), abortMarker),
        )
        .toBe('left');
    } finally {
      releaseQuote();
      await guest.unroute('**/api/guest/promotion', holdQuote);
      await guest.evaluate((marker) => {
        sessionStorage.removeItem(marker);
        sessionStorage.removeItem(marker + '_pagehide');
      }, abortMarker);
    }
    await payment();
    await expect(
      guest.getByRole('heading', { name: 'Bàn chưa có món cần thanh toán', exact: true }),
    ).toBeVisible();
    let state = await (await guest.request.get('/api/guest/state')).json();
    const product = state.products.find((p: { name: string }) => p.name === 'Chả giò giòn');
    await post(guest, '/guest/cart', {
      productId: product.id,
      quantity: 1,
      cartVersion: state.cart.cart_version,
    });
    await payment();
    await expect(
      guest.getByRole('heading', { name: 'Bạn chưa gửi món', exact: true }),
    ).toBeVisible();
    state = await (await guest.request.get('/api/guest/state')).json();
    const batch = await post(guest, '/guest/orders', {
      requestId: randomUUID(),
      cartVersion: state.cart.cart_version,
      itemIds: state.items.map((i: { id: string }) => i.id),
    });
    await payment(true);
    await expect(
      guest.getByRole('heading', { name: 'Món đang chờ nhân viên xác nhận', exact: true }),
    ).toHaveCount(0);
    await post(guest, '/guest/support', { type: 'WATER' });
    await post(guest, '/guest/support', { type: 'UTENSILS' });
    await post(guestB, '/guest/support', { type: 'WATER' });
    await post(guestC, '/guest/support', { type: 'WATER' });
    await staff
      .getByRole('navigation', { name: 'Phục vụ' })
      .getByRole('button', { name: /Việc cần làm/ })
      .click();
    await staff.getByRole('textbox', { name: 'Tìm tên hoặc mã bàn…' }).fill(prefix);
    await expect(staff.locator('.queue-table-card')).toHaveCount(3);
    await expect(staff.locator('.queue-board-summary')).toContainText('3 bàn - 4 việc');
    await expect(
      staff.getByRole('button', { name: /Cần bạn xử lý|Chưa nhận \/ Việc chung|Tất cả loại/ }),
    ).toHaveCount(0);
    const tile = staff.locator('.queue-table-card[data-table-id="' + tables[0].id + '"]');
    await expect(tile.locator('.work-badge')).toHaveCount(2);
    await expect(tile).toContainText('Khách cần hỗ trợ');
    await expect(tile).not.toContainText('Xác minh khách tại bàn');
    await expect(tile.getByRole('button')).toHaveCount(1);
    expect(await tile.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
    for (const width of [320, 768, 1440]) {
      await staff.setViewportSize({ width, height: 900 });
      expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await staff.setViewportSize(info.project.use.viewport!);
    await tile.scrollIntoViewIfNeeded();
    await staff.screenshot({ path: info.outputPath('table-queue-grouped.png'), scale: 'css' });
    await tile.getByRole('button', { name: 'Chi tiết bàn', exact: true }).click();
    await expect(
      staff.getByRole('dialog').getByRole('button', { name: 'Việc tại bàn', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await staff.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    expect(batch.status).toBe('SUBMITTED');
    state = await (await guest.request.get('/api/guest/state')).json();
    await post(guest, '/guest/items/cancel', {
      itemIds: [state.orders[0].item_id],
      reasonCode: 'CUSTOMER_CHANGED_MIND',
    });
    await payment();
    await expect(
      guest.getByRole('heading', { name: 'Hiện không có khoản cần thanh toán', exact: true }),
    ).toBeVisible();
    await expect(guest.locator('.guest-content')).toContainText('Chả giò giòn');
    await expect(guest.locator('.guest-content')).not.toContainText(
      'Chọn hình thức thanh toán và báo nhân viên',
    );
    for (const width of [320, 768, 1440]) {
      await guest.setViewportSize({ width, height: 900 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await guest.setViewportSize(info.project.use.viewport!);
    await guest.locator('.guest-content .empty-state').scrollIntoViewIfNeeded();
    await guest.screenshot({ path: info.outputPath('guest-zero-payment.png'), scale: 'css' });
    const final = await (await guest.request.get('/api/guest/state')).json();
    expect(final.account.charge_total).toBe('0');
    expect(final.account.paid_total).toBe('0');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
