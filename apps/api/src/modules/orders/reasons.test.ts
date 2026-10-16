import { it, expect } from 'vitest';
import { parseReason } from './reasons.js';
it('rejects unknown/prototype reasons and reasons outside the actor scope', () => {
  for (const reasonCode of ['constructor', '__proto__', 'NONEXISTENT'])
    expect(() => parseReason({ reasonCode }, 'KITCHEN_ISSUE')).toThrow('Chọn lý do hợp lệ');
  expect(() => parseReason({ reasonCode: 'CUSTOMER_CHANGED_MIND' }, 'KITCHEN_ISSUE')).toThrow(
    'Vai trò',
  );
  expect(() => parseReason({ reasonCode: 'KITCHEN_ERROR', note: 'lỗi' }, 'GUEST_CANCEL')).toThrow(
    'Vai trò',
  );
});
it('requires fault/other notes, bounds notes and does not grant fault status to legacy text', () => {
  expect(() => parseReason({ reasonCode: 'KITCHEN_ERROR' }, 'ADMIN_LATE')).toThrow('ghi rõ');
  expect(() => parseReason({ reasonCode: 'OTHER', note: 'x'.repeat(501) }, 'ADMIN_LATE')).toThrow(
    '500',
  );
  expect(parseReason({ reason: 'Lỗi nhà hàng' }, 'ADMIN_LATE')).toMatchObject({
    code: 'OTHER',
    fault: false,
  });
  expect(
    parseReason({ reasonCode: 'QUALITY_ISSUE', note: '  Món cháy  ' }, 'ADMIN_LATE'),
  ).toMatchObject({ code: 'QUALITY_ISSUE', note: 'Món cháy', fault: true });
});
