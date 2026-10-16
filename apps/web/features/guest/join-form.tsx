'use client';
import { AccessRequest } from './access-request';
import { useState } from 'react';
import { restaurantPolicy } from '@thesis/contracts';
import { api } from '../shared/components';
export function JoinForm({
  token,
  showPolicy,
  joined,
}: {
  token: string;
  showPolicy: () => void;
  joined: () => Promise<void>;
}) {
  const [accessCode, setAccessCode] = useState('');
  const [errorField, setErrorField] = useState<'name' | 'code' | 'form'>('form');
  const [name, setName] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="core-form guest-join-form"
      aria-busy={busy}
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setError('');
        if (!name.trim() || name.trim().length > 80) {
          setErrorField('name');
          setError('Vui lòng nhập tên của bạn (tối đa 80 ký tự).');
          return;
        }
        if (!/^\d{4}$/.test(accessCode)) {
          setErrorField('code');
          setError('Nhập mã vào bàn gồm 4 số.');
          return;
        }
        if (!accepted) {
          setErrorField('form');
          setError('Vui lòng đồng ý với quy định để vào bàn gọi món.');
          return;
        }
        setBusy(true);
        try {
          await api(
            '/guest/join',
            {
              token,
              name: name.trim(),
              accessCode,
              acceptedPolicyVersion: restaurantPolicy.version,
            },
            'POST',
            true,
          );
          await joined();
        } catch (e) {
          setErrorField(
            e instanceof Error && e.message.startsWith('Tên')
              ? 'name'
              : e instanceof Error && /mã vào bàn|Mã vào bàn/.test(e.message)
                ? 'code'
                : 'form',
          );
          setError(e instanceof Error ? e.message : 'Chưa tham gia được bàn.');
          if (e instanceof Error && e.message.includes('Quy định đã được cập nhật'))
            setAccepted(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Vào bàn gọi món</h3>
      <div className="core-fields">
        <label>
          Tên của bạn
          <input
            name="name"
            disabled={busy}
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            autoComplete="nickname"
            placeholder="Ví dụ: Minh Anh"
            aria-describedby={error && errorField === 'name' ? 'join-error' : undefined}
            aria-invalid={!!error && errorField === 'name'}
          />
        </label>
        {error && errorField === 'name' && (
          <p id="join-error" role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <label>
        Mã vào bàn
        <input
          name="accessCode"
          disabled={busy}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          pattern="[0-9]{4}"
          value={accessCode}
          onChange={(e) => {
            setAccessCode(e.target.value.replace(/[^0-9]/g, ''));
            setError('');
          }}
          aria-describedby={
            error && errorField === 'code' ? 'session-code-hint join-error' : 'session-code-hint'
          }
          aria-invalid={!!error && errorField === 'code'}
          className="access-code-input"
          placeholder="Nhập 4 số"
        />
      </label>
      {error && errorField === 'code' && (
        <p id="join-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <p className="field-hint" id="session-code-hint">
        Nhân viên hoặc người đã vào bàn có thể chia sẻ mã này với bạn.
      </p>
      <AccessRequest token={token} name={name} />
      <div className="policy-acceptance">
        <input
          id="accept-table-policy"
          type="checkbox"
          checked={accepted}
          disabled={busy}
          onChange={(e) => {
            setAccepted(e.target.checked);
            setError('');
          }}
          aria-label="Tôi đồng ý với Quy định sử dụng dịch vụ tại bàn"
          aria-describedby="join-policy-hint"
        />
        <span>
          <label htmlFor="accept-table-policy">Tôi đồng ý với </label>
          <button type="button" className="text-link" onClick={showPolicy}>
            {restaurantPolicy.title}
          </button>
          .
        </span>
      </div>
      <span id="join-policy-hint" className="guest-visually-hidden">
        Xem quy định tại liên kết bên trên.
      </span>
      <button className="primary-button" disabled={busy}>
        {busy ? 'Đang tham gia…' : 'Xem thực đơn'}
      </button>
      {error && errorField === 'form' && (
        <p id="join-error" role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
