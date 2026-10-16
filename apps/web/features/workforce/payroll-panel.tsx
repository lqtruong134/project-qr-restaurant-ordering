'use client';
import { ServerHistory } from '../shared/history-filters';
import { AdminHelp } from '../admin/admin-help';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Action, api, EntryForm, vnd, type Row } from '../shared/components';
import { Icon, Modal, Search, matches } from '../shared/primitives';
import { calendarDate, workforceNote } from './format';
import { downloadCsv } from './timesheet-data';
import { PayDetails } from './pay-breakdown';
import { addDays, Badge, dateLabel, duration, Hint, localDay, PanelHeading, Person } from './ui';
export type PayrollDetail = { run: Row; slips: Row[]; lines: Row[]; payments?: Row[] };
export const payrollStatus = (s: unknown) =>
  s === 'PAID' ? 'Đã chi đủ' : s === 'FINALIZED' ? 'Đã chốt' : 'Bản nháp';
export const slipPaymentLabel = (s: Row) =>
  s.payment_status === 'PAID'
    ? 'Đã chi'
    : s.payment_status === 'NOT_REQUIRED'
      ? 'Không có tiền cần chi'
      : 'Đã chốt - Chưa chi';
export const day = calendarDate;
export const periodLabel = (p: Row) =>
  `${dateLabel(day(p.period_start))}/${day(p.period_start).slice(0, 4)} – ${dateLabel(addDays(day(p.period_end), -1))}/${addDays(day(p.period_end), -1).slice(0, 4)}`;
