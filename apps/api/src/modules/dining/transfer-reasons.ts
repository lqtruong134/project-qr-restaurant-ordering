import { tableTransferPolicy, type TableTransferReason } from '@thesis/contracts';
import { reject, text } from '../shared/core-persistence.js';
export function transferReason(body: Record<string, unknown>) {
  // Existing clients may still supply the original plain reason string.
  if (body.reasonCode === undefined) return text(body.reason, 500);
  if (
    typeof body.reasonCode !== 'string' ||
    !Object.hasOwn(tableTransferPolicy.reasons, body.reasonCode)
  )
    reject('Vui lòng chọn lý do chuyển bàn hợp lệ.', 400);
  const code = body.reasonCode as TableTransferReason;
  if (body.note !== undefined && typeof body.note !== 'string')
    reject('Ghi chú chuyển bàn không hợp lệ.', 400);
  const note = (body.note as string | undefined)?.trim() ?? '';
  if (note.length > tableTransferPolicy.maxNoteLength)
    reject(`Ghi chú tối đa ${tableTransferPolicy.maxNoteLength} ký tự.`, 400);
  if (code === 'OTHER' && !note) reject('Vui lòng nhập nội dung lý do khác.', 400);
  return tableTransferPolicy.reasons[code] + (note ? ': ' + note : '');
}
