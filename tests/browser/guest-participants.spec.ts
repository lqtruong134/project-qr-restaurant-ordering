import { browserTableCode } from './table-code-fixture';
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post('/api' + path, {
    headers: { origin: new URL(page.url()).origin, 'x-csrf-protection': '1' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const codes = new Map<string, string>();
async function setup(browser: Browser, baseURL: string | undefined, info: TestInfo) {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        userAgent: info.project.use.userAgent,
      }),
    ),
  );
  const [admin, a, b, c] = await Promise.all(contexts.map((context) => context.newPage()));
  await admin!.goto('/login');
  await admin!.getByLabel('Tên đăng nhập', { exact: true }).fill('quyettruong05');
  await admin!.getByLabel('Mật khẩu', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await admin!.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(admin!).toHaveURL(/workspace\/admin/);
  const areas = await (await admin!.request.get('/api/core/areas')).json();
  const code = 'PEOPLE-' + randomUUID().slice(0, 8);
  const table = await post(admin!, '/core/tables', {
    code,
    name: code,
    areaId: areas[0].id,
    capacity: 4,
  });
  const qr = await post(admin!, '/core/tables/' + table.id + '/qr', {});
  codes.set(qr.joinPath, await browserTableCode(admin!, qr.joinPath));
  return { contexts, a: a!, b: b!, c: c!, joinPath: qr.joinPath as string };
}
async function fillJoin(page: Page, joinPath: string, name: string) {
  await page.goto(joinPath);
  await page.getByLabel('Mã vào bàn', { exact: true }).fill(codes.get(joinPath)!);
  await page.getByLabel('Tên của bạn', { exact: true }).fill(name);
  await page
    .getByRole('checkbox', { name: 'Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn' })
    .check();
  await page.getByRole('button', { name: 'Xem thực đơn', exact: true }).click();
}
const peopleButton = (page: Page) =>
  page.getByRole('button', { name: /Người cùng bàn, \d+ người/ });
const dialog = (page: Page) => page.getByRole('dialog', { name: /Người cùng bàn -/ });

test('unique names, named header previews, overflow and accessible session roster', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info);
  const errors: string[] = [];
  f.a.on('pageerror', (e) => errors.push(e.message));
  try {
    await fillJoin(f.a, f.joinPath, 'Trường');
    await expect(peopleButton(f.a)).toHaveAccessibleName('Người cùng bàn, 1 người');
    await fillJoin(f.b, f.joinPath, 'trường');
    await expect(f.b.locator('.guest-join-form').getByRole('alert')).toContainText(
      'Tên này đã được dùng',
    );
    await expect(f.b.getByLabel('Tên của bạn', { exact: true })).toHaveValue('trường');
    await fillJoin(f.b, f.joinPath, 'Lữ Trường');
    await expect(peopleButton(f.a)).toHaveAccessibleName('Người cùng bàn, 2 người');
    await expect(peopleButton(f.a)).toContainText('Trường');
    await expect(peopleButton(f.a)).toContainText('Lữ Trường');
    await expect(f.a.locator('.guest-participants-extra')).toHaveCount(0);
    const longName = 'Nguyễn Thị Minh Anh cùng bàn với Trường';
    await fillJoin(f.c, f.joinPath, longName);
    await expect(peopleButton(f.a)).toHaveAccessibleName('Người cùng bàn, 3 người');
    await expect(f.a.locator('.guest-participants-extra')).toHaveText('+1');
    await f.a.screenshot({ path: info.outputPath('participants-header.png') });
    await peopleButton(f.a).focus();
    await f.a.keyboard.press('Enter');
    await expect(dialog(f.a).getByRole('listitem')).toHaveCount(3);
    await expect(dialog(f.a)).toContainText(longName);
    await expect(dialog(f.a).getByText('Bạn', { exact: true })).toBeVisible();
    await expect(dialog(f.a)).not.toContainText('trực tuyến');
    await f.a.screenshot({ path: info.outputPath('participants-list.png') });
    await f.a.keyboard.press('Escape');
    await expect(dialog(f.a)).toHaveCount(0);
    await expect(peopleButton(f.a)).toBeFocused();
    const before = await (await f.a.request.get('/api/guest/state')).json();
    await f.a.goto(f.joinPath);
    await expect(peopleButton(f.a)).toBeVisible();
    const after = await (await f.a.request.get('/api/guest/state')).json();
    expect(after.participant.id).toBe(before.participant.id);
    expect(after.participants).toHaveLength(3);
    for (const width of [768, 390, 320]) {
      await f.a.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          f.a.locator('.guest-participant-name').evaluateAll((names) =>
            names
              .filter((name) => name.scrollWidth > name.clientWidth + 1)
              .map((name) => ({
                name: name.textContent,
                available: name.clientWidth,
                needed: name.scrollWidth,
              })),
          ),
        )
        .toEqual([]);
      await f.c.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => f.c.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await expect(peopleButton(f.c)).toBeVisible();
    }
    await f.a.screenshot({ path: info.outputPath('participants-header-320.png') });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(f.contexts.map((context) => context.close()));
  }
});

test('renaming and leaving update the open roster while duplicate names stay unavailable', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(browser, baseURL, info);
  try {
    await fillJoin(f.a, f.joinPath, 'Trường');
    await fillJoin(f.b, f.joinPath, 'Lan');
    await peopleButton(f.a).click();
    await expect(dialog(f.a).getByRole('listitem')).toHaveCount(2);
    await peopleButton(f.b).click();
    await dialog(f.b).getByRole('button', { name: 'Tên của bạn và rời bàn', exact: true }).click();
    const profile = f.b.getByRole('dialog', { name: 'Tên của bạn và rời bàn', exact: true });
    await profile.getByLabel('Tên của bạn', { exact: true }).fill('TRƯỜNG');
    await profile.getByRole('button', { name: 'Cập nhật tên', exact: true }).click();
    await expect(profile.getByRole('alert')).toContainText('Tên này đã được dùng');
    await profile.getByLabel('Tên của bạn', { exact: true }).fill('Lữ Trường');
    await profile.getByRole('button', { name: 'Cập nhật tên', exact: true }).click();
    await expect(dialog(f.a)).toContainText('Lữ Trường');
    await profile.getByRole('button', { name: 'Rời bàn', exact: true }).click();
    const confirm = f.b.getByRole('dialog', { name: 'Rời bàn trên thiết bị này?', exact: true });
    await confirm.getByRole('button', { name: 'Xác nhận rời bàn', exact: true }).click();
    await expect(f.b.getByRole('heading', { name: 'Quét QR tại bàn để bắt đầu' })).toBeVisible();
    await expect(dialog(f.a).getByRole('listitem')).toHaveCount(1);
    await expect(dialog(f.a)).not.toContainText('Lữ Trường');
    await fillJoin(f.b, f.joinPath, 'lữ trường');
    await expect(f.b.locator('.guest-join-form').getByRole('alert')).toContainText(
      'Tên này đã được dùng',
    );
    await f.a.keyboard.press('Escape');
    await expect(peopleButton(f.a)).toHaveAccessibleName('Người cùng bàn, 1 người');
  } finally {
    await Promise.allSettled(f.contexts.map((context) => context.close()));
  }
});
