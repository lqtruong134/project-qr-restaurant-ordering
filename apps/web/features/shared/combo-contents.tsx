export function comboContents(value: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part: unknown) => {
    if (!part || typeof part !== 'object') return [];
    const row = part as Record<string, unknown>;
    const quantity = Number(row.quantity);
    return typeof row.name === 'string' && Number.isInteger(quantity) && quantity > 0
      ? [{ name: row.name, quantity }]
      : [];
  });
}

export function ComboContents({ components }: { components: unknown }) {
  const parts = comboContents(components);
  if (!parts.length) return null;
  return (
    <span className="combo-contents">
      <small>Trong mỗi combo</small>
      {parts.map((part, index) => (
        <span key={`${part.name}-${index}`}>
          {part.quantity} × {part.name}
        </span>
      ))}
    </span>
  );
}
