'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import type { AdminData, SaveAdmin } from './admin-types';
import { Empty, Modal, Search, matches } from '../shared/primitives';
import { Action, api, EntryForm, label, options, type Field, type Row } from '../shared/components';
export default function TablesPanel({
  data,
  save,
  initial,
}: {
  data: Pick<AdminData, 'tables' | 'areas'>;
  save: SaveAdmin;
  initial: string;
}) {
  const [search, setSearch] = useState(''),
    [editTable, setEditTable] = useState<Row>(),
    [qr, setQr] = useState<{ image: string; url: string; table: string; area?: string }>(),
    [copyMessage, setCopyMessage] = useState(''),
    [error, setError] = useState('');
  const [area, setArea] = useState('all');
  const visibleAreas = data.areas.filter((a) => matches(`${a.name} ${a.code}`, search));
  const visibleTables = data.tables.filter(
    (t) =>
      (area === 'all' || t.area_id === area) &&
      matches(
        `${t.name} ${t.code} ${data.areas.find((a) => a.id === t.area_id)?.name ?? ''}`,
        search,
      ),
  );
  const named: Field[] = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên' },
  ];
  return (
    <section className="admin-tables-panel">
      <div className="toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder={
            initial === 'areas' ? 'Tìm tên hoặc mã khu vực…' : 'Tìm bàn, mã bàn hoặc khu vực…'
          }
        />
        {initial !== 'areas' && (
          <label>
            Khu vực
            <select
              aria-label="Lọc khu vực bàn"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="all">Tất cả khu vực</option>
              {data.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {String(a.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(search || area !== 'all') && (
          <button
            className="secondary-button"
            onClick={() => {
              setSearch('');
              setArea('all');
            }}
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <>
        {initial === 'areas' ? (
          <>
            <details className="core-card">
              <summary>Thêm khu vực mới</summary>
              <EntryForm
                title="Thêm khu vực"
                successMessage="Đã thêm khu vực phục vụ."
                fields={named}
                onSubmit={(v) => save('/core/areas', v)}
              />
            </details>
            {!visibleAreas.length && (
              <Empty title={search ? 'Không tìm thấy khu vực' : 'Chưa có khu vực phục vụ'}>
                {search ? 'Thử tên hoặc mã khu vực khác.' : 'Chọn Thêm khu vực mới để bắt đầu.'}
              </Empty>
            )}
            <div className="core-grid">
              {visibleAreas.map((a) => (
                <article className="core-card" key={a.id}>
                  <h3>{String(a.name)}</h3>
                  <p>Mã khu vực: {String(a.code)}</p>
                  <strong>{data.tables.filter((t) => t.area_id === a.id).length} bàn</strong>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            {initial === 'tables' && (
              <details className="core-card">
                <summary>Thêm bàn mới</summary>
                <EntryForm
                  title="Thêm bàn"
                  successMessage="Đã thêm bàn mới."
                  fields={[
                    ...named,
                    {
                      key: 'areaId',
                      label: 'Khu vực',
                      options: options(data.areas.filter((a) => a.is_active)),
                    },
                    { key: 'capacity', label: 'Số chỗ', type: 'number', value: 4, min: 1, max: 30 },
                  ]}
                  onSubmit={(v) => save('/core/tables', { ...v, capacity: Number(v.capacity) })}
                />
              </details>
            )}
            {!visibleTables.length && (
              <Empty title={data.tables.length ? 'Không tìm thấy bàn phù hợp' : 'Chưa có bàn'}>
                {data.tables.length
                  ? 'Đổi từ khóa hoặc khu vực để xem lại.'
                  : 'Thêm khu vực và bàn trước khi cấp mã QR.'}
              </Empty>
            )}
            <div className="core-grid">
              {visibleTables.map((t) => (
                <article className="core-card" key={t.id}>
                  <h2>{String(t.name)}</h2>
                  <p>
                    Mã bàn: {String(t.code)} -{' '}
                    {String(data.areas.find((a) => a.id === t.area_id)?.name ?? 'Chưa có khu vực')}
                  </p>
                  <p>
                    {t.is_active ? label(t.table_status) : 'Ngừng sử dụng'} - {String(t.capacity)}{' '}
                    chỗ
                  </p>
                  {initial === 'qr' && (
                    <>
                      <div className="core-actions">
                        <Action
                          disabled={
                            !t.is_active || !data.areas.find((a) => a.id === t.area_id)?.is_active
                          }
                          run={async () => {
                            const result = await api<{
                              available: boolean;
                              joinPath?: string;
                              table?: string;
                            }>('/core/tables/' + t.id + '/qr');
                            if (!result.available || !result.joinPath) {
                              setError('Bàn này chưa có QR hiện tại để hiển thị.');
                              return;
                            }
                            const url = window.location.origin + result.joinPath;
                            setCopyMessage('');
                            setError('');
                            setQr({
                              image: await QRCode.toDataURL(url, { width: 320, margin: 4 }),
                              url,
                              table: result.table ?? String(t.name),
                              area: String(
                                t.area_name ??
                                  data?.areas.find((a) => a.id === t.area_id)?.name ??
                                  '',
                              ),
                            });
                            setError('');
                          }}
                        >
                          Xem / in QR hiện tại
                        </Action>
                        <Action
                          disabled={
                            !t.is_active || !data.areas.find((a) => a.id === t.area_id)?.is_active
                          }
                          confirmTitle="Thay mã QR của bàn?"
                          confirmLabel="Cấp mã QR mới"
                          successMessage="Đã cấp mã QR mới. Hãy thay bản QR đang đặt tại bàn."
                          confirm="Mã QR cũ của bàn sẽ không dùng được nữa. Sau khi cấp mã mới, hãy thay bản QR đang đặt tại bàn."
                          run={async () => {
                            const result = await api<{ joinPath: string }>(
                              '/core/tables/' + t.id + '/qr',
                              {},
                            );
                            const url = window.location.origin + result.joinPath;
                            setCopyMessage('');
                            setError('');
                            setQr({
                              image: await QRCode.toDataURL(url, { width: 320, margin: 4 }),
                              url,
                              table: String(t.name),
                              area: String(
                                t.area_name ??
                                  data?.areas.find((a) => a.id === t.area_id)?.name ??
                                  '',
                              ),
                            });
                          }}
                        >
                          Cấp mã QR mới
                        </Action>
                      </div>
                      {(!t.is_active || !data.areas.find((a) => a.id === t.area_id)?.is_active) && (
                        <p className="small-note">
                          Chỉ xem hoặc cấp mã QR khi bàn và khu vực đang được sử dụng.
                        </p>
                      )}
                    </>
                  )}
                  {initial === 'tables' && (
                    <button className="secondary-button" onClick={() => setEditTable(t)}>
                      Chỉnh sửa bàn
                    </button>
                  )}
                </article>
              ))}
            </div>
            {qr && (
              <Modal title={'QR - ' + qr.table} close={() => setQr(undefined)}>
                <div className="core-qr">
                  <p className="eyebrow">MÃ BÀN DÀNH CHO KHÁCH</p>
                  <h2>Quyết Trường Bistro - {qr.table}</h2>
                  {qr.area && <p>Khu vực: {qr.area}</p>}
                  <p>
                    Đặt mã QR ở vị trí dễ nhìn, phẳng và đủ sáng. Khách chỉ cần mở camera và quét
                    mã. Sau đó nhập tên, mã vào bàn do nhân viên hoặc người ngồi cùng bàn cung cấp
                    để mở thực đơn.
                  </p>
                  <img src={qr.image} alt={'Mã QR ' + qr.table} width={320} height={320} />
                  <div className="core-qr-actions">
                    <a className="secondary-button" href={qr.url} target="_blank" rel="noreferrer">
                      Mở thực đơn của bàn
                    </a>
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        setCopyMessage('');
                        try {
                          await navigator.clipboard.writeText(qr.url);
                          setCopyMessage('Đã sao chép liên kết thực đơn.');
                        } catch {
                          setCopyMessage(
                            'Không sao chép được. Hãy mở liên kết rồi sao chép thủ công.',
                          );
                        }
                      }}
                    >
                      Sao chép liên kết
                    </button>
                    <button className="secondary-button" onClick={() => window.print()}>
                      In trực tiếp
                    </button>
                  </div>
                  {copyMessage && <p role="status">{copyMessage}</p>}
                  <p className="small-note">
                    <a href={qr.url} target="_blank" rel="noreferrer">
                      Liên kết dành cho khách
                    </a>
                  </p>
                  <a
                    className="secondary-button"
                    href={qr.image}
                    download={'QR-' + qr.table + '.png'}
                  >
                    Tải mã QR để in
                  </a>
                </div>
              </Modal>
            )}
            {editTable && (
              <Modal
                title={'Chỉnh sửa - ' + String(editTable.name)}
                close={() => setEditTable(undefined)}
              >
                <EntryForm
                  key={String(editTable.version)}
                  title="Thông tin bàn"
                  successMessage={`Đã cập nhật bàn ${String(editTable.name)}.`}
                  confirm={(v) =>
                    v.active === 'false'
                      ? 'Ngừng sử dụng bàn này? Khách sẽ không thể tham gia bàn qua QR. Bàn đang có khách cần kết thúc lượt phục vụ trước.'
                      : undefined
                  }
                  fields={[
                    { key: 'name', label: 'Tên bàn', value: String(editTable.name) },
                    {
                      key: 'areaId',
                      label: 'Khu vực',
                      value: String(editTable.area_id),
                      options: options(data.areas),
                    },
                    {
                      key: 'capacity',
                      label: 'Số chỗ',
                      type: 'number',
                      value: Number(editTable.capacity),
                      min: 1,
                      max: 30,
                    },
                    {
                      key: 'active',
                      label: 'Sử dụng',
                      value: String(editTable.is_active),
                      options: [
                        { value: 'true', label: 'Đang dùng' },
                        { value: 'false', label: 'Ngừng dùng' },
                      ],
                    },
                  ]}
                  onSubmit={(v) =>
                    save(
                      '/core/tables/' + editTable.id,
                      {
                        ...v,
                        capacity: Number(v.capacity),
                        active: v.active === 'true',
                        version: editTable.version,
                      },
                      'PATCH',
                    ).then(() => setEditTable(undefined))
                  }
                />
              </Modal>
            )}
          </>
        )}
      </>
    </section>
  );
}
