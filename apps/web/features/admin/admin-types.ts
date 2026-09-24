import type { Product, Row } from '../shared/components';
export type Inventory = {
  units: Row[];
  ingredients: Row[];
  locations: Row[];
  balances: Row[];
  receipts: Row[];
};
export type AdminData = {
  catalog: { categories: Row[]; products: Product[] };
  tables: Row[];
  areas: Row[];
  inventory: Inventory;
  users: Row[];
  reports: { sales: Row[]; payments: Row[] };
  risk: { defaults: Record<string, number | boolean>; policies: Row[] };
  outstanding: Row[];
};

export type SaveAdmin = (path: string, body: unknown, method?: string) => Promise<void>;
