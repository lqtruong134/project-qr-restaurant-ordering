'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscountProgram } from '@thesis/contracts';
import type { AdminData } from './admin-types';
import { api, vnd, Action } from '../shared/components';
import { Empty, Icon, Modal, Search, matches, confirmDiscard } from '../shared/primitives';
import { notifySuccess } from '../shared/operation-notice';
import { SessionReference } from '../shared/session-reference';
import {
  discountInput,
  discountStatus,
  newDiscountDraft,
  pricingTime,
  type DiscountDraft,
} from './pricing-admin-model';

const weekdays = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

export default function DiscountProgramsPanel({ catalog }: { catalog: AdminData['catalog'] }) {
  const [rows, setRows] = useState<DiscountProgram[]>(),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<DiscountProgram | null>();
  const [history, setHistory] = useState<DiscountProgram>();
  const load = useCallback(async () => {
    try {
      setRows(await api<DiscountProgram[]>('/core/admin/discount-programs'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa tải được chương trình khuyến mãi.');
      throw e;
    }
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const shown = rows?.filter(
    (row) =>
      matches(`${row.name} ${row.code ?? ''} ${row.description}`, search) &&
      (filter === 'all' || row.status === filter),
  );
  return (
    <section className="pricing-admin" aria-label="Chương trình khuyến mãi">
      <div className="context-notice pricing-rule-note">
        <Icon name="info" size={20} />
        <div>
          <strong>Một ưu đãi cho mỗi phiên bàn</strong>
          <p>
            Combo không được giảm tiếp và không tính vào ngưỡng ưu đãi. Khoản giảm được chốt khi thu
            tiền lần đầu; thay đổi chương trình chỉ áp dụng cho lần chốt mới.
          </p>
        </div>
      </div>
      <div className="toolbar pricing-toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Tìm tên chương trình hoặc mã giảm giá…"
        />
        <label>
          Trạng thái
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Tất cả</option>
            <option value="ACTIVE">Đang bật / có lịch</option>
            <option value="PAUSED">Tạm dừng</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </label>
        <Action ariaLabel="Làm mới khuyến mãi" run={load}>
          <Icon name="refresh" size={18} /> Làm mới
        </Action>
        <button className="primary-button" onClick={() => setEditing(null)}>
          <Icon name="plus" size={18} /> Thêm chương trình
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!rows && !error && <p role="status">Đang tải khuyến mãi…</p>}
      {rows && !shown?.length && (
        <Empty
          title={rows.length ? 'Không có chương trình phù hợp' : 'Chưa có chương trình khuyến mãi'}
        >
          {rows.length
            ? 'Thử tên hoặc mã khác, hoặc chọn tất cả trạng thái.'
            : 'Tạo chương trình ở trạng thái tạm dừng để kiểm tra điều kiện trước khi bật.'}
        </Empty>
      )}
      <div className="pricing-card-grid">
        {shown?.map((row) => (
          <article
            className="core-card pricing-program"
            key={row.id}
            aria-label={'Khuyến mãi ' + row.name}
          >
            <div className="pricing-card-heading">
              <div>
                <h3>{row.name}</h3>
                <span className="small-note">Phiên bản {row.version}</span>
              </div>
              <span className="status-pill" data-status={row.status}>
                {discountStatus(row)}
              </span>
            </div>
            <p className="pricing-benefit">
              {row.type === 'PERCENT' ? `Giảm ${row.percent}%` : `Giảm ${vnd(row.fixedAmount)}`}
              {row.maxDiscountAmount && <small> · tối đa {vnd(row.maxDiscountAmount)}</small>}
            </p>
            {row.description && <p>{row.description}</p>}
            <dl className="pricing-facts">
              <div>
                <dt>Áp dụng</dt>
                <dd>
                  {row.mode === 'AUTO' ? (
                    'Tự động khi đủ điều kiện'
                  ) : (
                    <>
                      Mã <strong>{row.code}</strong>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Tiền món đủ điều kiện</dt>
                <dd>
                  {Number(row.minEligibleAmount)
                    ? `Từ ${vnd(row.minEligibleAmount)}`
                    : 'Không yêu cầu giá trị tối thiểu'}
                </dd>
              </div>
              <div>
                <dt>Thời hạn</dt>
                <dd>
                  {pricingTime(row.startsAt)} → {pricingTime(row.endsAt)}
                </dd>
              </div>
              <div>
                <dt>Lịch trong tuần</dt>
                <dd>
                  {row.weekdays.length
                    ? row.weekdays.map((day) => weekdays[day]).join(', ')
                    : 'Mỗi ngày'}
                  {row.startTime ? ` · ${row.startTime}–${row.endTime}` : ' · cả ngày'}
                </dd>
              </div>
              <div>
                <dt>Phạm vi</dt>
                <dd>
                  {row.scope === 'ALL'
                    ? 'Tất cả món lẻ'
                    : row.scope === 'PRODUCTS'
                      ? `${row.productIds.length} món lẻ đã chọn`
                      : `${row.categoryIds.length} nhóm món đã chọn`}
                </dd>
              </div>
              <div>
                <dt>Lượt sử dụng</dt>
                <dd>
                  {row.usedCount} đã dùng · {row.reservedCount} đang giữ
                  {row.usageLimit != null ? ` / tối đa ${row.usageLimit}` : ' · không giới hạn'}
                </dd>
              </div>
            </dl>
            <div className="core-actions">
              {row.status !== 'ARCHIVED' && (
                <button className="secondary-button" onClick={() => setEditing(row)}>
                  Sửa điều kiện
                </button>
              )}
              {row.status !== 'ARCHIVED' && (
                <Action
                  successMessage={
                    row.status === 'ACTIVE'
                      ? 'Đã tạm dừng chương trình.'
                      : 'Đã bật chương trình theo lịch đã đặt.'
                  }
                  run={async () => {
                    await api(
                      '/core/admin/discount-programs/' + row.id,
                      {
                        ...discountInput(newDiscountDraft(row)),
                        version: row.version,
                        status: row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                      },
                      'PATCH',
                    );
                    await load();
                  }}
                >
                  {row.status === 'ACTIVE' ? 'Tạm dừng' : 'Bật chương trình'}
                </Action>
              )}
              <button className="secondary-button" onClick={() => setHistory(row)}>
                Lịch sử & lượt dùng
              </button>
              {row.status !== 'ARCHIVED' && (
                <Action
                  confirm="Lưu trữ chương trình này? Ưu đãi đã chốt và lịch sử sử dụng vẫn được giữ."
                  confirmTitle="Lưu trữ khuyến mãi?"
                  confirmLabel="Lưu trữ"
                  successMessage="Đã lưu trữ chương trình khuyến mãi."
                  run={async () => {
                    await api(
                      '/core/admin/discount-programs/' + row.id,
                      { version: row.version },
                      'DELETE',
                    );
                    await load();
                  }}
                >
                  Lưu trữ
                </Action>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing !== undefined && (
        <DiscountEditor
          key={editing?.id ?? 'new'}
          row={editing ?? undefined}
          catalog={catalog}
          close={() => setEditing(undefined)}
          saved={load}
        />
      )}
      {history && <DiscountHistory row={history} close={() => setHistory(undefined)} />}
    </section>
  );
}

function DiscountEditor({
  row,
  catalog,
  close,
  saved,
}: {
  row?: DiscountProgram;
  catalog: AdminData['catalog'];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => newDiscountDraft(row));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const change = <K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError('');
    if (form.current) form.current.dataset.dirty = 'true';
  };
  const choose = (key: 'productIds' | 'categoryIds', id: string, checked: boolean) =>
    change(key, checked ? [...draft[key], id] : draft[key].filter((value) => value !== id));
  const inputMoney = (
    key: 'fixedAmount' | 'minEligibleAmount' | 'maxDiscountAmount',
    label: string,
    required: boolean,
  ) => (
    <label>
      {label}
      <input
        inputMode="numeric"
        value={draft[key]}
        onChange={(e) => change(key, e.target.value)}
        required={required}
        pattern="[0-9]+"
        placeholder={required ? 'Nhập số tiền' : 'Để trống nếu không giới hạn'}
      />
    </label>
  );
  return (
    <Modal
      title={row ? 'Sửa chương trình khuyến mãi' : 'Thêm chương trình khuyến mãi'}
      wide
      blocking={busy}
      close={close}
    >
      <form
        ref={form}
        className="core-form pricing-editor"
        aria-busy={busy}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          let body;
          try {
            body = discountInput(draft);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Kiểm tra thông tin chương trình.');
            return;
          }
          setBusy(true);
          try {
            await api(
              '/core/admin/discount-programs' + (row ? '/' + row.id : ''),
              { ...body, ...(row ? { version: row.version } : {}) },
              row ? 'PATCH' : 'POST',
            );
            await saved();
            if (form.current) delete form.current.dataset.dirty;
            notifySuccess(
              row ? 'Đã cập nhật chương trình khuyến mãi.' : 'Đã thêm chương trình khuyến mãi.',
            );
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Chưa lưu được khuyến mãi.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>Thông tin chương trình</legend>
          <div className="pricing-fields">
            <label>
              Tên chương trình
              <input
                value={draft.name}
                onChange={(e) => change('name', e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label>
              Cách áp dụng
              <select
                aria-label="Cách áp dụng"
                value={draft.mode}
                onChange={(e) => change('mode', e.target.value as DiscountDraft['mode'])}
              >
                <option value="AUTO">Tự động khi đủ điều kiện</option>
                <option value="CODE">Nhập mã giảm giá</option>
              </select>
            </label>
            {draft.mode === 'CODE' && (
              <label>
                Mã giảm giá
                <input
                  value={draft.code}
                  onChange={(e) => change('code', e.target.value.toUpperCase())}
                  maxLength={32}
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="Ví dụ: BUATRUA"
                  required
                />
              </label>
            )}
            <label>
              Trạng thái sau khi lưu
              <select
                aria-label="Trạng thái sau khi lưu"
                value={draft.status}
                onChange={(e) => change('status', e.target.value as DiscountDraft['status'])}
              >
                <option value="PAUSED">Tạm dừng để kiểm tra</option>
                <option value="ACTIVE">Bật theo lịch áp dụng</option>
              </select>
            </label>
          </div>
          <label>
            Nội dung cho khách
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => change('description', e.target.value)}
              maxLength={500}
              placeholder="Mô tả ngắn ưu đãi và điều kiện quan trọng"
            />
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Mức giảm & ngưỡng</legend>
          <div className="pricing-fields">
            <label>
              Hình thức giảm
              <select
                aria-label="Hình thức giảm"
                value={draft.type}
                onChange={(e) => change('type', e.target.value as DiscountDraft['type'])}
              >
                <option value="PERCENT">Giảm phần trăm</option>
                <option value="FIXED">Giảm số tiền cố định</option>
              </select>
            </label>
            {draft.type === 'PERCENT' ? (
              <>
                <label>
                  Tỷ lệ giảm (%)
                  <input
                    inputMode="numeric"
                    value={draft.percent}
                    onChange={(e) => change('percent', e.target.value)}
                  />
                </label>
                {inputMoney('maxDiscountAmount', 'Giảm tối đa (đồng)', false)}
              </>
            ) : (
              inputMoney('fixedAmount', 'Số tiền giảm (đồng)', true)
            )}
            {inputMoney('minEligibleAmount', 'Tiền món tối thiểu (đồng)', true)}
            <label>
              Giới hạn lượt toàn chương trình
              <input
                inputMode="numeric"
                value={draft.usageLimit}
                onChange={(e) => change('usageLimit', e.target.value)}
                placeholder="Để trống nếu không giới hạn"
              />
            </label>
          </div>
          <p className="small-note">
            Mức giảm cơ bản tối đa 50%. Với giảm tiền cố định, ngưỡng tối thiểu phải ít nhất gấp đôi
            số tiền giảm. Ngưỡng tính trên các món lẻ thuộc phạm vi đã chọn, sau miễn/hủy món và
            trước khuyến mãi. Một lần cho mỗi phiên bàn.
          </p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Lịch áp dụng · giờ Việt Nam</legend>
          <div className="pricing-fields">
            <label>
              Bắt đầu
              <input
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => change('startsAt', e.target.value)}
                required
              />
            </label>
            <label>
              Kết thúc
              <input
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => change('endsAt', e.target.value)}
                required
              />
            </label>
            <label>
              Từ giờ
              <input
                type="time"
                value={draft.startTime}
                onChange={(e) => change('startTime', e.target.value)}
              />
            </label>
            <label>
              Đến giờ
              <input
                type="time"
                value={draft.endTime}
                onChange={(e) => change('endTime', e.target.value)}
              />
            </label>
          </div>
          <p className="small-note">
            Để trống cả hai giờ để áp dụng cả ngày. Khung giờ nằm trong cùng ngày.
          </p>
          <div className="pricing-weekdays" aria-label="Ngày trong tuần">
            {weekdays.map((name, day) => (
              <label className="policy-consent" key={day}>
                <input
                  type="checkbox"
                  checked={draft.weekdays.includes(day)}
                  onChange={(e) =>
                    change(
                      'weekdays',
                      e.target.checked
                        ? [...draft.weekdays, day]
                        : draft.weekdays.filter((value) => value !== day),
                    )
                  }
                />
                <span>{name}</span>
              </label>
            ))}
          </div>
          <p className="small-note">Không chọn thứ nào nghĩa là áp dụng mỗi ngày.</p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Món được hưởng ưu đãi</legend>
          <label>
            Phạm vi áp dụng
            <select
              aria-label="Phạm vi áp dụng"
              value={draft.scope}
              onChange={(e) => change('scope', e.target.value as DiscountDraft['scope'])}
            >
              <option value="ALL">Tất cả món lẻ</option>
              <option value="PRODUCTS">Chọn từng món lẻ</option>
              <option value="CATEGORIES">Chọn nhóm món</option>
            </select>
          </label>
          {draft.scope !== 'ALL' && (
            <div
              className="pricing-choice-list"
              aria-label={
                draft.scope === 'PRODUCTS' ? 'Chọn món được giảm' : 'Chọn nhóm món được giảm'
              }
            >
              {draft.scope === 'PRODUCTS'
                ? catalog.products
                    .filter(
                      (p) =>
                        p.product_kind !== 'COMBO' &&
                        (p.is_active || draft.productIds.includes(p.id)),
                    )
                    .map((p) => (
                      <label className="policy-consent" key={p.id}>
                        <input
                          type="checkbox"
                          checked={draft.productIds.includes(p.id)}
                          onChange={(e) => choose('productIds', p.id, e.target.checked)}
                        />
                        <span>
                          {p.name}
                          <small>
                            {p.code} · {vnd(p.base_price)}
                          </small>
                        </span>
                      </label>
                    ))
                : catalog.categories
                    .filter(
                      (c) =>
                        c.code !== 'COMBO' && (c.is_active || draft.categoryIds.includes(c.id)),
                    )
                    .map((c) => (
                      <label className="policy-consent" key={c.id}>
                        <input
                          type="checkbox"
                          checked={draft.categoryIds.includes(c.id)}
                          onChange={(e) => choose('categoryIds', c.id, e.target.checked)}
                        />
                        <span>{String(c.name)}</span>
                      </label>
                    ))}
            </div>
          )}
          <p className="context-notice">
            Combo luôn được loại khỏi ưu đãi và ngưỡng tiền món. Ưu đãi không cộng dồn với chương
            trình khác.
          </p>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="core-actions">
          <button className="primary-button" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu chương trình'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              if (await confirmDiscard(form.current?.parentElement)) close();
            }}
          >
            Hủy chỉnh sửa
          </button>
        </div>
      </form>
    </Modal>
  );
}

type ProgramHistory = {
  totalVersions?: number;
  totalRedemptions?: number;
  versions: {
    version: number;
    changedAt: string;
    changedBy: string;
    action: string;
    snapshot: DiscountProgram;
  }[];
  redemptions: {
    sessionId: string;
    tableCode: string;
    status: string;
    discountAmount: string;
    createdAt: string;
    lockedAt?: string | null;
  }[];
};
function DiscountHistory({ row, close }: { row: DiscountProgram; close: () => void }) {
  const [data, setData] = useState<ProgramHistory>(),
    [error, setError] = useState('');
  useEffect(() => {
    void api<ProgramHistory>('/core/admin/discount-programs/' + row.id + '/history')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Chưa tải được lịch sử.'));
  }, [row.id]);
  return (
    <Modal title={'Lịch sử khuyến mãi — ' + row.name} wide close={close}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải lịch sử…</p>}
      {data && (
        <div className="pricing-history">
          <section>
            <h3>Các lần thay đổi</h3>
            {data.totalVersions != null && data.totalVersions > data.versions.length && (
              <p className="small-note">
                Hiển thị {data.versions.length} lần thay đổi gần nhất / {data.totalVersions}.
              </p>
            )}
            {data.versions.length ? (
              <ol className="pricing-timeline">
                {data.versions.map((v) => (
                  <li key={v.version}>
                    <strong>Phiên bản {v.version}</strong>
                    <p>
                      {v.action.toUpperCase().includes('CREATE')
                        ? 'Tạo chương trình'
                        : v.action.toUpperCase().includes('ARCHIVE') ||
                            v.action.toUpperCase().includes('DELETE')
                          ? 'Lưu trữ chương trình'
                          : 'Cập nhật điều kiện'}{' '}
                      · {v.changedBy || 'Nhà hàng'}
                    </p>
                    {v.snapshot && (
                      <p className="small-note">
                        {v.snapshot.type === 'PERCENT'
                          ? `Giảm ${v.snapshot.percent}%`
                          : `Giảm ${vnd(v.snapshot.fixedAmount)}`}{' '}
                        · Từ {vnd(v.snapshot.minEligibleAmount)}
                        {v.snapshot.mode === 'CODE' && v.snapshot.code
                          ? ` · Mã ${v.snapshot.code}`
                          : ''}
                      </p>
                    )}
                    <time>{pricingTime(v.changedAt)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Chưa có lịch sử thay đổi.</p>
            )}
          </section>
          <section>
            <h3>Lượt áp dụng</h3>
            {data.totalRedemptions != null && data.totalRedemptions > data.redemptions.length && (
              <p className="small-note">
                Hiển thị {data.redemptions.length} lượt gần nhất / {data.totalRedemptions}.
              </p>
            )}
            {data.redemptions.length ? (
              <div className="pricing-use-list">
                {data.redemptions.map((use, i) => (
                  <article className="core-card" key={use.sessionId + i}>
                    <h4>
                      Bàn {use.tableCode}
                      <SessionReference id={use.sessionId} />
                    </h4>
                    <p>
                      {(
                        {
                          SELECTED: 'Đã chọn',
                          USED: 'Đã chốt ưu đãi',
                          LOCKED: 'Đã chốt',
                          RESERVED: 'Đang giữ lượt',
                          RELEASED: 'Đã trả lượt',
                          APPLIED: 'Đã áp dụng',
                          CANCELLED: 'Đã hủy',
                        } as Record<string, string>
                      )[use.status] ?? 'Đã ghi nhận'}{' '}
                      · Giảm {vnd(use.discountAmount)}
                    </p>
                    <time>{pricingTime(use.lockedAt ?? use.createdAt)}</time>
                  </article>
                ))}
              </div>
            ) : (
              <p>Chưa có phiên bàn sử dụng chương trình.</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
