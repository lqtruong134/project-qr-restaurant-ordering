'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, vnd } from '../shared/components';
import { Icon } from '../shared/primitives';
import { RoleVisual } from '../shared/role-visual';
import { AdminHelp } from './admin-help';
import { WorkSummary, type UrgentWork } from './operations-inbox';
import OverviewCharts from './overview-charts';

export type AdminOpen = (tab: string, section?: string) => void;
export type OverviewSnapshot = {
  updatedAt: string;
  day: string;
  timezone: string;
  tables: { total: number; occupied: number; cleaning: number; available: number };
  participants: number;
  support: { new: number; inProgress: number };
  workforce: { clockedIn: number; scheduledToday: number; pendingAttendance: number };
  finance: {
    payable: string;
    collected: string;
    refunded: string;
    outstanding: string;
    refundDue: string;
  };
  inventory: { unavailable: number; low: number; draftReceipts: number };
  topSales: { product_id: string; name: string; quantity: string; amount: string }[];
};
function Metric({
  title,
  value,
  hint,
  icon,
  onClick,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      className="stat-card stat-card-button"
      onClick={onClick}
      aria-label={`${title}: ${String(value)}. ${hint}`}
    >
      <div>
        <span className="stat-label">{title}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
      <span className="stat-icon">
        <Icon name={icon} />
      </span>
    </button>
  );
}
export default function AdminOverview({ open, work }: { open: AdminOpen; work: UrgentWork }) {
  const [data, setData] = useState<OverviewSnapshot>();
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setData(await api('/core/admin/overview'));
      setError('');
    } catch {
      setError('Chưa cập nhật được tổng quan. Chọn Làm mới để thử lại.');
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    tick();
    const timer = setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);
  return (
    <section className="admin-overview" aria-label="Tình trạng vận hành">
      <RoleVisual role="admin">
        <div className="overview-context">
          <p>
            <strong>Hôm nay{data ? ' - ' + data.day.split('-').reverse().join('/') : ''}</strong>
            <small>
              {data
                ? `Cập nhật ${new Intl.DateTimeFormat('vi-VN', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(data.updatedAt))} - ${data.timezone}`
                : 'Đang tải tình hình nhà hàng…'}
            </small>
          </p>
          <Action
            run={async () => {
              setRefreshVersion((value) => value + 1);
              await Promise.all([refresh(), work.refresh()]);
            }}
          >
            <Icon name="refresh" size={17} /> Làm mới
          </Action>
        </div>
      </RoleVisual>
      <WorkSummary work={work} choose={(kind) => open('exceptions', kind)} />
      {error && (
        <p role="alert" className="form-error">
          {error}
          {data && ' Đang hiển thị lần cập nhật gần nhất.'}
        </p>
      )}
      {!data ? (
        <p role="status">
          {error ? 'Chưa có số liệu để hiển thị.' : 'Đang tải các chỉ số vận hành…'}
        </p>
      ) : (
        <>
          <h3>Vận hành hiện tại</h3>
          <div className="stats-grid admin-snapshot-grid">
            <Metric
              title="Bàn đang phục vụ"
              value={`${data.tables.occupied} / ${data.tables.total}`}
              icon="table"
              hint={`${data.tables.cleaning} chờ dọn - ${data.tables.available} sẵn sàng - chỉ tính bàn và khu vực đang dùng`}
              onClick={() => open('tables')}
            />
            <Metric
              title="Khách đã tham gia bàn"
              value={data.participants}
              icon="people"
              hint="Số khách vào bàn trên hệ thống; có thể khác số người đang có mặt"
              onClick={() => open('tables')}
            />
            <Metric
              title="Yêu cầu hỗ trợ"
              value={data.support.new + data.support.inProgress}
              icon="bell"
              hint={
                data.support.new + data.support.inProgress
                  ? `${data.support.new} mới - ${data.support.inProgress} đang xử lý`
                  : 'Không có yêu cầu đang chờ'
              }
              onClick={() => open('reports', 'support')}
            />
            <Metric
              title="Nhân viên đang trong ca"
              value={data.workforce.clockedIn}
              icon="clock"
              hint={`${data.workforce.scheduledToday} nhân viên được phân ca hôm nay - theo ghi nhận chấm công`}
              onClick={() => open('workforce', 'attendance')}
            />
          </div>
          <OverviewCharts snapshot={data} open={open} refreshVersion={refreshVersion} />
          <div className="section-heading compact">
            <div>
              <h3>Tiền trong các phiên đang mở</h3>
              <p>
                Không gồm phiên đã kết thúc. Khoản cần hoàn và còn phải thu được tính riêng từng
                bàn.
              </p>
            </div>
            <AdminHelp topic="finance" />
          </div>
          <div className="stats-grid admin-snapshot-grid">
            <Metric
              title="Tiền món hiện tại"
              value={vnd(data.finance.payable)}
              hint="Tổng khoản phải trả sau hủy và miễn tiền"
              icon="receipt"
              onClick={() => open('reports', 'reconciliation')}
            />
            <Metric
              title="Thanh toán trước hoàn"
              value={vnd(data.finance.collected)}
              hint={`Không gồm tiền thối; chưa trừ ${vnd(data.finance.refunded)} đã hoàn tiền món`}
              icon="receipt"
              onClick={() => open('reports', 'payments')}
            />
            <Metric
              title="Còn phải thu"
              value={vnd(data.finance.outstanding)}
              hint="Tổng tiền còn thiếu của từng phiên đang mở"
              icon="warning"
              onClick={() => open('reports', 'reconciliation')}
            />
            <Metric
              title="Cần hoàn cho khách"
              value={vnd(data.finance.refundDue)}
              hint={
                BigInt(data.finance.refundDue) > 0n
                  ? 'Cần trả tiền thực tế và xác nhận giao dịch hoàn'
                  : 'Không có khoản cần hoàn trong phiên đang mở'
              }
              icon="receipt"
              onClick={() => open('exceptions', 'refund')}
            />
          </div>
          <section className="core-card overview-notices">
            <h3>Cần kiểm tra vận hành</h3>
            <div className="overview-warning-list">
              {[
                [
                  data.inventory.unavailable,
                  'nguyên liệu không còn đủ để nhận món',
                  'inventory',
                  'stock',
                ],
                [data.inventory.low, 'nguyên liệu dưới mức tồn tối thiểu', 'inventory', 'stock'],
                [
                  data.inventory.draftReceipts,
                  'phiếu nhập nháp cần kiểm tra',
                  'inventory',
                  'receipts',
                ],
                [
                  data.workforce.pendingAttendance,
                  'ca đã kết thúc chưa duyệt công',
                  'workforce',
                  'attendance',
                ],
                [data.tables.cleaning, 'bàn chờ dọn', 'tables', ''],
              ]
                .filter(([count]) => Number(count) > 0)
                .map(([count, title, tab, section]) => (
                  <button
                    key={String(title)}
                    className="secondary-button"
                    onClick={() => open(String(tab), String(section))}
                  >
                    <Icon name="warning" size={17} />
                    <span>
                      {count} {title}
                    </span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
            </div>
            {!(
              data.inventory.unavailable +
              data.inventory.low +
              data.inventory.draftReceipts +
              data.workforce.pendingAttendance +
              data.tables.cleaning
            ) && <p className="small-note">Không có cảnh báo kho, công hoặc bàn chờ dọn.</p>}
          </section>
          <div className="overview-quick-actions" aria-label="Tác vụ nhanh">
            <button className="secondary-button" onClick={() => open('exceptions', 'incident')}>
              Kiểm tra món bếp báo
            </button>
            <button className="secondary-button" onClick={() => open('inventory', 'receipts')}>
              Kiểm tra hàng nhập
            </button>
            <button className="secondary-button" onClick={() => open('workforce', 'payroll')}>
              Kiểm tra bảng lương
            </button>
          </div>
        </>
      )}
    </section>
  );
}
