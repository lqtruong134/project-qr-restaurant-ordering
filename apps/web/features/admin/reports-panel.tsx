'use client';
import { SessionReference } from '../shared/session-reference';
import { supportLabels } from '../shared/support-labels';
import { HistoryList } from '../shared/history-filters';
import { useEffect, useState } from 'react';
import { supportStatuses } from '@thesis/contracts';
import { AdminHelp } from './admin-help';
import type { AdminOpen } from './admin-overview';
import Receipt, { type Bill } from '../workspace/receipt';
import { SupportHistory } from '../workspace/support-history';
import { Empty, Modal } from '../shared/primitives';
import { OrderExceptions } from './order-exceptions';
import type { AdminData, SaveAdmin } from './admin-types';
import { Action, api, EntryForm, vnd, label, type Row } from '../shared/components';
import { restaurantDateTime } from '../shared/restaurant-time';
import {
  defaultReportQuery,
  ReportBadge,
  ReportCell,
  ReportControls,
  ReportMetrics,
  ReportPagination,
  ReportTable,
  type ReportData,
  type ReportQuery,
} from './report-ui';
import { ReportBars, ReportTrend } from './report-charts';

const methodName = (name: string) =>
  ({ CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', ONLINE: 'Online (payOS)' })[name] ?? name;
const scopes: Record<string, string> = {
  sales:
    'Theo thời điểm phục vụ món. Doanh số đã trừ khuyến mãi và miễn tiền, còn bao gồm VAT. Lãi gộp chỉ tính khi có đủ dữ liệu tách VAT, chưa trừ lương và chi phí vận hành; giá vốn vẫn gồm nguyên liệu đã sử dụng. Tên và giá món giữ tại lúc khách gọi.',
  payments:
    'Theo thời điểm thu hoặc hoàn tiền thành công. Tiền khách đưa và tiền thừa không cộng vào số tiền đã thu. Thu trừ hoàn trong kỳ có thể âm, không dùng số này thay cho doanh số bán món.',
  reconciliation:
    'Chọn kỳ theo ngày mở phiên; các số tiền thể hiện kết quả đối chiếu hiện tại của những phiên đó. Phiên đã đủ tiền vẫn có thể chưa hoàn tất phục vụ.',
  outstanding:
    'Theo ngày lập hồ sơ. Trạng thái thể hiện kết quả xử lý hiện tại; các việc đang chờ quản trị nằm ở mục Việc cần xử lý.',
  support:
    'Theo ngày khách gửi yêu cầu, gồm cả phiên đã kết thúc. Quản trị xem lịch sử; nhân viên phụ trách thực hiện xử lý.',
};
const titles: Record<string, string> = {
  sales: 'Chi tiết doanh số theo món',
  payments: 'Giao dịch thu & hoàn tiền',
  reconciliation: 'Đối chiếu theo từng phiên bàn',
  outstanding: 'Hồ sơ thiếu tiền & lịch sử xử lý',
  support: 'Hỗ trợ tại bàn & lịch sử bàn giao',
};
const chronological = [
  { value: 'newest', label: 'Mới nhất trước' },
  { value: 'oldest', label: 'Cũ nhất trước' },
];

export default function ReportsPanel({
  save,
  initial = 'sales',
  open,
}: {
  data: Pick<AdminData, 'reports' | 'outstanding'>;
  save: SaveAdmin;
  initial?: string;
  open: AdminOpen;
}) {
  const [view] = useState(
    ['sales', 'payments', 'reconciliation', 'outstanding', 'exceptions', 'support'].includes(
      initial,
    )
      ? initial
      : 'sales',
  );
  const [query, setQuery] = useState<ReportQuery>({
    ...defaultReportQuery,
    sort: view === 'sales' ? 'amount' : 'newest',
  });
  const [data, setData] = useState<ReportData>(),
    [options, setOptions] = useState<NonNullable<ReportData['options']>>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<{ bill: Bill; exceptions: Row[]; row: Row } | null>(null),
    [shortfall, setShortfall] = useState<Row>();
  const change = (value: Partial<ReportQuery>) => setQuery((q) => ({ ...q, ...value }));
  useEffect(() => {
    if (view === 'exceptions') return;
    let active = true;
    setBusy(true);
    setError('');
    setData(undefined);
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ view, ...query, page: String(query.page) });
        void api<ReportData>('/core/admin/reports?' + params)
          .then((result) => {
            if (!active) return;
            if (query.page > 1 && query.page > Math.ceil(result.total / result.pageSize)) {
              setQuery((q) => ({ ...q, page: 1 }));
              return;
            }
            setData(result);
            if (result.options) {
              setOptions((previous) => {
                const selected = previous.find(
                  (option) => (option.id ?? 'uncategorized') === query.filter,
                );
                const present = result.options!.some(
                  (option) => (option.id ?? 'uncategorized') === query.filter,
                );
                return selected && !present ? [...result.options!, selected] : result.options!;
              });
            }
          })
          .catch((e) => {
            if (active) setError((e as Error).message);
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      },
      query.search ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [view, query, revision]);
  if (view === 'exceptions')
    return (
      <section className="admin-reports">
        <OrderExceptions open={open} />
      </section>
    );
  const filters =
    view === 'sales'
      ? options.map((o) => ({ value: o.id ?? 'uncategorized', label: o.name }))
      : view === 'payments'
        ? ['CASH', 'BANK_TRANSFER', 'ONLINE'].map((value) => ({ value, label: methodName(value) }))
        : view === 'reconciliation'
          ? [
              { value: 'due', label: 'Còn phải thu' },
              { value: 'refund', label: 'Cần hoàn khách' },
              { value: 'balanced', label: 'Đủ tiền, không cần hoàn' },
            ]
          : view === 'outstanding'
            ? ['PENDING_ADMIN_REVIEW', 'IN_RECOVERY', 'RECOVERED', 'WRITTEN_OFF'].map((value) => ({
                value,
                label: label(value),
              }))
            : Object.entries(supportLabels).map(([value, text]) => ({ value, label: text }));
  const statuses =
    view === 'payments'
      ? [
          { value: 'PAYMENT', label: 'Đã thu' },
          { value: 'REFUND', label: 'Đã hoàn' },
        ]
      : view === 'support'
        ? Object.entries(supportStatuses).map(([value, text]) => ({ value, label: text }))
        : [];
  const sorts =
    view === 'sales'
      ? [
          { value: 'amount', label: 'Doanh số cao nhất' },
          { value: 'quantity', label: 'Số lượng nhiều nhất' },
          { value: 'name', label: 'Tên món A–Z' },
        ]
      : [
          ...chronological,
          ...(view === 'payments' || view === 'outstanding'
            ? [{ value: 'amount', label: 'Số tiền cao nhất' }]
            : view === 'reconciliation'
              ? [{ value: 'balance', label: 'Chênh lệch lớn nhất' }]
              : []),
        ];
  const s = data?.summary ?? {},
    metric = (key: string): string | number | null => {
      const value = s[key];
      return typeof value === 'string' || typeof value === 'number'
        ? value
        : value === null
          ? null
          : 0;
    };
  const vatKnown = s.legacyTaxUnavailable === false && s.beforeVatSales != null;
  const metrics =
    view === 'sales'
      ? [
          {
            label: 'Tiền món trước khuyến mãi',
            value: metric('subtotal'),
            money: true,
            hint: 'Các món đã phục vụ, sau miễn và hủy',
          },
          {
            label: 'Khuyến mãi đã giảm',
            value: metric('discountAmount'),
            money: true,
            hint: 'Đã phân bổ theo từng món',
          },
          {
            label: 'Doanh số sau giảm, gồm VAT',
            value: metric('sales'),
            money: true,
            hint: 'Số tiền món sau khuyến mãi và miễn tiền',
          },
          {
            label: 'VAT trong doanh số',
            value: vatKnown ? metric('vat') : null,
            money: true,
            hint: vatKnown
              ? 'Đã nằm trong giá bán, không cộng thêm'
              : 'Có món chưa có dữ liệu tách VAT trong kỳ',
          },
          {
            label: 'Doanh số chưa VAT',
            value: vatKnown ? metric('beforeVatSales') : null,
            money: true,
            hint: 'Doanh số sau giảm, đã trừ VAT',
          },
          {
            label: 'Giá vốn nguyên liệu',
            value: metric('cost'),
            money: true,
            hint: 'Theo giá vốn ghi nhận khi chế biến',
          },
          {
            label: 'Lãi gộp trước chi phí vận hành',
            value: vatKnown ? metric('margin') : null,
            money: true,
            hint: 'Doanh số chưa VAT trừ giá vốn; chưa trừ lương',
          },
          { label: 'Số món đã phục vụ', value: metric('quantity'), hint: 'Gồm món được miễn tiền' },
        ]
      : view === 'payments'
        ? [
            {
              label: 'Thanh toán tiền món',
              value: metric('collected'),
              money: true,
              hint: 'Giao dịch thành công; không gồm tiền thối, chưa trừ tiền hoàn',
            },
            {
              label: 'Đã hoàn tiền món',
              value: metric('refunded'),
              money: true,
              hint: 'Đã xác nhận hoàn thực tế',
            },
            {
              label: 'Thu trừ hoàn trong kỳ',
              value: metric('net'),
              money: true,
              hint: 'Không phải doanh số món',
            },
            {
              label: 'Giao dịch thành công',
              value: metric('transactions'),
              hint: 'Tổng lượt thu và hoàn tiền',
            },
          ]
        : view === 'reconciliation'
          ? [
              {
                label: 'Phiên bàn trong kỳ',
                value: metric('sessions'),
                hint: 'Theo ngày mở phiên',
              },
              {
                label: 'Phiên đã đủ tiền',
                value: metric('balanced'),
                hint: 'Không còn thiếu hoặc cần hoàn',
              },
              {
                label: 'Còn phải thu',
                value: metric('outstanding'),
                money: true,
                hint: 'Của các phiên được chọn',
              },
              {
                label: 'Cần hoàn khách',
                value: metric('refundDue'),
                money: true,
                hint: 'Chưa xác nhận hoàn đủ',
              },
            ]
          : view === 'outstanding'
            ? [
                { label: 'Hồ sơ trong kỳ', value: metric('cases'), hint: 'Theo ngày lập hồ sơ' },
                {
                  label: 'Hồ sơ đang mở',
                  value: metric('open'),
                  hint: 'Chờ quyết định hoặc đang thu hồi',
                },
                {
                  label: 'Tiền đang thiếu',
                  value: metric('outstanding'),
                  money: true,
                  hint: 'Chỉ tính hồ sơ đang mở',
                },
                {
                  label: 'Tổn thất đã chấp nhận',
                  value: metric('writtenOff'),
                  money: true,
                  hint: 'Quyết định đã được ghi nhận',
                },
              ]
            : [
                {
                  label: 'Yêu cầu trong kỳ',
                  value: metric('requests'),
                  hint: 'Theo ngày khách gửi',
                },
                { label: 'Chưa nhận', value: metric('new'), hint: 'Chờ nhân viên tiếp nhận' },
                { label: 'Đang xử lý', value: metric('inProgress'), hint: 'Đã có người phụ trách' },
                {
                  label: 'Đã giải quyết',
                  value: metric('done'),
                  hint: 'Đã xác nhận hoàn tất hỗ trợ',
                },
              ];
  const loadReceipt = async (row: Row) =>
    setDetail({
      ...(await api<{ bill: Bill; exceptions: Row[] }>(
        '/core/reports/sessions/' + (row.session_id ?? row.id),
      )),
      row,
    });
  return (
    <section className="admin-reports" aria-label="Báo cáo quản trị">
      <ReportControls
        query={query}
        change={change}
        refresh={() => setRevision((r) => r + 1)}
        busy={busy}
        scope={data?.scope}
        placeholder={
          view === 'sales' ? 'Tìm tên món…' : 'Tìm bàn, mã phiên hoặc thông tin liên quan…'
        }
        filters={filters}
        statuses={statuses}
        sorts={sorts}
      />
      <div className="report-context">
        <p>{scopes[view]}</p>
        {view !== 'support' && <AdminHelp topic="finance" />}
      </div>
      {error && (
        <div className="core-card report-error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRevision((r) => r + 1)}>
            Thử lại
          </button>
        </div>
      )}
      {busy && (
        <div className="report-loading core-card" role="status">
          Đang lấy báo cáo theo kỳ đã chọn…
        </div>
      )}
      {data && (
        <>
          <ReportMetrics items={metrics} />
          {(view === 'sales' || view === 'payments') && (
            <div className="report-charts">
              <ReportTrend
                key={`${view}-${query.period}-${data.scope.startDay}-${data.scope.endDay}`}
                title={
                  view === 'sales'
                    ? 'Doanh số gồm VAT & giá vốn theo thời gian'
                    : 'Thu & hoàn tiền theo thời gian'
                }
                series={data.series ?? []}
                primary={view === 'sales' ? 'Doanh số gồm VAT' : 'Đã thu'}
                secondary={view === 'sales' ? 'Giá vốn' : 'Đã hoàn'}
              />
              <ReportBars
                title={
                  view === 'sales'
                    ? '5 món có doanh số cao nhất trong kỳ'
                    : 'Tiền đã thu theo phương thức'
                }
                items={data.breakdown ?? []}
                label={view === 'payments' ? methodName : undefined}
              />
            </div>
          )}
          <section className="core-card report-results">
            <div className="report-results-heading">
              <h2>{titles[view]}</h2>
              <span>{data.total} kết quả</span>
            </div>
            {!data.rows.length ? (
              <Empty title="Không có kết quả phù hợp">
                Chọn kỳ khác hoặc xóa bộ lọc để xem các dữ liệu còn lại.
              </Empty>
            ) : view === 'sales' ? (
              <ReportTable
                title={titles[view]!}
                columns={[
                  { label: 'Món / danh mục', width: 25 },
                  { label: 'Số lượng', width: 8, numeric: true },
                  { label: 'Doanh số sau giảm', width: 18, numeric: true },
                  { label: 'VAT / doanh số chưa VAT', width: 20, numeric: true },
                  { label: 'Giá vốn', width: 13, numeric: true },
                  { label: 'Lãi gộp', width: 16, numeric: true },
                ]}
              >
                {data.rows.map((r) => {
                  const rowVatKnown = r.legacyTaxUnavailable === false && r.beforeVatSales != null;
                  return (
                    <tr key={r.id}>
                      <ReportCell label="Món / danh mục">
                        <strong>{String(r.name)}</strong>
                        <small>{String(r.category)}</small>
                      </ReportCell>
                      <ReportCell label="Số lượng" numeric>
                        {String(r.quantity)}
                      </ReportCell>
                      <ReportCell label="Doanh số sau giảm" numeric>
                        <strong>{vnd(r.sales)}</strong>
                        <small>Đã gồm VAT</small>
                        {BigInt(String(r.discountAmount ?? 0)) > 0n && (
                          <small>Khuyến mãi −{vnd(r.discountAmount)}</small>
                        )}
                      </ReportCell>
                      <ReportCell label="VAT / doanh số chưa VAT" numeric>
                        {rowVatKnown ? (
                          <>
                            <strong>VAT {vnd(r.vat)}</strong>
                            <small>Chưa VAT {vnd(r.beforeVatSales)}</small>
                          </>
                        ) : (
                          <span className="report-unavailable">Chưa có dữ liệu tách VAT</span>
                        )}
                      </ReportCell>
                      <ReportCell label="Giá vốn" numeric>
                        {vnd(r.cost)}
                      </ReportCell>
                      <ReportCell label="Lãi gộp" numeric>
                        {rowVatKnown && r.margin != null ? (
                          vnd(r.margin)
                        ) : (
                          <span className="report-unavailable">Chưa có dữ liệu tách VAT</span>
                        )}
                        <small>Trước chi phí vận hành</small>
                      </ReportCell>
                    </tr>
                  );
                })}
              </ReportTable>
            ) : view === 'payments' ? (
              <ReportTable
                title={titles[view]!}
                columns={[
                  { label: 'Bàn / phiếu', width: 23 },
                  { label: 'Thời gian', width: 20 },
                  { label: 'Giao dịch', width: 25 },
                  { label: 'Số tiền', width: 18, numeric: true },
                  { label: 'Chi tiết', width: 14 },
                ]}
              >
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <ReportCell label="Bàn / phiếu">
                      <strong>
                        Bàn {String(r.table_code)}
                        <SessionReference id={r.session_id} />
                      </strong>
                      {r.receipt_number && <small>{String(r.receipt_number)}</small>}
                    </ReportCell>
                    <ReportCell label="Thời gian">{restaurantDateTime(r.at)}</ReportCell>
                    <ReportCell label="Giao dịch">
                      <ReportBadge tone={r.kind === 'REFUND' ? 'warning' : 'success'}>
                        {r.kind === 'REFUND' ? 'Đã hoàn' : 'Đã thu'}
                      </ReportBadge>
                      <span>{methodName(String(r.method))}</span>
                      <small>{String(r.actor ?? 'Hệ thống')}</small>
                    </ReportCell>
                    <ReportCell label="Số tiền" numeric>
                      {vnd(r.amount)}
                    </ReportCell>
                    <ReportCell label="Chi tiết">
                      <Action run={() => loadReceipt(r)}>Xem phiếu</Action>
                    </ReportCell>
                  </tr>
                ))}
              </ReportTable>
            ) : view === 'reconciliation' ? (
              <ReportTable
                title={titles[view]!}
                columns={[
                  { label: 'Bàn / phiên', width: 26 },
                  { label: 'Tổng thanh toán', width: 17, numeric: true },
                  { label: 'Thanh toán sau hoàn', width: 17, numeric: true },
                  { label: 'Đối chiếu', width: 24, numeric: true },
                  { label: 'Chi tiết', width: 16 },
                ]}
              >
                {data.rows.map((r) => {
                  const balance = BigInt(String(r.balance));
                  return (
                    <tr key={r.id}>
                      <ReportCell label="Bàn / phiên">
                        <strong>
                          Bàn {String(r.table_code)}
                          <SessionReference id={r.id} />
                        </strong>
                        {r.receipt_number && <small>{String(r.receipt_number)}</small>}
                        <small>Mở {restaurantDateTime(r.at)}</small>
                      </ReportCell>
                      <ReportCell label="Tổng thanh toán" numeric>
                        <strong>{vnd(r.payable)}</strong>
                        {BigInt(String(r.discountAmount ?? 0)) > 0n && (
                          <small>Khuyến mãi −{vnd(r.discountAmount)}</small>
                        )}
                        <small>
                          {r.legacyTaxUnavailable === false
                            ? `Đã gồm VAT ${vnd(r.vat)}`
                            : 'Chưa có dữ liệu tách VAT'}
                        </small>
                      </ReportCell>
                      <ReportCell label="Thanh toán sau hoàn" numeric>
                        {vnd(BigInt(String(r.collected)) - BigInt(String(r.refunded ?? 0)))}
                        {BigInt(String(r.refunded ?? 0)) > 0n && (
                          <small>
                            Trước hoàn {vnd(r.collected)} · Đã hoàn {vnd(r.refunded)}
                          </small>
                        )}
                      </ReportCell>
                      <ReportCell label="Đối chiếu" numeric>
                        <strong>{vnd(balance < 0n ? -balance : balance)}</strong>
                        <ReportBadge
                          tone={balance < 0n ? 'danger' : balance > 0n ? 'warning' : 'success'}
                        >
                          {balance < 0n
                            ? 'Cần hoàn khách'
                            : balance > 0n
                              ? 'Còn phải thu'
                              : 'Cân bằng tiền'}
                        </ReportBadge>
                      </ReportCell>
                      <ReportCell label="Chi tiết">
                        <Action run={() => loadReceipt(r)}>Xem đối soát</Action>
                      </ReportCell>
                    </tr>
                  );
                })}
              </ReportTable>
            ) : view === 'outstanding' ? (
              <ReportTable
                title={titles[view]!}
                columns={[
                  { label: 'Bàn / hồ sơ', width: 26 },
                  { label: 'Số tiền thiếu', width: 20, numeric: true },
                  { label: 'Trạng thái', width: 30 },
                  { label: 'Chi tiết', width: 24 },
                ]}
              >
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <ReportCell label="Bàn / hồ sơ">
                      <strong>
                        Bàn {String(r.table_code)}
                        <SessionReference id={r.session_id} />
                      </strong>
                      <small>{restaurantDateTime(r.at)}</small>
                    </ReportCell>
                    <ReportCell label="Số tiền thiếu" numeric>
                      {vnd(r.outstanding_amount)}
                    </ReportCell>
                    <ReportCell label="Trạng thái">
                      <ReportBadge
                        tone={
                          ['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(r.status))
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {label(r.status)}
                      </ReportBadge>
                      <small>{String(r.notes ?? 'Chưa có ghi chú')}</small>
                    </ReportCell>
                    <ReportCell label="Chi tiết">
                      <button className="secondary-button" onClick={() => setShortfall(r)}>
                        Xem hồ sơ
                      </button>
                    </ReportCell>
                  </tr>
                ))}
              </ReportTable>
            ) : (
              <ReportTable
                title={titles[view]!}
                columns={[
                  { label: 'Bàn / thời gian', width: 22 },
                  { label: 'Yêu cầu', width: 26 },
                  { label: 'Người phụ trách', width: 21 },
                  { label: 'Trạng thái', width: 18 },
                  { label: 'Lịch sử', width: 13 },
                ]}
              >
                {data.rows.map((r) => (
                  <tr key={r.id} className="support-task">
                    <ReportCell label="Bàn / thời gian">
                      <strong>
                        Bàn {String(r.table_code)}
                        <SessionReference id={r.session_id} />
                      </strong>
                      <small>{restaurantDateTime(r.at)}</small>
                    </ReportCell>
                    <ReportCell label="Yêu cầu">
                      <strong>{supportLabels[String(r.request_type)]}</strong>
                      <small>{String(r.content ?? '')}</small>
                    </ReportCell>
                    <ReportCell label="Người phụ trách">
                      {String(r.acknowledged_by_name ?? 'Chưa có người phụ trách')}
                    </ReportCell>
                    <ReportCell label="Trạng thái">
                      <ReportBadge
                        tone={
                          r.status === 'NEW'
                            ? 'warning'
                            : r.status === 'RESOLVED'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {supportStatuses[String(r.status)] ?? String(r.status)}
                      </ReportBadge>
                    </ReportCell>
                    <ReportCell label="Lịch sử">
                      <SupportHistory id={r.id} admin />
                    </ReportCell>
                  </tr>
                ))}
              </ReportTable>
            )}
            <ReportPagination
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              change={(page) => change({ page })}
            />
          </section>
        </>
      )}
      {detail && (
        <Modal title="Chi tiết đối soát phiên bàn" wide close={() => setDetail(null)}>
          {view === 'reconciliation' && (
            <ReportMetrics
              items={['refunded', 'reversed', 'written_off', 'stock_loss'].map((key, i) => ({
                label: [
                  'Đã hoàn khách',
                  'Đã miễn / hủy',
                  'Tổn thất đã chấp nhận',
                  'Tổn thất nguyên liệu',
                ][i]!,
                value: String(detail.row[key] ?? 0),
                money: true,
                hint: 'Trong phiên được chọn',
              }))}
            />
          )}
          <Receipt bill={detail.bill} visible />
          <h3>Lịch sử quyết định món và khoản thu</h3>
          <HistoryList
            items={detail.exceptions}
            date={(e) => e.created_at}
            search={(e) => [e.reason, e.display_name].join(' ')}
          >
            {(rows) => (
              <>
                {rows.map((e, i) => (
                  <p key={i}>
                    {String(e.reason)} - {String(e.display_name)} -{' '}
                    {restaurantDateTime(e.created_at)}
                  </p>
                ))}
              </>
            )}
          </HistoryList>
        </Modal>
      )}
      {shortfall && (
        <Modal
          title={'Hồ sơ thiếu tiền - Bàn ' + String(shortfall.table_code)}
          close={() => setShortfall(undefined)}
        >
          <p>
            {vnd(shortfall.outstanding_amount)} - {label(shortfall.status)}
          </p>
          <p>{String(shortfall.notes ?? 'Chưa có ghi chú')}</p>
          {['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(shortfall.status)) && (
            <EntryForm
              title="Quyết định khoản tiền còn thiếu"
              fields={[{ key: 'reason', label: 'Lý do xử lý' }]}
              submit="Chấp nhận tổn thất"
              confirmLabel="Xác nhận chấp nhận tổn thất"
              confirm={`Nhà hàng chấp nhận không thu hồi ${vnd(shortfall.outstanding_amount)} còn thiếu. Nếu các công việc khác đã hoàn tất, bàn sẽ kết thúc lượt phục vụ và chuyển sang Chờ dọn. Lịch sử và tiền đã thu vẫn được giữ.`}
              onSubmit={async (value) => {
                await save('/core/outstanding/' + shortfall.id + '/write-off', value);
                setShortfall(undefined);
                setRevision((r) => r + 1);
              }}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
