import type { Row } from '../shared/components';

export type DishNotice = {
  id: string;
  itemId: string;
  text: string;
  tone: 'normal' | 'ready' | 'attention';
  createdAt: number;
};
type ItemSnapshot = { status: string };
export type DishNoticeFeed = {
  key: string;
  items: Record<string, ItemSnapshot>;
  notices: DishNotice[];
  announcement: string;
};
type NoticeSnapshot = {
  sessionId: string;
  tableId: string;
  participantId: string;
  orders: Row[];
};

const stages: Record<string, number> = {
  SUBMITTED: 0,
  ACCEPTED: 1,
  IN_PREPARATION: 2,
  READY: 3,
  SERVED: 4,
  CANCELLED: 5,
  UNAVAILABLE: 5,
};
const retention = 120_000;

function message(row: Row, participantId: string): Omit<DishNotice, 'id' | 'createdAt'> | null {
  const itemId = String(row.item_id ?? '');
  const status = String(row.item_status ?? '');
  if (!itemId || stages[status] === undefined) return null;
  const scope = row.owner_participant_id === participantId ? 'Món của bạn' : 'Món của bàn';
  const dish =
    Number(row.quantity ?? 1) + ' × ' + String(row.product_name_snapshot ?? 'món đã gọi');
  let detail = '';
  if (status === 'SUBMITTED')
    detail =
      row.status === 'PENDING_REVIEW' ? 'đang chờ nhân viên kiểm tra lượt gọi.' : 'đã gửi bếp.';
  if (status === 'ACCEPTED') detail = 'đã được bếp tiếp nhận.';
  if (status === 'IN_PREPARATION') detail = 'đang được chế biến.';
  if (status === 'READY') detail = 'đã xong, đang chờ nhân viên mang ra.';
  if (status === 'SERVED') detail = 'đã được mang ra bàn.';
  if (status === 'CANCELLED')
    detail =
      row.cancel_reason_code === 'CUSTOMER_CHANGED_MIND'
        ? 'đã hủy theo yêu cầu.'
        : 'đã được nhà hàng dừng. Nhân viên sẽ trao đổi tại bàn.';
  if (status === 'UNAVAILABLE') detail = 'chưa thể phục vụ. Nhân viên sẽ trao đổi tại bàn.';
  return {
    itemId,
    text: scope + ': ' + dish + ' ' + detail,
    tone: ['CANCELLED', 'UNAVAILABLE'].includes(status)
      ? 'attention'
      : status === 'READY'
        ? 'ready'
        : 'normal',
  };
}

/** The first snapshot establishes a baseline; only later changes are announced. */
export function advanceDishNotices(
  previous: DishNoticeFeed | undefined,
  snapshot: NoticeSnapshot,
  now = Date.now(),
): DishNoticeFeed {
  const key = [snapshot.sessionId, snapshot.tableId, snapshot.participantId].join(':');
  const baseline = previous?.key === key ? previous : undefined;
  const items: Record<string, ItemSnapshot> = {};
  const changes: DishNotice[] = [];
  for (const row of snapshot.orders) {
    const itemId = String(row.item_id ?? '');
    if (!itemId) continue;
    const status = String(row.item_status ?? '');
    const before = baseline?.items[itemId];
    // A slower polling response must not replay an earlier kitchen step.
    if (before && (stages[status] ?? -1) < (stages[before.status] ?? -1)) {
      items[itemId] = before;
      continue;
    }
    items[itemId] = { status };
    if (!baseline || before?.status === status) continue;
    const next = message(row, snapshot.participantId);
    if (next) changes.push({ ...next, id: itemId + ':' + status + ':' + now, createdAt: now });
  }
  const changedIds = new Set(changes.map((notice) => notice.itemId));
  const notices = [
    ...changes,
    ...(baseline?.notices ?? []).filter(
      (notice) =>
        now - notice.createdAt < retention &&
        Boolean(items[notice.itemId]) &&
        !changedIds.has(notice.itemId),
    ),
  ].slice(0, 6);
  const announcement = changes.length
    ? changes
        .slice(0, 3)
        .map((notice) => notice.text)
        .join(' ') +
      (changes.length > 3 ? ' Và ' + (changes.length - 3) + ' món khác vừa được cập nhật.' : '')
    : '';
  return { key, items, notices, announcement };
}

export function dishProgressSummary(orders: Row[]) {
  const portions = (status: string) =>
    orders
      .filter((row) => row.item_status === status)
      .reduce((sum, row) => sum + Number(row.quantity ?? 1), 0);
  const ready = portions('READY');
  if (ready) return ready + ' phần món đã xong, đang chờ nhân viên mang ra.';
  const preparing = portions('IN_PREPARATION');
  if (preparing) return 'Bếp đang chế biến ' + preparing + ' phần món của bàn.';
  const accepted = portions('ACCEPTED');
  if (accepted) return 'Bếp đã nhận ' + accepted + ' phần món của bàn.';
  if (portions('SUBMITTED')) return 'Lượt gọi của bàn đang chờ tiếp nhận.';
  return orders.length
    ? 'Theo dõi từng món và các cập nhật trong “Món đã gọi”.'
    : 'Chọn món, gửi bếp và theo dõi tiến độ tại đây.';
}
