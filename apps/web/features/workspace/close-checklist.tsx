'use client';
import { Icon } from '../shared/primitives';
import type { CloseReadiness } from './receipt';
export function CloseChecklist({
  readiness,
  open,
}: {
  readiness?: CloseReadiness;
  open?: (tab: string) => void;
}) {
  return (
    <section
      className={'close-checklist' + (readiness?.canClose ? ' close-ready' : '')}
      aria-label="Điều kiện kết thúc bàn"
      role="status"
    >
      <header>
        <Icon name={readiness?.canClose ? 'check' : 'info'} />
        <div>
          <h3>
            {!readiness
              ? 'Đang kiểm tra bàn'
              : readiness.canClose
                ? 'Bàn đã đủ điều kiện kết thúc'
                : 'Chưa thể kết thúc bàn'}
          </h3>
          <p>
            {readiness?.canClose
              ? 'Chỉ kết thúc khi khách đã rời bàn. Sau đó đội phục vụ sẽ thấy việc dọn bàn.'
              : 'Hoàn tất các việc dưới đây trước khi kết thúc bàn.'}
          </p>
        </div>
      </header>
      {!readiness ? (
        <p>Đang kiểm tra điều kiện. Vui lòng tải lại nếu chưa có kết quả.</p>
      ) : (
        <ul>
          {readiness.blockers.map((b) => (
            <li key={b.code}>
              <div>
                <strong>
                  {b.title} <span>- {b.count}</span>
                </strong>
                <p>{b.detail}</p>
              </div>
              {open && (
                <button type="button" className="secondary-button" onClick={() => open(b.tab)}>
                  {b.tab === 'orders'
                    ? 'Xem món'
                    : b.tab === 'payments'
                      ? 'Kiểm tra tiền'
                      : 'Xem công việc'}
                  <Icon name="arrow" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
