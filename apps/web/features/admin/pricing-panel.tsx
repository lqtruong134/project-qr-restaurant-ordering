'use client';
import type { AdminData } from './admin-types';
import DiscountProgramsPanel from './discount-programs-panel';
import TaxSettingsPanel from './tax-settings-panel';

export default function PricingPanel({
  initial,
  catalog,
  onUpdated,
}: {
  initial: string;
  catalog: AdminData['catalog'];
  onUpdated: () => Promise<void>;
}) {
  return initial === 'vat' ? (
    <TaxSettingsPanel onUpdated={onUpdated} />
  ) : (
    <DiscountProgramsPanel catalog={catalog} />
  );
}
