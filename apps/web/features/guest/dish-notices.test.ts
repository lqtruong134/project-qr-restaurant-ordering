import { describe, expect, it } from 'vitest';
import { advanceDishNotices, dishProgressSummary } from './dish-notices';
import type { Row } from '../shared/components';

const dish = (itemId: string, status = 'SUBMITTED', owner = 'guest-a'): Row => ({
  id: 'order-' + itemId,
  item_id: itemId,
  item_status: status,
  status: 'SUBMITTED',
  quantity: 1,
  product_name_snapshot: 'Gỏi cuốn tôm thịt',
  owner_participant_id: owner,
});
const snapshot = (orders: Row[]) => ({
  sessionId: 'session-a',
  tableId: 'table-a',
  participantId: 'guest-a',
  orders,
});

describe('dish updates shown at the current table', () => {
  it('uses existing orders as the initial baseline without replaying their history', () => {
    const feed = advanceDishNotices(
      undefined,
      snapshot([dish('one', 'SERVED'), dish('two', 'READY')]),
    );
    expect(feed.notices).toEqual([]);
    expect(feed.announcement).toBe('');
    expect(dishProgressSummary([dish('two', 'READY')])).toContain('1 phần món đã xong');
  });
  it('announces a real kitchen change once and distinguishes own and shared dishes', () => {
    const first = advanceDishNotices(
      undefined,
      snapshot([dish('one'), dish('two', 'ACCEPTED', 'guest-b')]),
      0,
    );
    const next = advanceDishNotices(
      first,
      snapshot([dish('one', 'ACCEPTED'), dish('two', 'READY', 'guest-b')]),
      100,
    );
    expect(next.notices).toHaveLength(2);
    expect(next.notices[0]?.text).toContain('Món của bạn');
    expect(next.notices[1]?.text).toContain('Món của bàn');
    expect(next.notices[1]?.text).toContain('chờ nhân viên mang ra');
    expect(next.announcement).toContain('đã được bếp tiếp nhận');
    const unchanged = advanceDishNotices(
      next,
      snapshot([dish('one', 'ACCEPTED'), dish('two', 'READY', 'guest-b')]),
      200,
    );
    expect(unchanged.notices).toHaveLength(2);
    expect(unchanged.announcement).toBe('');
  });
  it('keeps only the latest update for each dish and ignores a slower earlier-stage response', () => {
    const first = advanceDishNotices(undefined, snapshot([dish('one')]), 0);
    const accepted = advanceDishNotices(first, snapshot([dish('one', 'ACCEPTED')]), 100);
    const preparing = advanceDishNotices(accepted, snapshot([dish('one', 'IN_PREPARATION')]), 200);
    expect(preparing.notices).toHaveLength(1);
    expect(preparing.notices[0]?.text).toContain('đang được chế biến');
    const stale = advanceDishNotices(preparing, snapshot([dish('one', 'ACCEPTED')]), 300);
    expect(stale.items.one?.status).toBe('IN_PREPARATION');
    expect(stale.announcement).toBe('');
    const same = advanceDishNotices(stale, snapshot([dish('one', 'IN_PREPARATION')]), 400);
    expect(same.announcement).toBe('');
  });
  it('resets the baseline and removes prior updates on another session, table or participant', () => {
    const first = advanceDishNotices(undefined, snapshot([dish('one')]), 0);
    const ready = advanceDishNotices(first, snapshot([dish('one', 'READY')]), 100);
    for (const change of [
      { sessionId: 'session-b' },
      { tableId: 'table-b' },
      { participantId: 'guest-b' },
    ]) {
      const moved = advanceDishNotices(
        ready,
        { ...snapshot([dish('one', 'SERVED')]), ...change },
        200,
      );
      expect(moved.notices).toEqual([]);
      expect(moved.announcement).toBe('');
    }
  });
  it('notifies about later orders, including orders awaiting staff review', () => {
    const first = advanceDishNotices(undefined, snapshot([]), 0);
    const order = { ...dish('one'), status: 'PENDING_REVIEW' };
    const next = advanceDishNotices(first, snapshot([order]), 100);
    expect(next.announcement).toContain('chờ nhân viên kiểm tra');
    expect(next.announcement).not.toContain('bếp tiếp nhận');
  });
  it('explains cancellations without claiming a refund or silently removing a dish', () => {
    const first = advanceDishNotices(undefined, snapshot([dish('one', 'ACCEPTED')]), 0);
    const unavailable = advanceDishNotices(
      first,
      snapshot([{ ...dish('one', 'UNAVAILABLE'), charge_status: 'REVERSED' }]),
      100,
    );
    expect(unavailable.notices[0]?.tone).toBe('attention');
    expect(unavailable.announcement).toContain('Nhân viên sẽ trao đổi tại bàn');
    expect(unavailable.announcement).not.toContain('hoàn tiền');
    const customer = advanceDishNotices(
      first,
      snapshot([{ ...dish('one', 'CANCELLED'), cancel_reason_code: 'CUSTOMER_CHANGED_MIND' }]),
      100,
    );
    expect(customer.announcement).toContain('theo yêu cầu');
  });
  it('limits updates, expires old messages and does not announce removed orders', () => {
    const orders = Array.from({ length: 20 }, (_, index) => dish('dish-' + index));
    const first = advanceDishNotices(undefined, snapshot(orders), 0);
    const next = advanceDishNotices(
      first,
      snapshot(orders.map((row) => ({ ...row, item_status: 'READY' }))),
      100,
    );
    expect(next.notices).toHaveLength(6);
    expect(next.announcement).toContain('17 món khác');
    const expired = advanceDishNotices(
      next,
      snapshot(orders.map((row) => ({ ...row, item_status: 'READY' }))),
      120_100,
    );
    expect(expired.notices).toEqual([]);
    expect(expired.announcement).toBe('');
    const removed = advanceDishNotices(next, snapshot([]), 300);
    expect(removed.notices).toEqual([]);
    expect(removed.announcement).toBe('');
  });
  it('ignores unknown statuses and does not treat a price adjustment as a kitchen update', () => {
    const first = advanceDishNotices(undefined, snapshot([dish('one', 'SERVED')]), 0);
    const waived = advanceDishNotices(
      first,
      snapshot([{ ...dish('one', 'SERVED'), charge_status: 'REVERSED' }]),
      100,
    );
    expect(waived.announcement).toBe('');
    const unknown = advanceDishNotices(waived, snapshot([dish('two', 'UNKNOWN')]), 200);
    expect(unknown.announcement).toBe('');
  });
});
