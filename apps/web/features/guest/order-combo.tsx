export function OrderedComboContents({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return null;
  const items = value.filter(
    (item) =>
      item && typeof item.name === 'string' && Number.isInteger(item.quantity) && item.quantity > 0,
  );
  if (!items.length) return null;
  return (
    <small className="guest-ordered-combo">
      Mỗi combo gồm: {items.map((item) => `${item.quantity} × ${item.name}`).join(' · ')}
    </small>
  );
}
