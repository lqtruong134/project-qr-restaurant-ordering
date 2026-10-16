'use client';
import { useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Modal } from '../shared/primitives';
import { notifySuccess } from '../shared/operation-notice';
/** Small shared form for conditional workforce fields; native dialog provides focus containment. */
export default function WorkforceForm({
  children,
  submit,
  onSubmit,
  confirm,
  successMessage,
}: {
  children: ReactNode;
  submit: string;
  onSubmit: (v: FormData) => Promise<void>;
  confirm?: (v: FormData) => string;
  successMessage?: string | false;
}) {
  const ref = useRef<HTMLFormElement>(null),
    running = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<FormData>();
  async function execute(v: FormData) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setPending(undefined);
    try {
      await onSubmit(v);
      if (ref.current) delete ref.current.dataset.dirty;
      if (successMessage !== false) notifySuccess(successMessage ?? 'Đã lưu thành công.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    if (confirm) setPending(v);
    else void execute(v);
  }
  return (
    <>
      <form
        ref={ref}
        className="core-form wf-conditional-form"
        aria-busy={busy}
        onSubmit={save}
        onChange={(e) => {
          e.currentTarget.dataset.dirty = 'true';
          setError('');
        }}
      >
        <fieldset className="form-editable-fields" disabled={busy}>
          {children}
        </fieldset>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Đang xử lý…' : submit}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {pending && confirm && (
        <Modal title="Kiểm tra trước khi xác nhận" close={() => setPending(undefined)}>
          <div className="confirm-dialog">
            <p>{confirm(pending)}</p>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" onClick={() => setPending(undefined)}>
                Quay lại
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void execute(pending)}
              >
                {submit}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
