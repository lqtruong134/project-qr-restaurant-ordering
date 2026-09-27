'use client';
import { useState } from 'react';
import { Action, EntryForm, api, options, type Row } from '../shared/components';
import { LinesForm } from './admin-forms';
import type { SaveAdmin } from './admin-types';
export function ReceiptEditor({
  id,
  ingredients,
  locations,
  save,
}: {
  id: string;
  ingredients: Row[];
  locations: Row[];
  save: SaveAdmin;
}) {
  const [draft, setDraft] = useState<(Row & { lines: Row[] }) | null>(null),
    [reason, setReason] = useState('');
  return (
    <details>
      <summary>Sửa / hủy phiếu nháp</summary>
      <Action run={async () => setDraft(await api<Row & { lines: Row[] }>('/core/receipts/' + id))}>
        Tải phiếu để sửa
      </Action>
      {draft && (
        <>
          <label>
            Lý do sửa
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <LinesForm
            key={String(draft.updated_at)}
            title="Sửa phiếu nhập nháp"
            mode="receipt"
            ingredients={ingredients}
            options={options(locations)}
            initial={{
              header: {
                target: String(draft.location_id),
                number: String(draft.receipt_no),
                supplier: String(draft.supplier_name_snapshot ?? ''),
              },
              lines: draft.lines.map((l) => ({
                ingredientId: String(l.ingredient_id),
                quantity: String(l.quantity),
                unitCost: String(l.unit_cost),
              })),
            }}
            save={async (h, lines) => {
              await save(
                '/core/receipts/' + id,
                {
                  locationId: h.target,
                  number: h.number,
                  supplier: h.supplier,
                  lines,
                  reason,
                  expectedVersion: draft.version,
                },
                'PATCH',
              );
              setDraft(null);
            }}
          />
        </>
      )}
      <EntryForm
        title="Hủy phiếu chưa nhập kho"
        fields={[{ key: 'reason', label: 'Lý do hủy' }]}
        submit="Hủy phiếu nháp"
        onSubmit={(v) => save('/core/receipts/' + id + '/cancel', v)}
      />
    </details>
  );
}
