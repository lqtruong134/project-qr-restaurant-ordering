'use client';
import { useId, useRef, useState } from 'react';
import { restaurantPolicy } from '@thesis/contracts';
import { api, vnd, type Row } from '../shared/components';
import { Empty, Icon, Modal } from '../shared/primitives';
import { DishImage } from '../shared/dish-image';
import { QuantityStepper } from '../shared/quantity-stepper';
import { PolicyNotice } from '../shared/policy-ui';
import { requestId } from '../shared/request-id';
import type { GuestState } from './guest-panels';
import { ComboContents } from './combo-contents';
import { safeProductImage } from './menu-promotions';

type Selection = Record<string, boolean>;
export const cartTotal = (items: GuestState['items']) =>
  items.reduce((sum, item) => sum + BigInt(item.unit_price_preview) * BigInt(item.quantity), 0n);
const ownItems = (state: GuestState) =>
  state.items
    .filter((i) => i.owner_participant_id === state.participant.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
export function CartSummary({ state, open }: { state: GuestState; open: () => void }) {
  const mine = ownItems(state);
  return (
    <div className="cart-summary">
      <div className="section-heading">
        <h2>
          <Icon name="bag" /> Giỏ món của bạn
        </h2>
      </div>
      <p>Món trong giỏ chưa được gửi bếp.</p>
      {mine.length ? (
        <ul>
          {mine.slice(0, 3).map((i) => (
            <li key={i.id}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <strong>{vnd(BigInt(i.unit_price_preview) * BigInt(i.quantity))}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small-note">Bạn chưa thêm món nào.</p>
      )}
      {mine.length > 3 && <small>Và {mine.length - 3} món khác</small>}
      <div className="cart-summary-total">
        <span>Tạm tính, đã gồm VAT</span>
        <strong>{vnd(cartTotal(mine))}</strong>
      </div>
      <small>
        Giỏ cả bàn: {state.items.reduce((s, i) => s + i.quantity, 0)} món & combo -{' '}
        {vnd(cartTotal(state.items))}
      </small>
      <button className="primary-button" onClick={open}>
        Xem giỏ món <Icon name="arrow" size={16} />
      </button>
    </div>
  );
}

export function Cart({
  state,
  mutate,
  done,
  selection,
  select,
  menu,
  submitted,
}: {
  state: GuestState;
  mutate: (path: string, body: unknown, method?: string) => Promise<void>;
  done: () => Promise<void>;
  selection: Selection;
  select: (values: Selection) => void;
  menu: () => void;
  submitted: (order: Row) => void;
}) {
  const [scope, setScope] = useState<'mine' | 'table'>('mine');
  const [editing, setEditing] = useState(false),
    [removal, setRemoval] = useState<Selection>({});
  const [pendingDelete, setPendingDelete] = useState<string[]>();
  const [noteItem, setNoteItem] = useState<GuestState['items'][number]>(),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inFlight = useRef(false),
    attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const noteId = useId();
  const mine = ownItems(state);
  const chosen = mine.filter((i) => selection[i.id] !== false);
  const removed = mine.filter((i) => removal[i.id] === true);
  const activeSelection = editing ? removal : selection;
  const isChecked = (id: string) =>
    editing ? activeSelection[id] === true : activeSelection[id] !== false;
  const unavailable = chosen.some((i) => i.available === false);
  const priceChanged = chosen.some(
    (i) => i.current_price != null && String(i.current_price) !== String(i.unit_price_preview),
  );
  const comboChanged = (item: GuestState['items'][number]) => {
    const product = state.products.find((p) => p.id === item.product_id);
    return product?.product_kind === 'COMBO' && item.product_version_preview !== product.version;
  };
  const chosenComboChanged = chosen.some(comboChanged);
  const allChecked = mine.length > 0 && mine.every((i) => isChecked(i.id));
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      await done();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const patch = (item: GuestState['items'][number], quantity: number, itemNote = item.note ?? '') =>
    run(() =>
      mutate(
        '/guest/cart/' + item.id,
        {
          quantity,
          note: itemNote,
          cartVersion: state.cart.cart_version,
        },
        'PATCH',
      ),
    );
  function toggle(values: Selection) {
    if (editing) setRemoval(values);
    else select(values);
  }
  function row(item: GuestState['items'][number], owned: boolean) {
    const product = state.products.find((p) => p.id === item.product_id);
    const changed =
      item.current_price != null && String(item.current_price) !== String(item.unit_price_preview);
    const comboUpdated = comboChanged(item);
    return (
      <article
        className={'shopping-cart-row' + (owned ? '' : ' is-readonly')}
        key={item.id}
        data-cart-item={item.id}
      >
        {owned && (
          <input
            type="checkbox"
            aria-label={(editing ? 'Chọn xóa ' : 'Chọn gửi ') + item.name}
            checked={isChecked(item.id)}
            disabled={busy}
            onChange={(e) => toggle({ ...activeSelection, [item.id]: e.target.checked })}
          />
        )}
        <div className="shopping-cart-image">
          <DishImage
            code={product?.code ?? ''}
            name={item.name}
            url={product ? safeProductImage(product) : undefined}
          />
        </div>
        <div className="shopping-cart-description">
          <h3>{item.name}</h3>
          <p>
            {vnd(item.unit_price_preview)} /{' '}
            {product?.product_kind === 'COMBO' || item.product_kind === 'COMBO' ? 'combo' : 'phần'}
          </p>
          {product?.product_kind === 'COMBO' && (
            <ComboContents components={product.components} compact />
          )}
          {item.note && <p className="cart-note">Ghi chú: {String(item.note)}</p>}
          {!owned && (
            <small>{String(item.owner_name ?? 'Người cùng bàn')} chọn - Bạn chỉ xem món này.</small>
          )}
          {item.available === false && (
            <p className="form-error">
              {owned
                ? 'Món này tạm hết. Bỏ chọn để gửi món khác hoặc xóa khỏi giỏ.'
                : 'Món này hiện tạm hết.'}
            </p>
          )}
          {(changed || comboUpdated) && (
            <div className="cart-price-change">
              {comboUpdated && (
                <p>Combo đã được cập nhật. Xem lại thành phần ở trên và xác nhận trước khi gửi.</p>
              )}
              {changed && (
                <p>
                  Giá đã thay đổi thành {vnd(item.current_price)} /{' '}
                  {product?.product_kind === 'COMBO' || item.product_kind === 'COMBO'
                    ? 'combo'
                    : 'phần'}
                  .
                </p>
              )}
              {owned && (
                <button
                  className="secondary-button"
                  disabled={busy || item.available === false}
                  onClick={() => void patch(item, item.quantity)}
                >
                  {comboUpdated ? 'Xác nhận combo mới' : 'Đồng ý giá mới'}
                </button>
              )}
            </div>
          )}
          {owned && !editing && (
            <button
              className="cart-text-button"
              disabled={busy || item.available === false || changed || comboUpdated}
              onClick={() => {
                setNoteItem(item);
                setNote(String(item.note ?? ''));
              }}
            >
              Sửa ghi chú
            </button>
          )}
        </div>
        <div className="shopping-cart-controls">
          <strong>{vnd(BigInt(item.unit_price_preview) * BigInt(item.quantity))}</strong>
          {owned && !editing ? (
            <QuantityStepper
              value={item.quantity}
              label={'Số lượng ' + item.name}
              disabled={busy || item.available === false || changed || comboUpdated}
              onChange={(quantity) => void patch(item, quantity)}
            />
          ) : (
            <span>
              {item.quantity}{' '}
              {product?.product_kind === 'COMBO' || item.product_kind === 'COMBO'
                ? 'combo'
                : 'phần'}
            </span>
          )}
          {owned && !editing && (
            <button
              className="cart-text-button"
              disabled={busy}
              aria-label={'Xóa ' + item.name}
              onClick={() => setPendingDelete([item.id])}
            >
              Xóa
            </button>
          )}
        </div>
      </article>
    );
  }
  return (
    <div className="shopping-cart">
      <div className="cart-scope-tabs" role="group" aria-label="Phạm vi giỏ món">
        <button aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
          Món của tôi <span>{mine.length}</span>
        </button>
        <button aria-pressed={scope === 'table'} onClick={() => setScope('table')}>
          Cả bàn <span>{state.items.length}</span>
        </button>
      </div>
      <div className="cart-scope-totals">
        <div>
          <span>Tạm tính của tôi</span>
          <strong>{vnd(cartTotal(mine))}</strong>
        </div>
        <div>
          <span>Tạm tính cả bàn</span>
          <strong>{vnd(cartTotal(state.items))}</strong>
        </div>
      </div>
      <p className="small-note">
        Giá đã gồm VAT. Giỏ chỉ gồm món chưa gửi bếp; khuyến mãi của bàn được kiểm tra ở mục Thanh
        toán sau khi gửi món.
      </p>
      {mine.length > 0 && (
        <div className="cart-selection-toolbar">
          <label>
            <input
              type="checkbox"
              aria-label={editing ? 'Chọn tất cả món để xóa' : 'Chọn tất cả món để gửi'}
              checked={allChecked}
              disabled={busy}
              ref={(node) => {
                if (node) node.indeterminate = !allChecked && mine.some((i) => isChecked(i.id));
              }}
              onChange={(e) =>
                toggle({
                  ...activeSelection,
                  ...Object.fromEntries(mine.map((i) => [i.id, e.target.checked])),
                })
              }
            />
            {editing ? 'Chọn món cần xóa' : 'Chọn tất cả'}
          </label>
          <button
            className="cart-text-button"
            aria-pressed={editing}
            disabled={busy}
            onClick={() => {
              setEditing(!editing);
              setRemoval({});
              setError('');
            }}
          >
            {editing ? 'Xong' : 'Chỉnh sửa giỏ'}
          </button>
        </div>
      )}
      {!editing && mine.length > 0 && (
        <p className="cart-selection-hint">Bỏ chọn để giữ món trong giỏ và gửi lần sau.</p>
      )}
      {editing && (
        <p className="cart-selection-hint">
          Chỉ xóa món bạn đã thêm vào giỏ. Món đã gửi không bị ảnh hưởng.
        </p>
      )}
      {!mine.length && (scope === 'mine' || !state.items.length) && (
        <Empty
          title={state.items.length ? 'Giỏ của bạn đang trống' : 'Chưa có món trong giỏ'}
          icon="bag"
        >
          Chọn thêm món trong thực đơn.{' '}
          {state.items.length > 0 && 'Mở “Cả bàn” để xem món người cùng bàn đang chọn.'}
        </Empty>
      )}
      {scope === 'table' && mine.length > 0 && (
        <div className="section-heading cart-own-heading">
          <h3>Món của bạn</h3>
          <strong>{vnd(cartTotal(mine))}</strong>
        </div>
      )}
      {mine.map((item) => row(item, true))}
      {scope === 'table' &&
        [
          ...new Set(
            state.items
              .filter((i) => i.owner_participant_id !== state.participant.id)
              .map((i) => i.owner_participant_id),
          ),
        ].map((owner) => {
          const items = state.items.filter((i) => i.owner_participant_id === owner);
          return (
            <section className="cart-other-person" key={owner}>
              <div className="section-heading">
                <h3>{String(items[0]?.owner_name ?? 'Người cùng bàn')}</h3>
                <strong>{vnd(cartTotal(items))}</strong>
              </div>
              {items.map((item) => row(item, false))}
            </section>
          );
        })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <div className="cart-edit-actions">
          <button
            className="primary-button"
            disabled={busy || !removed.length}
            onClick={() => setPendingDelete(removed.map((i) => i.id))}
          >
            Xóa món đã chọn ({removed.length})
          </button>
          <button
            className="secondary-button"
            disabled={busy || !mine.length}
            onClick={() => setPendingDelete(mine.map((i) => i.id))}
          >
            Xóa tất cả món của tôi
          </button>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <div className="submit-order-review shopping-cart-checkout">
              <div>
                <p>
                  <strong>
                    Lần gửi này: {chosen.reduce((s, i) => s + i.quantity, 0)} món & combo
                  </strong>
                </p>
                <strong className="cart-checkout-amount">{vnd(cartTotal(chosen))}</strong>
                <small>
                  {chosen.length} món đã chọn - {mine.length - chosen.length} món giữ lại
                </small>
              </div>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !chosen.length ||
                  chosen.length > 50 ||
                  unavailable ||
                  priceChanged ||
                  chosenComboChanged
                }
                onClick={() =>
                  void run(async () => {
                    const body = {
                      cartVersion: state.cart.cart_version,
                      itemIds: chosen.map((i) => i.id).sort(),
                    };
                    const fingerprint = JSON.stringify(body);
                    if (attempt.current?.fingerprint !== fingerprint)
                      attempt.current = { fingerprint, key: requestId() };
                    const order = await api<Row>(
                      '/guest/orders',
                      { ...body, requestId: attempt.current!.key },
                      'POST',
                      true,
                    );
                    attempt.current = null;
                    await done();
                    submitted(order);
                  })
                }
              >
                {busy ? 'Đang xử lý…' : 'Gửi món đã chọn'} <Icon name="arrow" size={17} />
              </button>
            </div>
          )}
          {unavailable || priceChanged || chosenComboChanged ? (
            <p className="form-error">
              {unavailable
                ? 'Có món hiện không thể đặt trong lựa chọn. Bỏ chọn món đó để tiếp tục.'
                : chosenComboChanged
                  ? 'Xác nhận combo mới hoặc bỏ chọn combo đó trước khi gửi.'
                  : 'Xác nhận giá mới hoặc bỏ chọn món đã đổi giá trước khi gửi.'}
            </p>
          ) : chosen.length > 50 ? (
            <p className="form-error">
              Mỗi lượt gửi tối đa 50 món trong giỏ. Bỏ chọn bớt món để gửi lần sau.
            </p>
          ) : !chosen.length && mine.length > 0 ? (
            <p className="small-note">
              Chọn ít nhất một món để gửi. Các món còn lại vẫn ở trong giỏ.
            </p>
          ) : null}
          {mine.length > 0 && (
            <PolicyNotice warning>{restaurantPolicy.notices.submit}</PolicyNotice>
          )}
        </>
      )}
      <button
        className={'cart-continue ' + (mine.length ? 'secondary-button' : 'primary-button')}
        onClick={menu}
      >
        Tiếp tục chọn món
      </button>
      {pendingDelete && (
        <Modal
          title="Xóa món khỏi giỏ?"
          close={() => {
            if (!busy) setPendingDelete(undefined);
          }}
          blocking={busy}
        >
          <p>
            Xóa {pendingDelete.length} món bạn đã thêm? Các món đã gửi và món người cùng bàn được
            giữ nguyên.
          </p>
          <div className="confirm-dialog-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setPendingDelete(undefined)}
            >
              Giữ lại
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mutate(
                    '/guest/cart',
                    { cartVersion: state.cart.cart_version, itemIds: pendingDelete },
                    'DELETE',
                  );
                  setPendingDelete(undefined);
                  setRemoval({});
                })
              }
            >
              {busy ? 'Đang xóa…' : 'Xác nhận xóa'}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {noteItem && (
        <Modal
          title="Ghi chú món"
          close={() => {
            if (!busy) setNoteItem(undefined);
          }}
          blocking={busy}
        >
          <form
            className="cart-note-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await mutate(
                  '/guest/cart/' + noteItem.id,
                  {
                    quantity: noteItem.quantity,
                    note: note.trim(),
                    cartVersion: state.cart.cart_version,
                  },
                  'PATCH',
                );
                setNoteItem(undefined);
              });
            }}
          >
            <h3>{noteItem.name}</h3>
            <label htmlFor={noteId}>Ghi chú cho bếp (không bắt buộc)</label>
            <textarea
              id={noteId}
              value={note}
              disabled={busy}
              maxLength={300}
              rows={3}
              placeholder="Ví dụ: ít cay, không hành…"
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="primary-button" disabled={busy}>
              Cập nhật ghi chú
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
