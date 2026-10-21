'use client';
import MenuPanel from './menu-panel';
import PricingPanel from './pricing-panel';
import { useCallback, useEffect, useState } from 'react';
import AdminNavigation, { adminPage } from './admin-navigation';
import TablesPanel from './tables-panel';
import WorkforcePanel from '../workforce/workforce-panel';
import type { AdminData, Inventory } from './admin-types';
import InventoryPanel from './inventory-panel';
import UsersPanel from './users-panel';
import RiskPanel from './risk-panel';
import ReportsPanel from './reports-panel';
import OnlineReconciliationPanel from './online-reconciliation-panel';
import AdminOverview from './admin-overview';
import OperationsInbox from './operations-inbox';
import StockInspection from './stock-inspection';
import { useUrgentWork, UrgentBar } from './urgent-work';
import { Search, Icon, confirmDiscard } from '../shared/primitives';
import { api, type Row } from '../shared/components';

export default function Admin() {
  const urgent = useUrgentWork();
  const [data, setData] = useState<AdminData>(),
    [error, setError] = useState(''),
    [tab, setTab] = useState('overview'),
    [section, setSection] = useState(''),
    [navigation, setNavigation] = useState(0),
    [search, setSearch] = useState(''),
    [navCollapsed, setNavCollapsed] = useState(false),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [inspection, setInspection] = useState<Row>();
  const [inspectionView, setInspectionView] = useState<'detail' | 'product' | 'inventory'>(
    'detail',
  );
  const [inspectionNotice, setInspectionNotice] = useState('');
  async function open(tab: string, section = '', keepInspection = false) {
    const page = adminPage(tab, section);
    if (['overview', 'exceptions'].includes(page.group.id)) void urgent.refresh();
    if (tab === page.group.id && tab === current.group.id && page.section === current.section) {
      if (window.innerWidth <= 800) setNavCollapsed(true);
      return;
    }
    if (!keepInspection && !(await confirmDiscard(document.querySelector('.admin-content'))))
      return false;
    if (!keepInspection) setInspection(undefined);
    setTab(page.group.id);
    setSection(page.section);
    setExpanded({ [page.group.id]: true });
    setNavigation((n) => n + 1);
    setSearch('');
    if (window.innerWidth <= 800) setNavCollapsed(true);
    if (page.group.id === 'reports') {
      setData(undefined);
      void refresh();
    }
    return true;
  }
  const refresh = useCallback(async () => {
    try {
      const [catalog, tables, areas, inventory, users, risk, outstanding] = await Promise.all([
        api<AdminData['catalog']>('/core/catalog'),
        api<Row[]>('/core/admin/tables'),
        api<Row[]>('/core/areas'),
        api<Inventory>('/core/inventory'),
        api<Row[]>('/core/users'),
        api<AdminData['risk']>('/core/risk'),
        api<Row[]>('/core/outstanding'),
      ]);
      setData({ catalog, tables, areas, inventory, users, risk, outstanding });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ.');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(path: string, body: unknown, method = 'POST') {
    await api(path, body, method);
    await refresh();
  }
  function inspect(row: Row) {
    setInspection(row);
    setInspectionView('detail');
    setInspectionNotice('');
  }
  async function inspectElsewhere(view: 'product' | 'inventory') {
    await refresh();
    await open(
      view === 'product' ? 'menu' : 'inventory',
      view === 'product' ? 'products' : 'stock',
      true,
    );
    setInspectionView(view);
  }
  async function returnToInspection(saved = false) {
    if (!saved && !(await confirmDiscard(document.querySelector('.admin-content')))) return;
    await open('exceptions', 'incident', true);
    setInspectionView('detail');
    void refresh();
  }
  const current = adminPage(tab, section);
  const showPayments =
    (tab === 'exceptions' && section === 'payment') || (tab === 'reports' && section === 'online');
  return (
    <section className={'core-app admin-layout' + (navCollapsed ? ' nav-collapsed' : '')}>
      <AdminNavigation
        tab={tab}
        section={section}
        expanded={expanded}
        expand={(id, value) => setExpanded(value ? { [id]: true } : {})}
        collapsed={navCollapsed}
        collapse={setNavCollapsed}
        open={open}
        paymentExceptionCount={urgent.paymentCases.length}
        refresh={async () => {
          await Promise.all([refresh(), urgent.refresh()]);
        }}
      />

      <div className="admin-content">
        {tab !== 'overview' && tab !== 'exceptions' && (
          <UrgentBar
            {...urgent}
            openPayments={() => {
              open('exceptions', 'payment');
            }}
            openReports={() => {
              open('exceptions', 'shortfall');
            }}
            open={() => {
              open('exceptions');
            }}
          />
        )}
        <div className="section-heading">
          <div>
            {current.group.children && (
              <p className="admin-breadcrumb">
                {current.group.label} <span aria-hidden="true">/</span>{' '}
                {current.group.children.find((child) => child.id === current.section)?.label}
              </p>
            )}
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </div>
        </div>
        {tab === 'users' && (
          <div className="toolbar">
            <Search value={search} onChange={setSearch} placeholder="Tìm theo tên hoặc mã…" />
          </div>
        )}
        {inspection && inspectionView !== 'detail' && (
          <div className="context-notice inspection-return">
            <span>
              Đang kiểm tra {String(inspection.product_name_snapshot)} - Bàn{' '}
              {String(inspection.table_code)}
            </span>
            <button className="secondary-button" onClick={() => returnToInspection()}>
              <Icon name="arrow" /> Quay lại xử lý sự cố
            </button>
          </div>
        )}
        {inspectionNotice && <p role="status">{inspectionNotice}</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {showPayments && <OnlineReconciliationPanel key={navigation} onUpdated={urgent.refresh} />}
        {!data && !showPayments ? (
          <p role="status">
            {error
              ? 'Chưa có dữ liệu để hiển thị. Chọn Tải lại dữ liệu để thử lại.'
              : 'Đang tải dữ liệu…'}
          </p>
        ) : data ? (
          <>
            {tab === 'exceptions' && section !== 'payment' && (
              <OperationsInbox
                key={navigation}
                work={urgent}
                open={open}
                initial={section}
                onNavigate={setSection}
                onInspectStock={inspect}
              />
            )}
            {tab === 'overview' && <AdminOverview work={urgent} open={open} />}
            {tab === 'menu' && (
              <MenuPanel
                key={navigation}
                initial={section}
                catalog={data.catalog}
                save={save}
                initialProductId={
                  inspection && inspectionView === 'product'
                    ? String(inspection.product_id ?? '')
                    : undefined
                }
                onProductSaved={
                  inspection && inspectionView === 'product'
                    ? () => returnToInspection(true)
                    : undefined
                }
                onProductClose={
                  inspection && inspectionView === 'product'
                    ? () => returnToInspection(true)
                    : undefined
                }
              />
            )}
            {tab === 'pricing' && (
              <PricingPanel
                key={navigation}
                initial={section}
                catalog={data.catalog}
                onUpdated={refresh}
              />
            )}
            {tab === 'tables' && (
              <TablesPanel key={navigation} initial={section} data={data} save={save} />
            )}
            {tab === 'inventory' && (
              <InventoryPanel
                key={navigation}
                initial={section}
                initialProductId={
                  inspection && inspectionView === 'inventory'
                    ? String(inspection.product_id ?? '')
                    : undefined
                }
                data={data}
                save={save}
                onNavigate={setSection}
              />
            )}
            {tab === 'users' && <UsersPanel data={data} search={search} save={save} />}
            {tab === 'workforce' && (
              <WorkforcePanel
                key={navigation}
                initial={section}
                users={data.users}
                areas={data.areas}
              />
            )}
            {tab === 'risk' && (
              <RiskPanel key={navigation} initial={section} data={data} save={save} />
            )}
            {tab === 'reports' && section !== 'online' && (
              <ReportsPanel key={navigation} initial={section} open={open} save={save} />
            )}
          </>
        ) : null}
        {inspection && (
          <StockInspection
            key={String(inspection.id)}
            row={inspection}
            visible={inspectionView === 'detail'}
            close={() => setInspection(undefined)}
            editProduct={() => inspectElsewhere('product')}
            inspectInventory={() => inspectElsewhere('inventory')}
            refresh={async () => {
              await Promise.all([refresh(), urgent.refresh()]);
            }}
            complete={(message) => {
              setInspection(undefined);
              setInspectionNotice(message);
            }}
          />
        )}
      </div>
    </section>
  );
}
