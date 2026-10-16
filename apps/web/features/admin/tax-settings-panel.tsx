'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaxSettings, TaxPolicy } from '@thesis/contracts';
import { api, Action } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { notifySuccess } from '../shared/operation-notice';
import {
  localPricingTime,
  pricingTime,
  taxRateOptions,
  taxPolicyLifecycle,
} from './pricing-admin-model';

type TaxProduct = TaxSettings['products'][number];
export default function TaxSettingsPanel({ onUpdated }: { onUpdated: () => Promise<void> }) {
  const [data, setData] = useState<TaxSettings>(),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(0);
  const [replacingPolicy, setReplacingPolicy] = useState<TaxPolicy>();
  const [policyOpen, setPolicyOpen] = useState(false),
    [selected, setSelected] = useState<TaxProduct>();
  const load = useCallback(async () => {
    try {
      setData(await api<TaxSettings>('/core/admin/tax-policies'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa tải được cấu hình VAT.');
      throw e;
    }
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const shown =
    data?.products.filter(
      (p) => matches(`${p.name} ${p.code}`, search) && (filter === 'all' || p.treatment === filter),
    ) ?? [];
  const index = Math.min(page, Math.max(0, Math.ceil(shown.length / 12) - 1));
  return (
    <section className="pricing-admin" aria-label="Giá thực đơn và VAT">
      <div className="context-notice pricing-rule-note">
        <Icon name="info" size={20} />
        <div>
          <strong>Giá thực đơn đã bao gồm VAT</strong>
          <p>
            Thuế được tách từ giá sau khuyến mãi, không cộng thêm vào số tiền khách nhìn thấy trên
            thực đơn. Món đã gọi và hóa đơn đã chốt giữ nguyên mức thuế; thay đổi chỉ áp dụng cho
            lượt gọi mới.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải cấu hình VAT…</p>}
      {data && (
        <>
          <div className="pricing-policy-summary core-card">
            <div>
              <span className="small-note">Mức mặc định đang áp dụng</span>
              <h3>
                {data.current
                  ? `${data.current.defaultRatePercent}% VAT`
                  : 'Chưa có chính sách VAT'}
              </h3>
              {data.current && (
                <p>
                  Từ {pricingTime(data.current.effectiveAt)} · Phiên bản {data.current.version}
                </p>
              )}
              <p className="small-note">
                Mức thuế riêng của món được ưu tiên. Không chịu VAT khác với thuế suất 0%. Mức 8%
                cần đúng nhóm hàng và thời kỳ giảm thuế; lịch ban đầu chuyển về 10% từ 01/01/2027.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setReplacingPolicy(undefined);
                setPolicyOpen(true);
              }}
            >
              <Icon name="plus" size={18} /> Lập chính sách mới
            </button>
          </div>
          <section className="pricing-policy-history" aria-label="Lịch áp dụng chính sách VAT">
            <h3>Lịch chính sách VAT</h3>
            <p className="small-note">
              Mỗi lần thay đổi tạo một phiên bản mới có thời điểm hiệu lực và lý do. Lịch sử giao
              dịch không được tính lại.
            </p>
            {data.policies.length ? (
              <div className="pricing-card-grid">
                {[...data.policies]
                  .sort(
                    (a, b) =>
                      new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime() ||
                      b.version - a.version,
                  )
                  .map((policy) => (
                    <article className="core-card" key={policy.id}>
                      <div className="pricing-card-heading">
                        <h4>VAT mặc định {policy.defaultRatePercent}%</h4>
                        <span className="status-pill">{taxPolicyLifecycle(policy, data)}</span>
                      </div>
                      <p>Hiệu lực: {pricingTime(policy.effectiveAt)}</p>
                      <p>{policy.reason}</p>
                      <small>
                        Phiên bản {policy.version} · Lập {pricingTime(policy.createdAt)}
                      </small>
                      {taxPolicyLifecycle(policy, data) === 'Có lịch áp dụng' &&
                        new Date(policy.effectiveAt).getTime() > Date.now() + 60000 && (
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setReplacingPolicy(policy);
                              setPolicyOpen(true);
                            }}
                          >
                            Lập phiên bản thay thế
                          </button>
                        )}
                    </article>
                  ))}
              </div>
            ) : (
              <Empty title="Chưa có chính sách VAT">
                Lập mức mặc định trước khi nhận thanh toán mới.
              </Empty>
            )}
          </section>
          <section className="pricing-product-tax" aria-label="Thuế VAT theo món">
            <div className="section-heading">
              <div>
                <h3>Thuế VAT theo món</h3>
                <p>Món dùng mức mặc định hoặc được phân loại riêng theo nhóm hàng thực tế.</p>
              </div>
            </div>
            <div className="toolbar pricing-toolbar">
              <Search
                value={search}
                onChange={(s) => {
                  setSearch(s);
                  setPage(0);
                }}
                placeholder="Tìm tên hoặc mã món để phân loại VAT…"
              />
              <label>
                Phân loại
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">Tất cả</option>
                  <option value="DEFAULT">Theo mức mặc định</option>
                  <option value="TAXABLE">Thuế suất riêng</option>
                  <option value="EXEMPT">Không chịu VAT</option>
                </select>
              </label>
              <Action ariaLabel="Làm mới VAT" run={load}>
                <Icon name="refresh" size={18} /> Làm mới
              </Action>
            </div>
            {!shown.length && (
              <Empty title="Không có món phù hợp">Thử tên khác hoặc chọn tất cả phân loại.</Empty>
            )}
            <div className="pricing-card-grid">
              {shown.slice(index * 12, (index + 1) * 12).map((p) => (
                <article
                  className="core-card pricing-tax-product"
                  key={p.id}
                  aria-label={'VAT ' + p.name}
                >
                  <div>
                    <h4>{p.name}</h4>
                    <small>{p.code}</small>
                    <p>
                      <strong>
                        {p.treatment === 'EXEMPT'
                          ? 'Không chịu VAT'
                          : p.treatment === 'DEFAULT'
                            ? `Theo mặc định (${data.current?.defaultRatePercent ?? '—'}%)`
                            : `${p.ratePercent}% VAT`}
                      </strong>
                    </p>
                  </div>
                  <button className="secondary-button" onClick={() => setSelected(p)}>
                    Phân loại VAT
                  </button>
                </article>
              ))}
            </div>
            {shown.length > 12 && (
              <nav className="list-pagination" aria-label="Phân trang VAT theo món">
                <span>
                  {index * 12 + 1}–{Math.min((index + 1) * 12, shown.length)} / {shown.length} món
                </span>
                <button
                  className="secondary-button"
                  disabled={!index}
                  onClick={() => setPage(index - 1)}
                >
                  Trang trước
                </button>
                <span>
                  {index + 1} / {Math.ceil(shown.length / 12)}
                </span>
                <button
                  className="secondary-button"
                  disabled={(index + 1) * 12 >= shown.length}
                  onClick={() => setPage(index + 1)}
                >
                  Trang sau
                </button>
              </nav>
            )}
          </section>
        </>
      )}
      {policyOpen && (
        <TaxPolicyEditor
          current={replacingPolicy?.defaultRatePercent ?? data?.current?.defaultRatePercent ?? 8}
          replacing={replacingPolicy}
          close={() => setPolicyOpen(false)}
          saved={async () => {
            await load();
            await onUpdated();
          }}
        />
      )}
      {selected && (
        <ProductTaxEditor
          key={selected.id}
          row={selected}
          close={() => setSelected(undefined)}
          saved={async () => {
            await load();
            await onUpdated();
          }}
        />
      )}
    </section>
  );
}

