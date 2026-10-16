'use client';
import { useState } from 'react';
import { Icon, Modal } from '../shared/primitives';
import type { GuestParticipant } from './guest-panels';

const memberName = (member: GuestParticipant) => member.display_name || 'Khách chưa đặt tên';
const initial = (member: GuestParticipant) =>
  (Array.from(memberName(member).trim().split(/\s+/u).at(-1) || '?')[0] ?? '?').toLocaleUpperCase(
    'vi-VN',
  );

export function GuestParticipants({
  members,
  currentId,
  tableName,
  onEditProfile,
}: {
  members: GuestParticipant[];
  currentId: string;
  tableName: string;
  onEditProfile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ordered = [
    ...members.filter((m) => m.id === currentId),
    ...members.filter((m) => m.id !== currentId),
  ];
  const preview = ordered.slice(0, 2);
  const extra = Math.max(0, ordered.length - preview.length);
  return (
    <>
      <button
        type="button"
        className="guest-participants-button"
        aria-label={'Người cùng bàn, ' + ordered.length + ' người'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Xem người cùng bàn"
        onClick={() => setOpen(true)}
      >
        <Icon name="people" size={19} />
        <span className="guest-participants-preview">
          {preview.map((member) => (
            <span className="guest-participant-chip" key={member.id} title={memberName(member)}>
              <span className="guest-participant-avatar" aria-hidden="true">
                {initial(member)}
              </span>
              <span className="guest-participant-name">{memberName(member)}</span>
            </span>
          ))}
        </span>
        {extra > 0 && (
          <span className="guest-participants-extra" aria-label={extra + ' người khác'}>
            +{extra}
          </span>
        )}
      </button>
      {open && (
        <Modal title={'Người cùng bàn - ' + tableName} close={() => setOpen(false)}>
          <div className="guest-participants-detail">
            <p className="guest-participants-summary">
              <strong>{ordered.length} người</strong> đang dùng thực đơn cùng bàn với bạn.
            </p>
            <ul className="guest-participants-list" aria-label="Danh sách người cùng bàn">
              {ordered.map((member) => (
                <li key={member.id}>
                  <span className="guest-participant-avatar" aria-hidden="true">
                    {initial(member)}
                  </span>
                  <span className="guest-participant-full-name">{memberName(member)}</span>
                  {member.id === currentId && <span className="guest-participant-self">Bạn</span>}
                </li>
              ))}
            </ul>
            <p className="field-hint">
              Mỗi người chọn và gửi món của mình. Bạn có thể xem món của mọi người trong mục “Cả
              bàn”.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setOpen(false);
                onEditProfile();
              }}
            >
              Tên của bạn và rời bàn
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