const payTone = (s: unknown) => (s === 'PAID' ? 'green' : s === 'FINALIZED' ? 'blue' : 'amber');
export function Slip({ slip, lines, draft = false }: { slip: Row; lines: Row[]; draft?: boolean }) {
  const mine = lines.filter((l) => l.payroll_slip_id === slip.id);
  return (
    <article className="wf-payslip">
      <div className="wf-slip-heading">
        <div>
          <p className="wf-kicker">PHIẾU LƯƠNG CÁ NHÂN</p>
          <Person name={slip.employee_name_snapshot} sub={slip.username_snapshot} />
        </div>
        <Icon name="receipt" size={28} />
      </div>
      <div className="wf-table-scroll">
        <table className="wf-table wf-slip-lines">
          <thead>
            <tr>
              <th scope="col">Nội dung</th>
              <th scope="col">Công được hưởng lương</th>
              <th scope="col">Số tiền</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td data-label="Nội dung">
                    <strong>{workforceNote(l.description)}</strong>
                    <small>
                      {l.line_type === 'WORK'
                        ? 'Tiền công'
                        : l.line_type === 'BONUS'
                          ? 'Thưởng / phụ cấp'
                          : 'Khấu trừ'}
                    </small>
                  </td>
                  <td data-label="Công được hưởng lương">
                    {l.line_type === 'WORK' ? (
                      <>
                        <strong>{duration(l.minutes)}</strong>
                        <small>
                          {l.pay_snapshot
                            ? 'Đơn giá và khoản cộng thêm: xem chi tiết'
                            : `${vnd(l.hourly_rate_snapshot)} / giờ`}
                        </small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    data-label="Số tiền"
                    className={l.line_type === 'DEDUCTION' ? 'wf-money-minus' : ''}
                  >
                    <strong>{vnd(l.amount)}</strong>
                  </td>
                </tr>
                {l.line_type === 'WORK' && (l.pay_components || l.pay_snapshot) && (
                  <tr className="wf-slip-breakdown">
                    <td colSpan={3}>
                      <PayDetails components={l.pay_components} snapshot={l.pay_snapshot} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wf-slip-payment">
        <Badge tone={slip.payment_status === 'PAID' ? 'green' : 'amber'}>
          {draft ? 'Bản nháp - Chưa phải lương chính thức' : slipPaymentLabel(slip)}
        </Badge>
        {slip.paid_at && (
          <p>
            Ngày chi: {dateLabel(day(slip.paid_at))}/{day(slip.paid_at).slice(0, 4)} -{' '}
            {workforceNote(slip.payment_reference)}
          </p>
        )}
      </div>
      <div className="wf-slip-total">
        <div>
          <span>Tổng lương trên phiếu</span>
          <small>Tiền công + thưởng − khấu trừ</small>
        </div>
        <strong>{vnd(slip.total_amount)}</strong>
      </div>
    </article>
  );
}
export default function PayrollPanel() {
  const [runs, setRuns] = useState<Row[]>([]),
    [loaded, setLoaded] = useState(false),
    [detail, setDetail] = useState<PayrollDetail>(),
    [error, setError] = useState('');
  const [form, setForm] = useState<'create' | 'adjust' | 'paid'>(),
    [slipId, setSlipId] = useState(''),
    [status, setStatus] = useState('all'),
    [personSearch, setPersonSearch] = useState(''),
    [paymentFilter, setPaymentFilter] = useState('all'),
    [showSlip, setShowSlip] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setRuns(await api<Row[]>('/core/payroll'));
      setLoaded(true);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function open(id: string, keepSlip = false) {
    try {
      const result = await api<PayrollDetail>('/core/payroll/' + id);
      setDetail(result);
      setSlipId(result.slips[0]?.id ?? '');
      if (!keepSlip) {
        setShowSlip(false);
        setPersonSearch('');
        setPaymentFilter('all');
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function act(suffix: string, b: unknown) {
    await api('/core/payroll/' + detail!.run.id + suffix, b);
    await open(detail!.run.id, true);
    await refresh();
  }
  const p = detail?.run,
    slip = detail?.slips.find((s) => s.id === slipId);
  const total = (detail?.slips ?? []).reduce((n, s) => n + BigInt(String(s.total_amount)), 0n);
  const today = localDay(),
    monthStart = today.slice(0, 7) + '-01';
  const previousMonthStart = addDays(monthStart, -1).slice(0, 7) + '-01';
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {detail && p ? (
        <div className="wf-payroll-detail">
          <button className="wf-back" onClick={() => setDetail(undefined)}>
            ← Danh sách kỳ lương
          </button>
          <div className="wf-panel">
            <PanelHeading
              title={`Kỳ lương ${periodLabel(p)}`}
              description={`${detail.slips.length} nhân viên - ${p.status === 'DRAFT' ? 'Kiểm tra giờ công, thưởng và khấu trừ trước khi chốt.' : 'Xem phiếu lương và theo dõi khoản đã trả cho từng người.'}`}
            >
              <Badge tone={payTone(p.status)}>{payrollStatus(p.status)}</Badge>
              <Action run={() => open(p.id)}>
                <Icon name="refresh" size={16} />
                Tải lại
              </Action>
            </PanelHeading>
            <ol className="wf-progress" aria-label="Trạng thái kỳ lương">
              {[
                ['DRAFT', '1', 'Lập nháp', 'Đối chiếu công, thưởng và khấu trừ'],
                ['FINALIZED', '2', 'Chốt bảng lương', 'Nhân viên được xem phiếu cá nhân'],
                ['PAID', '3', 'Ghi nhận chi tiền', 'Xác nhận sau khi đã trả đủ lương'],
              ].map(([id, n, title, desc]) => (
                <li
                  key={id}
                  className={p.status === id ? 'active' : ''}
                  aria-current={p.status === id ? 'step' : undefined}
                >
                  <span>{n}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </div>
                </li>
              ))}
            </ol>
            <AdminHelp topic="payroll" />
            <div className="wf-pay-total">
              <div>
                <span>Tổng lương cả kỳ</span>
                <strong>{vnd(total)}</strong>
              </div>
              <div className="wf-actions">
                {p.status === 'DRAFT' && (
                  <>
                    <button className="secondary-button" onClick={() => setForm('adjust')}>
                      <Icon name="plus" size={16} />
                      Thưởng / khấu trừ
                    </button>
                    <Action
                      confirmLabel="Chốt bảng lương"
                      successMessage="Đã chốt bảng lương. Nhân viên có thể xem phiếu lương của mình."
                      confirmTitle="Chốt bảng lương chính thức?"
                      confirm="Chốt bảng lương? Số liệu sẽ được khóa và nhân viên được xem phiếu của mình."
                      run={() => act('/finalize', {})}
                    >
                      Chốt bảng lương
                    </Action>
                  </>
                )}
                {p.status === 'FINALIZED' && (
                  <Badge tone="amber">
                    {detail.slips.filter((s) => s.payment_status === 'PAID').length} /{' '}
                    {detail.slips.filter((s) => s.payment_status !== 'NOT_REQUIRED').length} phiếu
                    đã chi
                  </Badge>
                )}
                {p.status === 'PAID' && (
                  <Badge tone="green">
                    <Icon name="check" size={16} />
                    Đã ghi nhận chi đủ
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="wf-metrics wf-pay-metrics">
            <div>
              <span>Tiền công</span>
              <strong>
                {vnd(detail.slips.reduce((n, s) => n + BigInt(String(s.work_amount)), 0n))}
              </strong>
              <small>Từ công đã duyệt</small>
            </div>
            <div>
              <span>Thưởng − khấu trừ</span>
              <strong>
                {vnd(
                  detail.slips.reduce(
                    (n, s) =>
                      n + BigInt(String(s.bonus_amount)) - BigInt(String(s.deduction_amount)),
                    0n,
                  ),
                )}
              </strong>
              <small>Các khoản có lý do trong kỳ</small>
            </div>
            <div>
              <span>Đã ghi nhận chi</span>
              <strong>
                {vnd(
                  detail.slips
                    .filter((s) => s.payment_status === 'PAID')
                    .reduce((n, s) => n + BigInt(String(s.total_amount)), 0n),
                )}
              </strong>
              <small>
                {detail.slips.filter((s) => s.payment_status === 'PAID').length} nhân viên
              </small>
            </div>
            <div>
              <span>{p.status === 'DRAFT' ? 'Dự kiến cần chi' : 'Còn phải chi'}</span>
              <strong>
                {vnd(
                  detail.slips
                    .filter((s) => s.payment_status !== 'PAID')
                    .reduce((n, s) => n + BigInt(String(s.total_amount)), 0n),
                )}
              </strong>
              <small>
                {p.status === 'DRAFT'
                  ? 'Chưa phải lương chính thức'
                  : 'Chỉ ghi nhận sau khi trả tiền thực tế'}
              </small>
            </div>
          </div>
          <div className="wf-panel">
            <PanelHeading
              title="Bảng lương nhân viên"
              description="So sánh công, thưởng, khấu trừ và thực nhận. Mở phiếu để xem từng ca."
            >
              <button
                className="secondary-button"
                onClick={() =>
                  downloadCsv('bang-luong-' + day(p.period_start).slice(0, 7) + '.csv', [
                    [
                      'Mã nhân viên',
                      'Nhân viên',
                      'Tiền công',
                      'Thưởng',
                      'Khấu trừ',
                      'Thực nhận',
                      'Thanh toán',
                    ],
                    ...detail.slips
                      .filter(
                        (s) =>
                          matches(
                            [s.employee_name_snapshot, s.username_snapshot].join(' '),
                            personSearch,
                          ) &&
                          (paymentFilter === 'all' || s.payment_status === paymentFilter),
                      )
                      .map((s) => [
                        s.username_snapshot,
                        s.employee_name_snapshot,
                        s.work_amount,
                        s.bonus_amount,
                        s.deduction_amount,
                        s.total_amount,
                        p.status === 'DRAFT' ? 'Bản nháp' : slipPaymentLabel(s),
                      ]),
                  ])
                }
              >
                Xuất bảng lương
              </button>
            </PanelHeading>
            <div className="wf-month-filters">
              <Search
                value={personSearch}
                onChange={setPersonSearch}
                placeholder="Tìm tên hoặc mã nhân viên…"
              />
              <label>
                Thanh toán
                <select
                  aria-label="Lọc phiếu theo thanh toán"
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                >
                  <option value="all">Tất cả phiếu</option>
                  <option value="UNPAID">Chưa chi</option>
                  <option value="PAID">Đã chi</option>
                  <option value="NOT_REQUIRED">Không cần chi</option>
                </select>
              </label>
            </div>
            <div className="wf-table-scroll">
              <table className="wf-table wf-salary-table">
                <thead>
                  <tr>
                    <th scope="col">Nhân viên</th>
                    <th scope="col">Công</th>
                    <th scope="col">Tiền công</th>
                    <th scope="col">Thưởng</th>
                    <th scope="col">Khấu trừ</th>
                    <th scope="col">Thực nhận</th>
                    <th scope="col">Thanh toán</th>
                    <th scope="col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.slips
                    .filter(
                      (s) =>
                        matches(
                          [s.employee_name_snapshot, s.username_snapshot].join(' '),
                          personSearch,
                        ) &&
                        (paymentFilter === 'all' || s.payment_status === paymentFilter),
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td data-label="Nhân viên">
                          <Person name={s.employee_name_snapshot} sub={s.username_snapshot} />
                        </td>
                        <td data-label="Công">
                          {duration(
                            detail.lines
                              .filter((l) => l.payroll_slip_id === s.id && l.line_type === 'WORK')
                              .reduce((n, l) => n + Number(l.minutes), 0),
                          )}
                        </td>
                        <td data-label="Tiền công">{vnd(s.work_amount)}</td>
                        <td data-label="Thưởng">{vnd(s.bonus_amount)}</td>
                        <td data-label="Khấu trừ">{vnd(s.deduction_amount)}</td>
                        <td data-label="Thực nhận">
                          <strong>{vnd(s.total_amount)}</strong>
                        </td>
                        <td data-label="Thanh toán">
                          <Badge tone={s.payment_status === 'PAID' ? 'green' : 'amber'}>
                            {p.status === 'DRAFT' ? 'Bản nháp' : slipPaymentLabel(s)}
                          </Badge>
                          {s.paid_at && (
                            <small>
                              {dateLabel(day(s.paid_at))}/{day(s.paid_at).slice(0, 4)}
                            </small>
                          )}
                        </td>
                        <td data-label="Thao tác">
                          <button
                            className="secondary-button"
                            aria-label={'Xem phiếu ' + s.username_snapshot}
                            onClick={() => {
                              setSlipId(s.id);
                              setShowSlip(true);
                            }}
                          >
                            Xem phiếu
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!detail.slips.some(
                    (s) =>
                      matches(
                        [s.employee_name_snapshot, s.username_snapshot].join(' '),
                        personSearch,
                      ) &&
                      (paymentFilter === 'all' || s.payment_status === paymentFilter),
                  ) && (
                    <tr>
                      <td colSpan={8}>Không có phiếu phù hợp với bộ lọc.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {p.status === 'DRAFT' ? (
            <div className="wf-draft-footer">
              <p>
                Nháp chưa hiển thị cho nhân viên. Cần cập nhật giờ công? Xóa nháp rồi lập lại; công
                đã duyệt vẫn giữ.
              </p>
              <Action
                confirm="Xóa nháp và các khoản thưởng/khấu trừ đã nhập? Công đã duyệt được giữ để lập lại."
                successMessage="Đã xóa bản nháp bảng lương."
                run={async () => {
                  await api('/core/payroll/' + p.id, {}, 'DELETE');
                  setDetail(undefined);
                  await refresh();
                }}
              >
                Xóa bản nháp
              </Action>
            </div>
          ) : (
            <Hint>
              {p.status === 'PAID'
                ? 'Tất cả phiếu có tiền cần trả đã được ghi nhận chi. Chứng từ nằm trên từng phiếu.'
                : 'Bảng lương đã khóa. Chọn từng nhân viên để ghi nhận sau khi đã trả đủ tiền cho người đó. Kỳ lương chỉ chuyển sang Đã chi đủ khi mọi phiếu cần trả tiền đều được xác nhận.'}
            </Hint>
          )}
        </div>
      ) : (
        <div className="wf-panel">
          <PanelHeading
            title="Bảng lương theo kỳ"
            description="Lập từ công đã duyệt, kiểm tra từng phiếu rồi chốt bảng lương. Xác nhận đã chi sau khi trả tiền cho nhân viên."
          >
            <AdminHelp topic="payroll" />
            <button className="primary-button" onClick={() => setForm('create')}>
              <Icon name="plus" size={16} />
              Lập bảng lương nháp
            </button>
          </PanelHeading>
          <div className="wf-toolbar">
            <div className="wf-filters">
              {[
                ['all', 'Tất cả'],
                ['DRAFT', 'Bản nháp'],
                ['FINALIZED', 'Đã chốt'],
                ['PAID', 'Đã chi'],
              ].map(([id, title]) => (
                <button
                  key={id}
                  className={status === id ? 'active' : ''}
                  aria-pressed={status === id}
                  onClick={() => setStatus(id!)}
                >
                  {title}
                </button>
              ))}
            </div>
            <Action run={refresh}>
              <Icon name="refresh" size={16} />
              Làm mới
            </Action>
          </div>
          {!loaded && !error && <p role="status">Đang tải các kỳ lương…</p>}
          {loaded && (
            <ServerHistory
              kind="payroll"
              placeholder="Tìm kỳ lương hoặc nhân viên…"
              filters={{ status }}
              onReset={() => setStatus('all')}
              refreshKey={runs}
              empty="Không có kỳ lương phù hợp"
            >
              {(rows) => (
                <div className="wf-table-scroll">
                  <table className="wf-table wf-run-table">
                    <thead>
                      <tr>
                        <th scope="col">Kỳ tính lương</th>
                        <th scope="col">Nhân viên</th>
                        <th scope="col">Tổng lương</th>
                        <th scope="col">Trạng thái</th>
                        <th scope="col">
                          <span className="wf-sr-only">Thao tác</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td data-label="Kỳ tính lương">
                            <strong>{periodLabel(r)}</strong>
                          </td>
                          <td data-label="Nhân viên">{String(r.employee_count)} người</td>
                          <td data-label="Tổng lương">
                            <strong>{vnd(r.total_amount)}</strong>
                          </td>
                          <td data-label="Trạng thái">
                            <Badge tone={payTone(r.status)}>{payrollStatus(r.status)}</Badge>
                          </td>
                          <td data-label="Thao tác">
                            <button className="secondary-button" onClick={() => void open(r.id)}>
                              Xem bảng lương
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ServerHistory>
          )}
          <Hint>
            Bảng lương tính tiền công theo giờ, cộng thưởng và trừ các khoản có lý do. Thuế, bảo
            hiểm và hệ số làm thêm cần được nhà hàng xử lý riêng. Xác nhận đã chi chỉ ghi nhận tiền
            đã trả, không chuyển tiền từ ngân hàng.
          </Hint>
        </div>
      )}
      {showSlip && detail && p && slip && (
        <Modal
          title={'Phiếu lương - ' + slip.employee_name_snapshot}
          close={() => setShowSlip(false)}
        >
          <div className="wf-detail">
            <div className="wf-slip-summary">
              <span>
                Tiền công<strong>{vnd(slip.work_amount)}</strong>
              </span>
              <span>
                Thưởng<strong>{vnd(slip.bonus_amount)}</strong>
              </span>
              <span>
                Khấu trừ<strong>{vnd(slip.deduction_amount)}</strong>
              </span>
            </div>
            <Slip slip={slip} lines={detail.lines} draft={p.status === 'DRAFT'} />
            {p.status === 'FINALIZED' && slip.payment_status === 'UNPAID' && (
              <button
                className="primary-button"
                onClick={() => {
                  setShowSlip(false);
                  setForm('paid');
                }}
              >
                Ghi nhận đã chi cho nhân viên này
              </button>
            )}
          </div>
        </Modal>
      )}
      {form && (
        <Modal
          title={
            form === 'create'
              ? 'Lập bảng lương nháp'
              : form === 'adjust'
                ? 'Thêm thưởng / khấu trừ'
                : 'Ghi nhận chi lương cho nhân viên'
          }
          close={() => setForm(undefined)}
        >
          <div className="wf-form-modal">
            <p>
              {form === 'create'
                ? 'Chọn kỳ lương đã kết thúc, tối đa 62 ngày. Duyệt tất cả các ca trong kỳ trước khi lập bảng lương, kể cả ca nghỉ hoặc vắng. Ví dụ lương tháng 9: từ 01/09 đến trước 01/10.'
                : form === 'adjust'
                  ? 'Chọn phiếu của nhân viên và nhập số tiền dương. Khi chọn khấu trừ, hệ thống tự trừ khoản đó.'
                  : 'Xác nhận sau khi đã trả đủ số tiền trên phiếu cho nhân viên này. Nhập chứng từ hoặc nội dung chi để lưu lại. Thao tác này ghi nhận tiền đã trả, không thực hiện chuyển khoản.'}
            </p>
            <EntryForm
              title={
                form === 'create'
                  ? 'Khoảng ngày tính lương'
                  : form === 'adjust'
                    ? 'Nội dung khoản điều chỉnh'
                    : `${slip?.employee_name_snapshot}: ${vnd(slip?.total_amount)}`
              }
              submit={
                form === 'create'
                  ? 'Tạo bản nháp'
                  : form === 'adjust'
                    ? 'Thêm khoản'
                    : 'Xác nhận đã chi cho nhân viên'
              }
              fields={
                form === 'create'
                  ? [
                      {
                        key: 'periodStart',
                        label: 'Từ ngày (bao gồm)',
                        type: 'date',
                        value: previousMonthStart,
                      },
                      {
                        key: 'periodEnd',
                        label: 'Đến trước ngày (không bao gồm)',
                        type: 'date',
                        value: monthStart,
                      },
                    ]
                  : form === 'adjust'
                    ? [
                        {
                          key: 'slipId',
                          label: 'Phiếu của nhân viên',
                          value: slipId,
                          options: detail!.slips.map((s) => ({
                            value: s.id,
                            label: `${s.employee_name_snapshot} - ${s.username_snapshot}`,
                          })),
                        },
                        {
                          key: 'type',
                          label: 'Loại khoản',
                          options: [
                            { value: 'BONUS', label: 'Thưởng / phụ cấp' },
                            { value: 'DEDUCTION', label: 'Khấu trừ' },
                          ],
                        },
                        {
                          key: 'amount',
                          label: 'Số tiền (đồng, nhập lớn hơn 0)',
                          type: 'number',
                          min: 1,
                        },
                        { key: 'description', label: 'Nội dung và lý do' },
                      ]
                    : [{ key: 'reference', label: 'Chứng từ / nội dung chi tiền thực tế' }]
              }
              confirm={
                form === 'paid'
                  ? 'Ghi nhận đã chi đủ ' +
                    vnd(slip?.total_amount) +
                    ' cho ' +
                    String(slip?.employee_name_snapshot) +
                    '? Chỉ xác nhận khi đã thực chi. Các phiếu khác không thay đổi.'
                  : undefined
              }
              onSubmit={async (v) => {
                if (form === 'create') {
                  const run = await api<Row>('/core/payroll', v);
                  await refresh();
                  await open(run.id);
                } else
                  await act(form === 'adjust' ? '/adjustments' : '/slips/' + slip!.id + '/paid', v);
                setForm(undefined);
              }}
              successMessage={
                form === 'create'
                  ? 'Đã tạo bản nháp bảng lương.'
                  : form === 'adjust'
                    ? 'Đã lưu khoản thưởng / khấu trừ.'
                    : `Đã ghi nhận chi lương cho ${String(slip?.employee_name_snapshot)}.`
              }
            />
          </div>
        </Modal>
      )}
    </>
  );
}
