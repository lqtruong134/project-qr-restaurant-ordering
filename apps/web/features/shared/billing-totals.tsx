import type { BillingSummary } from '@thesis/contracts';
import { vnd } from './components';
import { pricingFacts, taxLabel } from './billing-summary';

export function BillingTotals({
  billing,
  account,
  receipt = false,
}: {
  billing?: BillingSummary;
  account: { [key: string]: unknown };
  receipt?: boolean;
}) {
  const facts = pricingFacts(billing, account);
  const includesVat = Boolean(billing?.vatGroups.some((group) => group.treatment === 'TAXABLE'));
  const tax = (
    <>
      {billing && (
        <dl className="billing-tax-facts">
          {!billing.legacyTaxUnavailable && includesVat && (
            <div>
              <dt>{receipt ? 'Tiền trước VAT' : 'Giá trị trước VAT, sau khuyến mãi'}</dt>
              <dd>{vnd(facts.beforeVat)}</dd>
            </div>
          )}
          {billing.vatGroups.map((group, index) => (
            <div key={index}>
              <dt>
                {taxLabel(group.treatment, group.ratePercent)}
                {!receipt && group.treatment === 'TAXABLE' && (
                  <small>Đã nằm trong tổng thanh toán</small>
                )}
              </dt>
              <dd>{vnd(group.treatment === 'TAXABLE' ? group.vatAmount : group.totalAmount)}</dd>
            </div>
          ))}
        </dl>
      )}
      {(!billing || billing.legacyTaxUnavailable) && (
        <p className="billing-tax-note">
          {!billing
            ? 'Phiếu này chưa có thông tin VAT; số tiền thanh toán được giữ nguyên.'
            : 'Có khoản tiền chưa có chi tiết VAT; tổng thanh toán không cộng thêm thuế cho khoản này.'}
        </p>
      )}
    </>
  );
  return (
    <section
      className={'billing-totals' + (receipt ? ' billing-totals-receipt' : '')}
      aria-label="Tiền món, khuyến mãi và VAT"
    >
      <dl className="billing-price-facts">
        {(!receipt || facts.discount > 0n) && (
          <div>
            <dt>{receipt ? 'Tiền món' : 'Tiền món trước khuyến mãi'}</dt>
            <dd>{vnd(facts.subtotal)}</dd>
          </div>
        )}
        {facts.discount > 0n && (
          <div className="billing-discount">
            <dt>
              Khuyến mãi
              {billing?.promotion && (
                <small>
                  {billing.promotion.name}
                  {billing.promotion.code ? ` · ${billing.promotion.code}` : ''}
                </small>
              )}
            </dt>
            <dd>−{vnd(facts.discount)}</dd>
          </div>
        )}
        <div className="billing-payable">
          <dt>Tổng thanh toán{facts.hasTaxDetails && includesVat && <small>Đã gồm VAT</small>}</dt>
          <dd>{vnd(facts.payable)}</dd>
        </div>
      </dl>
      {receipt ? (
        tax
      ) : (
        <details className="billing-tax-details">
          <summary>
            {includesVat ? 'Chi tiết VAT' : 'Thông tin thuế'}
            {facts.hasTaxDetails && includesVat ? ' đã gồm trong giá' : ''}
          </summary>
          {tax}
        </details>
      )}
      {!receipt && billing && !billing.legacyTaxUnavailable && includesVat && (
        <p className="billing-tax-note">Giá đã gồm VAT, không thu thêm.</p>
      )}
    </section>
  );
}
