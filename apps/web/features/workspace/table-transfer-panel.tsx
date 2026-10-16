'use client';
import { HistoryList } from '../shared/history-filters';
import { tableTransferPolicy, type TableTransferReason } from '@thesis/contracts';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';
import { transferTargets, filterTargets } from './table-transfer-data';

export default function TableTransferPanel({
  table,
  tables,
  refresh,
  done,
}: {
  table: Row;
  tables: Row[];
  refresh: () => Promise<void>;
  done: (message: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'pick' | 'review' | 'history' | null>(null);
  const [source, setSource] = useState<Row>(table);
  const [guests, setGuests] = useState('1'),
    [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState(''),
    [area, setArea] = useState('');
  const [reason, setReason] = useState<TableTransferReason>('CUSTOMER_REQUEST'),
    [note, setNote] = useState('');
  const [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [selectionNotice, setSelectionNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Row[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState('');
  const transferButton = useRef<HTMLButtonElement>(null),
    historyButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null),
    dialogAction = useRef<'pick' | 'history'>('pick');
  const guestCount = Number(guests);
  const targets = transferTargets(tables, source, guestCount);
  const visible = filterTargets(targets, search, area);
  const chosen = targets.find((t) => t.id === selectedId);
  const stale = source.id !== table.id;
  const areas = [
    ...new Map(
      tables
        .filter((t) => t.is_active === true && t.area_active === true)
        .map((t) => [String(t.area_id), String(t.area_name)]),
    ).entries(),
  ];

  useEffect(() => {
    if (mode === 'review') cancelButton.current?.focus();
  }, [mode]);
  function changeFilter(nextSearch: string, nextArea: string) {
    if (chosen && !filterTargets([chosen], nextSearch, nextArea).length) {
      setSelectedId('');
      setSelectionNotice('Bàn đã chọn nằm ngoài bộ lọc mới. Vui lòng chọn lại bàn.');
    }
    setSearch(nextSearch);
    setArea(nextArea);
  }
  function close() {
    setMode(null);
    requestAnimationFrame(() =>
      (dialogAction.current === 'pick' ? transferButton : historyButton).current?.focus(),
    );
  }
  function open(next: 'pick' | 'history') {
    dialogAction.current = next;
    setSource({ ...table });
    setGuests(
      String(Math.max(1, Math.min(tableTransferPolicy.maxGuests, Number(table.participants) || 1))),
    );
    setSelectedId('');
    setSearch('');
    setArea('');
    setReason('CUSTOMER_REQUEST');
    setNote('');
    setError('');
    setSelectionNotice('');
    setMode(next);
    void refresh().catch(() => setError('Chưa tải được danh sách bàn mới. Vui lòng thử lại.'));
  }
  useEffect(() => {
    if (!mode || mode === 'history' || !selectedId || busy) return;
    if (!transferTargets(tables, source, Number(guests)).some((t) => t.id === selectedId)) {
      setSelectedId('');
      setMode('pick');
      setSelectionNotice(
        'Bàn đã chọn không còn phù hợp với dữ liệu hiện tại. Vui lòng chọn bàn khác.',
      );
    }
  }, [tables, source, guests, selectedId, mode, busy]);
  useEffect(() => {
    if (mode !== 'history') return;
    let active = true;
    setHistory([]);
    setHistoryBusy(true);
    setHistoryError('');
    void api<Row[]>('/core/sessions/' + table.session_id + '/transfers')
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      })
      .finally(() => {
        if (active) setHistoryBusy(false);
      });
    return () => {
      active = false;
    };
  }, [mode, table.session_id]);
  function changeGuests(value: string) {
    const selected = tables.find((t) => t.id === selectedId);
    if (selected && Number(selected.capacity) < Number(value)) {
      setSelectionNotice(
        `Bạn đã đổi số khách thành ${value}. Bàn ${selected.name} chỉ có ${selected.capacity} chỗ nên không còn phù hợp.`,
      );
      setSelectedId('');
    } else setSelectionNotice('');
    setGuests(value);
  }
  function review(e: FormEvent) {
    e.preventDefault();
    if (!chosen || stale) return;
    if (reason === 'OTHER' && !note.trim()) {
      setError('Vui lòng nhập nội dung lý do chuyển bàn.');
      return;
    }
    setError('');
    setMode('review');
  }
  async function transfer() {
    if (!chosen || stale || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/core/sessions/' + source.session_id + '/transfer', {
        fromTableId: source.id,
        tableId: chosen.id,
        partySize: guestCount,
        reasonCode: reason,
        note: note.trim(),
      });
      const message = `Đã chuyển ${source.name} → ${chosen.name}. Phiên phục vụ, món đã gọi và thanh toán được giữ nguyên.`;
      setFeedback(message);
      // The mutation succeeded even if a subsequent refresh loses the connection.
      setMode(null);
      try {
        await done(message);
      } catch {
        setFeedback(message + ' Chưa tải lại được màn hình; hãy bấm Tải lại.');
      }
      requestAnimationFrame(() => transferButton.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa chuyển được bàn. Vui lòng thử lại.');
      setSelectedId('');
      setMode('pick');
      try {
        await refresh();
      } catch {
        setError((previous) => previous + ' Chưa tải lại được danh sách bàn.');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="transfer-entry" aria-label="Chuyển bàn và lịch sử">
      <div>
        <strong>Chuyển cả bữa ăn sang bàn khác</strong>
        <p>Giữ nguyên khách, giỏ, món và thanh toán.</p>
      </div>
      <div className="transfer-entry-actions">
        <button ref={transferButton} className="secondary-button" onClick={() => open('pick')}>
          <Icon name="arrow" />
          Chuyển bàn
        </button>
        <button ref={historyButton} className="secondary-button" onClick={() => open('history')}>
          <Icon name="clock" />
          Lịch sử chuyển bàn
        </button>
      </div>
      {feedback && (
        <p role="status" className="transfer-success">
          {feedback}
        </p>
      )}
      {mode &&
        createPortal(
          <Modal
            wide
            title={
              mode === 'history'
                ? 'Lịch sử chuyển của phiên'
                : mode === 'review'
                  ? 'Xác nhận chuyển bàn'
                  : 'Chọn bàn để chuyển'
            }
            close={close}
            blocking={busy}
          >
            <div className="transfer-workflow">
              {mode === 'history' ? (
                <>
                  <p className="transfer-caption">
                    Các lần chuyển của cùng phiên phục vụ - Mới nhất trước
                  </p>
                  {historyBusy && <p role="status">Đang tải lịch sử…</p>}
                  {historyError && (
                    <p role="alert" className="form-error">
                      {historyError}
                    </p>
                  )}
                  {!historyBusy && !historyError && !history.length && (
                    <Empty icon="clock" title="Phiên này chưa từng chuyển bàn." />
                  )}
                  <HistoryList
                    items={history}
                    date={(h) => h.transferred_at}
                    search={(h) =>
                      [h.from_name, h.to_name, h.employee_name, h.username, h.reason].join(' ')
                    }
                    placeholder="Tìm bàn, nhân viên hoặc lý do chuyển…"
                  >
                    {(rows) => (
                      <ol className="transfer-timeline">
                        {rows.map((h) => (
                          <li key={h.id}>
                            <time dateTime={String(h.transferred_at)}>
                              {restaurantDateTime(h.transferred_at)}
                            </time>
                            <h3>
                              {String(h.from_name)} <Icon name="arrow" /> {String(h.to_name)}
                            </h3>
                            <p>
                              <strong>Người thực hiện:</strong> {String(h.employee_name)} (
                              {String(h.username)})
                            </p>
                            <p>
                              <strong>Lý do:</strong> {String(h.reason)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </HistoryList>
                  <div className="transfer-footer">
                    <button className="secondary-button" onClick={close}>
                      Đóng lịch sử
                    </button>
                  </div>
                </>
              ) : stale ? (
                <>
                  <p role="alert" className="transfer-warning">
                    Phiên đã được chuyển bởi nhân viên khác. Dữ liệu đã được làm mới; bàn hiện tại
                    là {String(table.name)}.
                  </p>
                  <button className="primary-button" onClick={close}>
                    Xem bàn hiện tại
                  </button>
                </>
              ) : mode === 'review' && chosen ? (
                <section aria-label="Kiểm tra trước khi chuyển">
                  <div className="transfer-review-path">
                    <div>
                      <span>Từ bàn</span>
                      <strong>{String(source.name)}</strong>
                      <small>{String(source.area_name)}</small>
                    </div>
                    <Icon name="arrow" size={28} />
                    <div>
                      <span>Sang bàn</span>
                      <strong>{String(chosen.name)}</strong>
                      <small>
                        {String(chosen.area_name)} - {String(chosen.capacity)} chỗ
                      </small>
                    </div>
                  </div>
                  <dl className="transfer-review-details">
                    <div>
                      <dt>Số khách thực tế</dt>
                      <dd>{guestCount} khách</dd>
                    </div>
                    <div>
                      <dt>Lý do</dt>
                      <dd>
                        {tableTransferPolicy.reasons[reason]}
                        {note.trim() && ': ' + note.trim()}
                      </dd>
                    </div>
                  </dl>
                  <ul className="transfer-keep">
                    <li>Khách tiếp tục dùng phiên hiện tại, giữ giỏ và món đã gọi.</li>
                    <li>Số tiền và các lần thanh toán được giữ nguyên.</li>
                    <li>
                      Bàn {String(source.name)} chuyển sang <strong>Chờ dọn</strong>; bàn{' '}
                      {String(chosen.name)} chuyển sang <strong>Đang có khách</strong>.
                    </li>
                  </ul>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="transfer-footer">
                    <button
                      ref={cancelButton}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setMode('pick');
                        requestAnimationFrame(() => reviewButton.current?.focus());
                      }}
                    >
                      Hủy
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void transfer()}
                    >
                      {busy ? 'Đang chuyển…' : 'Chuyển bàn'}
                    </button>
                  </div>
                </section>
              ) : (
                <form className="transfer-picker" onSubmit={review}>
                  <div className="transfer-source">
                    <span className="transfer-source-icon">
                      <Icon name="table" size={28} />
                    </span>
                    <div>
                      <span className="transfer-caption">Đang chuyển từ</span>
                      <h3>{String(source.name)}</h3>
                      <p>
                        {String(source.area_name)} - {String(source.capacity)} chỗ
                      </p>
                    </div>
                    <label className="transfer-guests">
                      Số khách thực tế
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={tableTransferPolicy.maxGuests}
                        required
                        value={guests}
                        onChange={(e) => changeGuests(e.target.value)}
                        aria-describedby="transfer-guest-hint"
                      />
                    </label>
                  </div>
                  <p id="transfer-guest-hint" className="transfer-caption">
                    Kiểm tra lại tổng số người đang ngồi tại bàn; có thể khác số khách đang dùng
                    web.
                  </p>
                  <div className="transfer-filter">
                    <Search
                      value={search}
                      onChange={(value) => changeFilter(value, area)}
                      placeholder="Tìm mã hoặc tên bàn…"
                    />
                    <label>
                      Khu vực
                      <select
                        aria-label="Khu vực"
                        value={area}
                        onChange={(e) => changeFilter(search, e.target.value)}
                      >
                        <option value="">Tất cả khu vực</option>
                        {areas.map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void refresh().catch(() => setError('Chưa tải được danh sách bàn.'))
                      }
                    >
                      <Icon name="refresh" />
                      Tải lại bàn
                    </button>
                  </div>
                  {selectionNotice && (
                    <p className="transfer-warning" role="status">
                      {selectionNotice}
                    </p>
                  )}
                  <fieldset className="transfer-targets">
                    <legend>
                      Bàn phù hợp <span>{visible.length}</span>
                    </legend>
                    <p className="transfer-caption">
                      Chỉ hiển thị bàn sẵn sàng, đủ chỗ. Ưu tiên cùng khu, rồi sức chứa gần số khách
                      nhất.
                    </p>
                    {visible.length ? (
                      <div className="transfer-grid">
                        {visible.map((t) => (
                          <label
                            key={t.id}
                            className={
                              'transfer-table' + (t.id === selectedId ? ' is-selected' : '')
                            }
                          >
                            <input
                              type="radio"
                              name="transfer-table"
                              value={t.id}
                              checked={t.id === selectedId}
                              onChange={() => {
                                setSelectedId(t.id);
                                setSelectionNotice('');
                              }}
                              aria-label={`${t.name} - ${t.area_name} - ${t.capacity} chỗ - Sẵn sàng`}
                            />
                            <span className="transfer-table-content">
                              <span className="transfer-table-heading">
                                <strong>{String(t.name)}</strong>
                                <span className="transfer-ready">
                                  <Icon name="check" size={15} />
                                  Sẵn sàng
                                </span>
                              </span>
                              <span>
                                {String(t.area_name)} - {String(t.capacity)} chỗ
                                {t.code !== t.name && ' - ' + t.code}
                              </span>
                              <span className="transfer-table-tags">
                                {t.area_id === source.area_id && <small>Cùng khu vực</small>}
                                {Number(t.capacity) === guestCount && <small>Vừa đủ chỗ</small>}
                                {t.id === selectedId && (
                                  <small className="transfer-selected">
                                    <Icon name="check" size={14} />
                                    Đã chọn
                                  </small>
                                )}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon="table"
                        title={
                          targets.length
                            ? 'Không có bàn khớp bộ lọc.'
                            : `Không có bàn sẵn sàng đủ chỗ cho ${guests || 'số'} khách.`
                        }
                      >
                        {targets.length
                          ? 'Thử mã bàn khác hoặc chọn tất cả khu vực.'
                          : 'Đối chiếu số khách hoặc chờ bàn được dọn xong.'}
                      </Empty>
                    )}
                  </fieldset>
                  <div className="transfer-reason">
                    <label>
                      Lý do chuyển bàn
                      <select
                        aria-label="Lý do chuyển bàn"
                        value={reason}
                        onChange={(e) => setReason(e.target.value as TableTransferReason)}
                      >
                        {Object.entries(tableTransferPolicy.reasons).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {reason === 'OTHER'
                        ? 'Nội dung lý do (bắt buộc)'
                        : 'Ghi chú thêm (không bắt buộc)'}
                      <textarea
                        rows={2}
                        maxLength={tableTransferPolicy.maxNoteLength}
                        required={reason === 'OTHER'}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Ví dụ: khách muốn ngồi gần cửa sổ"
                      />
                    </label>
                  </div>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="transfer-footer">
                    <p>
                      {chosen
                        ? `Đã chọn ${chosen.name} - ${guestCount} khách`
                        : 'Chọn một bàn để tiếp tục.'}
                    </p>
                    <div>
                      <button type="button" className="secondary-button" onClick={close}>
                        Đóng
                      </button>
                      <button
                        ref={reviewButton}
                        type="submit"
                        className="primary-button"
                        disabled={
                          !chosen || guestCount > tableTransferPolicy.maxGuests || guestCount < 1
                        }
                      >
                        Xác nhận chuyển bàn
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </Modal>,
          document.body,
        )}
    </section>
  );
}
