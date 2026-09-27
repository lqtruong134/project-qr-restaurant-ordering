'use client';
import { useState } from 'react';
import { Action, type Order } from '../shared/components';
export function ServeSelection({
  orders,
  act,
}: {
  orders: Order[];
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const sessions = [...new Set(orders.map((o) => o.session_id))];
  return (
    <>
      {sessions.map((sid) => {
        const batches = orders.filter((o) => o.session_id === sid);
        const ready = batches.flatMap((o) => (o.items ?? []).filter((i) => i.status === 'READY'));
        if (!ready.length) return null;
        const chosen = ready.filter((i) => selected.includes(i.id));
        return (
          <section className="core-card" key={sid}>
            <h3>
              Bàn {batches[0]?.table_code} · {ready.length} món chờ mang
            </h3>
            <label>
              <input
                type="checkbox"
                checked={chosen.length === ready.length}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...new Set([...selected, ...ready.map((i) => i.id)])]
                      : selected.filter((id) => !ready.some((i) => i.id === id)),
                  )
                }
              />{' '}
              Chọn tất cả món đang chờ
            </label>
            {ready.map((i) => (
              <label className="core-line" key={i.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(i.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, i.id] : selected.filter((id) => id !== i.id),
                    )
                  }
                />
                <span>
                  {i.quantity} × {i.product_name_snapshot}
                  {i.note && <small> · {String(i.note)}</small>}
                </span>
              </label>
            ))}
            {chosen.length > 0 && (
              <Action
                run={async () => {
                  await act('/core/sessions/' + sid + '/serve-items', {
                    itemIds: chosen.map((i) => i.id),
                  });
                  setSelected((old) => old.filter((id) => !chosen.some((i) => i.id === id)));
                }}
              >
                Đã phục vụ {chosen.length} món
              </Action>
            )}
          </section>
        );
      })}
    </>
  );
}
