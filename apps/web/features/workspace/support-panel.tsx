'use client';
import { SessionReference } from '../shared/session-reference';
import { StaffTableCode } from './table-access';
import { useState } from 'react';
import { supportTypes, supportPolicy } from '@thesis/contracts';
import { Action, api, EntryForm, type Row } from '../shared/components';
import { Empty, Modal, Icon } from '../shared/primitives';
import { restaurantTime } from '../shared/restaurant-time';
import { SupportHistory } from './support-history';
const typeLabel = (s: Row) =>
  s.request_type === 'ACCESS_CODE'
    ? 'Cấp mã tham gia bàn'
    : supportTypes[s.request_type as keyof typeof supportTypes];
export function SupportActions({
  rows,
  userId,
  act,
  refresh,
  flat = false,
  onOpen,
}: {
  refresh?: () => Promise<void>;
  flat?: boolean;
  onOpen?: (request: Row) => void;
  rows: Row[];
  userId: string;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  const [handoff, setHandoff] = useState(''),
    [people, setPeople] = useState<Row[]>([]);
  const [decline, setDecline] = useState(''),
    [postpone, setPostpone] = useState('');
  const deferred = rows.find((s) => s.id === postpone);
  const incoming = rows.filter((s) => s.pending_to_staff_id === userId);
  const fresh = rows
    .filter((s) => s.status === 'NEW')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const mine = rows.filter((s) => s.status === 'ACKNOWLEDGED' && s.acknowledged_by === userId);
  const other = rows.filter(
    (s) =>
      s.status === 'ACKNOWLEDGED' &&
      s.acknowledged_by !== userId &&
      s.pending_to_staff_id !== userId,
  );
  const current = rows.find((s) => s.id === handoff),
    response = rows.find((s) => s.id === decline);
  const age = (s: Row) =>
    Math.max(0, Math.floor((Date.now() - new Date(String(s.created_at)).getTime()) / 60000));
  const minutes = (s: Row) =>
    age(s) === 0
      ? 'Vừa gửi'
      : s.status === 'NEW'
        ? `Đã chờ ${age(s)} phút`
        : `Gửi ${age(s)} phút trước`;
  const card = (s: Row, incomingCard = false) => (
    <article
      className={
        'support-task task-' +
        (s.request_type === 'BILL' ? 'payment' : 'support') +
        ' ' +
        (incomingCard ? 'support-incoming' : s.status === 'NEW' ? 'support-new' : '')
      }
      key={s.id}
      data-support-id={s.id}
    >
      <div className="support-card-top">
        <span className="status-pill">
          {incomingCard
            ? 'Bàn giao đến bạn'
            : s.status === 'NEW'
              ? 'Chưa có người nhận'
              : 'Đang xử lý'}
        </span>
        <span className="support-age">
          {minutes(s)}
          {s.status === 'NEW' && age(s) >= supportPolicy.attentionMinutes
            ? ' - Cần chú ý'
            : s.status === 'NEW' && age(s) >= supportPolicy.waitingMinutes
              ? ' - Đang chờ'
              : ''}
        </span>
      </div>
      <h3>
        {String(s.table_code)}
        <SessionReference id={s.session_id} /> <small>- {String(s.area_name)}</small>
      </h3>
      <p className="support-type">
        <Icon name="bell" size={17} />
        {s.request_type === 'BILL'
          ? 'Khách gọi thu tiền - ' +
            (!s.payment_method
              ? 'Chọn hình thức tại bàn'
              : s.payment_method === 'CASH'
                ? 'Tiền mặt'
                : 'Chuyển khoản')
          : typeLabel(s)}
      </p>
      <small>
        Khách: {String(s.display_name ?? 'Khách tại bàn')} - Gửi lúc{' '}
        {restaurantTime(s.created_at, { hour: '2-digit', minute: '2-digit' })}
      </small>
      {s.content && <p className="support-content">{String(s.content)}</p>}
      {s.area_priority && s.status === 'NEW' && (
        <p className="support-priority">Thuộc khu vực ca bạn đang làm</p>
      )}
      {s.status === 'ACKNOWLEDGED' && (
        <p className="support-owner">
          {s.acknowledged_by === userId
            ? 'Bạn đang phụ trách'
            : `${s.acknowledged_by_name} đang phụ trách`}
        </p>
      )}
      {incomingCard && (
        <div className="support-handoff-note">
          <strong>Lý do bàn giao</strong>
          <p>{String(s.pending_reason)}</p>
          <small>
            Gửi lúc {restaurantTime(s.pending_requested_at, { hour: '2-digit', minute: '2-digit' })}
            . Người gửi vẫn phụ trách đến khi bạn nhận.
          </small>
        </div>
      )}
      {s.acknowledged_by === userId && s.pending_handoff_id && (
        <div className="support-handoff-note">
          <strong>Chờ {String(s.pending_to_name)} phản hồi</strong>
          <p>{String(s.pending_reason)}</p>
          <p>Bạn vẫn phụ trách yêu cầu này.</p>
          <Action
            confirm="Rút đề nghị bàn giao? Bạn tiếp tục phụ trách yêu cầu này."
            successMessage="Đã rút đề nghị bàn giao. Bạn tiếp tục phụ trách yêu cầu."
            run={() =>
              act(`/core/support/${s.id}/handoffs/${s.pending_handoff_id}/cancel`, {
                reason: 'Người phụ trách rút đề nghị bàn giao.',
              })
            }
          >
            Rút bàn giao
          </Action>
        </div>
      )}
      {s.acknowledged_by === userId &&
        !s.pending_handoff_id &&
        s.latest_handoff_status === 'DECLINED' && (
          <p className="support-handoff-note">
            Đồng nghiệp đã từ chối bàn giao: {String(s.latest_response_reason)}. Bạn tiếp tục phụ
            trách.
          </p>
        )}
      {s.request_type === 'ACCESS_CODE' &&
        s.status === 'ACKNOWLEDGED' &&
        s.acknowledged_by === userId && (
          <StaffTableCode
            key={s.id + ':' + (s.session_id ?? 'pending')}
            requestId={s.id}
            tableId={s.table_id ? String(s.table_id) : undefined}
            done={refresh ?? (async () => {})}
          />
        )}
      <div className="support-card-actions">
        {s.status === 'NEW' && (
          <Action
            successMessage="Đã nhận xử lý yêu cầu tại bàn."
            run={async () => {
              await act('/core/support/' + s.id + '/claim');
              if (s.request_type === 'BILL') onOpen?.(s);
            }}
          >
            {s.request_type === 'BILL' ? 'Nhận việc & đến bàn' : 'Nhận xử lý'}
          </Action>
        )}
        {incomingCard && (
          <>
            <Action
              successMessage="Đã nhận bàn giao yêu cầu hỗ trợ."
              run={() => act(`/core/support/${s.id}/handoffs/${s.pending_handoff_id}/accept`)}
            >
              Nhận bàn giao
            </Action>
            <button className="secondary-button" onClick={() => setDecline(s.id)}>
              Từ chối
            </button>
          </>
        )}
        {s.acknowledged_by === userId && (
          <>
            {s.request_type === 'BILL' ? (
              <>
                {onOpen && (
                  <button className="primary-button" onClick={() => onOpen(s)}>
                    Thu tiền tại bàn
                  </button>
                )}
                <button className="secondary-button" onClick={() => setPostpone(s.id)}>
                  Khách chưa thanh toán
                </button>
              </>
            ) : (
              <Action
                successMessage="Đã hoàn tất yêu cầu hỗ trợ."
                confirm={
                  s.request_type === 'ACCESS_CODE'
                    ? 'Bạn đã đọc mã cho khách tại bàn? Yêu cầu sẽ được đánh dấu đã hoàn tất.'
                    : undefined
                }
                run={() => act('/core/support/' + s.id + '/resolve')}
              >
                {s.request_type === 'ACCESS_CODE' ? 'Đã đọc mã cho khách' : 'Đã xử lý'}
              </Action>
            )}
            {!s.pending_handoff_id && (
              <Action
                run={async () => {
                  setPeople(await api<Row[]>('/core/support-assignees?requestId=' + s.id));
                  setHandoff(s.id);
                }}
              >
                Bàn giao
              </Action>
            )}
          </>
        )}
        <SupportHistory id={s.id} />
      </div>
    </article>
  );
  return (
    <div className="support-workspace">
      {flat ? (
        <div className="support-grid">
          {rows.map((s) => card(s, s.pending_to_staff_id === userId))}
        </div>
      ) : (
        <>
          <p className="support-help">
            Nhận xử lý để xác định người phụ trách. Bàn giao chỉ chuyển trách nhiệm khi người nhận
            đồng ý.
          </p>
          {incoming.length > 0 && (
            <section aria-label="Bàn giao đến bạn">
              <h2>
                Bàn giao đến bạn <span className="nav-count">{incoming.length}</span>
              </h2>
              <div className="support-grid">{incoming.map((s) => card(s, true))}</div>
            </section>
          )}
          <section aria-label="Yêu cầu mới">
            <h2>
              Chờ tiếp nhận <span className="nav-count">{fresh.length}</span>
            </h2>
            {!fresh.length ? (
              <p>Không có yêu cầu mới đang chờ.</p>
            ) : (
              <div className="support-grid">{fresh.map((s) => card(s))}</div>
            )}
          </section>
          {mine.length > 0 && (
            <section aria-label="Bạn đang phụ trách">
              <h2>Bạn đang phụ trách - {mine.length}</h2>
              <div className="support-grid">{mine.map((s) => card(s))}</div>
            </section>
          )}
          {other.length > 0 && (
            <section aria-label="Đồng nghiệp đang phụ trách">
              <h2>Đồng nghiệp đang phụ trách - {other.length}</h2>
              <div className="support-grid">{other.map((s) => card(s))}</div>
            </section>
          )}
          {!rows.length && (
            <Empty title="Không có hỗ trợ đang chờ" icon="bell">
              Mọi yêu cầu tại bàn đã được xử lý.
            </Empty>
          )}
        </>
      )}
      {postpone && (
        <Modal title="Kết thúc lời gọi chưa thu tiền" close={() => setPostpone('')}>
          {deferred && deferred.acknowledged_by === userId ? (
            <>
              <p>
                Chỉ dùng khi đã trao đổi và khách chưa muốn thanh toán. Hóa đơn vẫn còn phải thu;
                thao tác này không ghi nhận tiền.
              </p>
              <EntryForm
                title="Ghi nhận trao đổi với khách"
                fields={[{ key: 'reason', label: 'Lý do chưa thanh toán', maxLength: 500 }]}
                submit="Kết thúc lời gọi"
                successMessage="Đã ghi nhận khách chưa thanh toán và kết thúc lời gọi."
                onSubmit={async (v) => {
                  await act('/core/support/' + deferred.id + '/resolve', v);
                  setPostpone('');
                }}
              />
            </>
          ) : (
            <p role="status">Yêu cầu đã đổi người phụ trách. Vui lòng tải lại.</p>
          )}
        </Modal>
      )}
      {handoff && (
        <Modal title="Đề nghị bàn giao hỗ trợ" close={() => setHandoff('')}>
          {current && current.acknowledged_by === userId && !current.pending_handoff_id ? (
            <>
              <p>
                <strong>
                  {String(current.table_code)} - {typeLabel(current)}
                </strong>
              </p>
              <p>
                Bạn vẫn phụ trách cho đến khi đồng nghiệp đồng ý. Danh sách ưu tiên người đang vào
                ca và cùng khu vực; vẫn có đồng nghiệp khác để hỗ trợ.
              </p>
              <EntryForm
                title="Thông tin bàn giao"
                fields={[
                  {
                    key: 'userId',
                    label: 'Người nhận',
                    options: people
                      .filter((p) => p.id !== userId)
                      .map((p) => ({
                        value: p.id,
                        label:
                          p.display_name +
                          ' - ' +
                          (p.on_duty
                            ? p.same_area
                              ? 'Đang làm - Cùng khu vực'
                              : 'Đang làm'
                            : p.scheduled
                              ? 'Có lịch ca - Chưa vào ca'
                              : 'Chưa ghi nhận trong ca'),
                      })),
                  },
                  { key: 'reason', label: 'Lý do bàn giao', maxLength: 500 },
                ]}
                submit="Gửi đề nghị bàn giao"
                successMessage="Đã gửi đề nghị bàn giao. Bạn vẫn phụ trách đến khi đồng nghiệp nhận."
                onSubmit={async (v) => {
                  await act('/core/support/' + current.id + '/reassign', v);
                  setHandoff('');
                }}
              />
            </>
          ) : (
            <p role="status">Yêu cầu đã thay đổi. Đóng cửa sổ này để xem trạng thái mới.</p>
          )}
        </Modal>
      )}
      {decline && (
        <Modal title="Từ chối bàn giao" close={() => setDecline('')}>
          {response && response.pending_to_staff_id === userId ? (
            <>
              <p>
                Người gửi vẫn phụ trách. Ghi lý do để đồng nghiệp biết và tiếp tục hỗ trợ khách.
              </p>
              <EntryForm
                title="Lý do từ chối"
                fields={[{ key: 'reason', label: 'Lý do từ chối', maxLength: 500 }]}
                submit="Xác nhận từ chối"
                successMessage="Đã từ chối bàn giao. Người gửi tiếp tục phụ trách yêu cầu."
                onSubmit={async (v) => {
                  await act(
                    `/core/support/${response.id}/handoffs/${response.pending_handoff_id}/decline`,
                    v,
                  );
                  setDecline('');
                }}
              />
            </>
          ) : (
            <p role="status">Bàn giao đã kết thúc. Đóng cửa sổ này để xem trạng thái mới.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
