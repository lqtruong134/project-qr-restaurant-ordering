import type { MenuPromotion } from '@thesis/contracts';
import type { Product, Row } from '../shared/components';
export type Inventory = {
  units: Row[];
  ingredients: Row[];
  locations: Row[];
  balances: Row[];
  movements: Row[];
  receipts: Row[];
  recipes: Row[];
  recipeItems: Row[];
};
export type AdminData = {
  catalog: { categories: Row[]; products: Product[]; promotions?: MenuPromotion[] };
  tables: Row[];
  areas: Row[];
  inventory: Inventory;
  users: Row[];
  reports: { store: Row; sales: Row[]; payments: Row[]; reconciliation: Row[] };
  risk: { defaults: Record<string, number | boolean>; policies: Row[] };
  outstanding: Row[];
};

export type SaveAdmin = (path: string, body: unknown, method?: string) => Promise<void>;