function TaxPolicyEditor({
  current,
  replacing,
  close,
  saved,
}: {
  current: number;
  replacing?: TaxPolicy;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [rate, setRate] = useState(String(current)),
    [effectiveAt, setEffectiveAt] = useState(
      localPricingTime(replacing?.effectiveAt ?? new Date(Date.now() + 5 * 60 * 1000)),
    ),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  return (
    <Modal title="Lập chính sách VAT mới" blocking={busy} close={close}>
      <form
        ref={form}
        className="core-form pricing-editor"
        aria-busy={busy}
        onChange={() => {
          if (form.current) form.current.dataset.dirty = 'true';
          setError('');
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const starts = new Date(effectiveAt + ':00+07:00');
          if (!Number.isFinite(starts.getTime()) || starts.getTime() < Date.now() + 60000) {
            setError('Chọn thời điểm hiệu lực ít nhất một phút sau hiện tại.');
            return;
          }
          if (reason.trim().length < 5) {
            setError('Nhập căn cứ hoặc lý do thay đổi VAT, tối thiểu 5 ký tự.');
            return;
          }
          setBusy(true);
          try {
            await api('/core/admin/tax-policies', {
              effectiveAt: starts.toISOString(),
              defaultRatePercent: Number(rate),
              reason: reason.trim(),
            });
            await saved();
            if (form.current) delete form.current.dataset.dirty;
            notifySuccess('Đã lập chính sách VAT mới theo thời điểm hiệu lực.');
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Chưa lập được chính sách VAT.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>Giá bán đã gồm VAT</legend>
          {replacing && (
            <p className="context-notice">
              Phiên bản mới thay chính sách {replacing.version} tại cùng thời điểm hiệu lực. Phiên
              bản cũ được giữ để tra cứu.
            </p>
          )}
          <label>
            Mức VAT mặc định
            <select
              aria-label="Mức VAT mặc định"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            >
              {taxRateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thời điểm hiệu lực · giờ Việt Nam
            <input
              type="datetime-local"
              value={effectiveAt}
              readOnly={!!replacing}
              onChange={(e) => setEffectiveAt(e.target.value)}
              required
            />
          </label>
          <label>
            Căn cứ / lý do thay đổi
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </label>
          <p className="small-note">
            Chọn mức đúng với loại hàng và thời kỳ áp dụng. Việc phân loại riêng của món không thay
            đổi khi đổi mức mặc định.
          </p>
          <p className="context-notice">
            Chính sách mới không sửa thuế của hóa đơn đã chốt. Phiếu thanh toán nội bộ không thay
            thế hóa đơn điện tử hợp lệ.
          </p>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu chính sách VAT'}
        </button>
      </form>
    </Modal>
  );
}

function ProductTaxEditor({
  row,
  close,
  saved,
}: {
  row: TaxProduct;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [treatment, setTreatment] = useState(row.treatment),
    [rate, setRate] = useState(String(row.ratePercent ?? 10)),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  return (
    <Modal title={'Phân loại VAT — ' + row.name} blocking={busy} close={close}>
      <form
        ref={form}
        className="core-form pricing-editor"
        aria-busy={busy}
        onChange={() => {
          if (form.current) form.current.dataset.dirty = 'true';
          setError('');
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (reason.trim().length < 5) {
            setError('Nhập lý do phân loại VAT của món, tối thiểu 5 ký tự.');
            return;
          }
          setBusy(true);
          try {
            await api(
              '/core/products/' + row.id + '/tax',
              {
                treatment,
                ratePercent: treatment === 'TAXABLE' ? Number(rate) : null,
                reason: reason.trim(),
                version: row.version,
              },
              'PATCH',
            );
            await saved();
            if (form.current) delete form.current.dataset.dirty;
            notifySuccess('Đã cập nhật phân loại VAT của món.');
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Chưa cập nhật được VAT của món.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>{row.code}</legend>
          <label>
            Phân loại VAT
            <select
              aria-label="Phân loại VAT"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value as TaxProduct['treatment'])}
            >
              <option value="DEFAULT">Theo mức mặc định của nhà hàng</option>
              <option value="TAXABLE">Chịu VAT với thuế suất riêng</option>
              <option value="EXEMPT">Không chịu VAT</option>
            </select>
          </label>
          {treatment === 'TAXABLE' && (
            <label>
              Thuế suất riêng
              <select
                aria-label="Thuế suất riêng"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              >
                {taxRateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Lý do phân loại
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </label>
          <p className="context-notice">
            Không chịu VAT khác với chịu VAT ở thuế suất 0%. Thay đổi chỉ dùng cho lượt gọi mới; mức
            thuế của món đã gọi được giữ.
          </p>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu phân loại VAT'}
        </button>
      </form>
    </Modal>
  );
}
