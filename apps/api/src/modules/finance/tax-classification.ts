export function resolveVatRate(
  product: { tax_treatment?: unknown; vat_rate_percent?: unknown },
  policy: { default_rate_percent: unknown; effective_at: unknown; created_by?: unknown },
  now: Date,
) {
  const treatment = product.tax_treatment === 'EXEMPT' ? ('EXEMPT' as const) : ('TAXABLE' as const);
  const requestedRate =
    treatment === 'EXEMPT'
      ? null
      : product.tax_treatment === 'TAXABLE'
        ? Number(product.vat_rate_percent)
        : Number(policy.default_rate_percent);
  const expiresAt = new Date('2027-01-01T00:00:00+07:00');
  const extended8 =
    Number(policy.default_rate_percent) === 8 &&
    new Date(String(policy.effective_at)) >= expiresAt &&
    Boolean(policy.created_by);
  const rate = requestedRate === 8 && now >= expiresAt && !extended8 ? 10 : requestedRate;
  return {
    treatment,
    ratePercent: rate,
    requestedRatePercent: requestedRate,
    appliedRatePercent: rate,
    reducedRateExpiresAt: requestedRate === 8 && !extended8 ? expiresAt.toISOString() : null,
  };
}
