export function SessionReference({
  id,
  code,
  separator = true,
}: {
  id: unknown;
  code?: unknown;
  separator?: boolean;
}) {
  if (typeof id !== 'string' || !id) return null;
  return (
    <span className="session-reference" title={id}>
      {separator ? ' · Phiên #' : 'Phiên #'}
      {typeof code === 'string' && code ? code : id.slice(0, 8).toUpperCase()}
    </span>
  );
}
