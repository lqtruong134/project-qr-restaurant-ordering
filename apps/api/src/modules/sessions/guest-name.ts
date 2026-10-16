import { reject, text, type Connection } from '../shared/core-persistence.js';

export function guestName(input: unknown) {
  const name = text(input, 80);
  if (
    Array.from(name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    reject('Tên không được chứa ký tự điều khiển.', 400);
  return name.normalize('NFC').replace(/\s+/gu, ' ');
}

function nameKey(name: string) {
  return name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi-VN');
}

// Join and profile updates already hold the session lock. Keep the check inside
// that transaction so concurrent joins/renames cannot claim the same name.
export async function ensureGuestNameAvailable(
  c: Connection,
  sessionId: string,
  name: string,
  participantId: string | null = null,
) {
  const participants = await c.query<{ display_name: string | null }>(
    'SELECT display_name FROM session_participant WHERE session_id=$1 AND ($2::uuid IS NULL OR id<>$2)',
    [sessionId, participantId],
  );
  // Retain names of guests who left: their submitted dishes still belong to
  // this session, and must remain distinguishable from a new participant.
  if (participants.rows.some((p) => p.display_name && nameKey(p.display_name) === nameKey(name)))
    reject('Tên này đã được dùng trong phiên bàn. Hãy thêm họ hoặc tên gọi khác để phân biệt.');
}
