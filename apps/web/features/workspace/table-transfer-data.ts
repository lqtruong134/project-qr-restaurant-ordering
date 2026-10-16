import type { Row } from '../shared/components';
import { matches } from '../shared/primitives';
const codes = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
export function transferTargets(tables: Row[], source: Row, guests: number) {
  if (!Number.isSafeInteger(guests) || guests < 1) return [];
  return tables
    .filter(
      (t) =>
        t.id !== source.id &&
        t.is_active === true &&
        t.area_active === true &&
        t.table_status === 'AVAILABLE' &&
        !t.session_id &&
        Number(t.capacity) >= guests,
    )
    .sort(
      (a, b) =>
        Number(b.area_id === source.area_id) - Number(a.area_id === source.area_id) ||
        Number(a.capacity) - Number(b.capacity) ||
        codes.compare(String(a.code), String(b.code)),
    );
}
export function filterTargets(tables: Row[], search: string, area: string) {
  return tables.filter(
    (t) =>
      (!area || t.area_id === area) &&
      (matches(String(t.code), search) || matches(String(t.name), search)),
  );
}
