export type PayosResolutionFacts = {
  sessionStatus: string;
  providerStatus: string | null;
  requestedAmount: string;
  bankReportedAmount: string;
  quarantinedAmount: string;
  recordedAmount: string;
  allocatedAmount: string;
  originalAllocatedAmount: string;
  refundedAmount: string;
  unappliedAmount: string;
  sessionRefundDue: string;
  quoteInvalidatedAtReceipt: boolean;
  verified: boolean;
  independentBankVerified?: boolean;
  unpostedBankReferences?: boolean;
  open: boolean;
};

/** Identical prerequisites for the admin read model and the locked financial mutation. */
export function payosResolutionReadiness(f: PayosResolutionFacts) {
  const blockers: string[] = [];
  if (!f.open) blockers.push('Hồ sơ này đã kết thúc; xem chi tiết trong lịch sử.');
  if (
    !f.independentBankVerified &&
    !['PAID', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(f.providerStatus ?? '')
  )
    blockers.push(
      'payOS chưa kết thúc khoản thu. Hệ thống tiếp tục kiểm tra; chưa thể đóng hồ sơ.',
    );
  if (!f.verified && !f.independentBankVerified)
    blockers.push(
      'Chưa có kết quả xác minh đầy đủ sau bất thường gần nhất. Chọn Đối chiếu với payOS.',
    );
  if (BigInt(f.quarantinedAmount) > 0n)
    blockers.push(
      'Còn tiền chưa đủ điều kiện ghi sổ. Cần xác minh đúng giao dịch/tài khoản; nhập mã tham chiếu không thay thế chứng cứ.',
    );
  if (f.sessionStatus !== 'ACTIVE')
    blockers.push(
      'Phiên đã chốt. Không sửa phiếu lịch sử; khoản đến muộn cần chứng từ hoàn ngân hàng được xác minh riêng.',
    );
  if (BigInt(f.unappliedAmount) > 0n)
    blockers.push(
      'Còn tiền chưa phân bổ của khoản thu này. Hoàn thực tế từ đúng nguồn thu trước khi đóng hồ sơ.',
    );
  if (BigInt(f.sessionRefundDue) > 0n)
    blockers.push(
      'Cả phiên còn tiền phải hoàn. Phiếu duyệt hoàn chưa có nghĩa khách đã nhận lại tiền.',
    );
  if (f.unpostedBankReferences)
    blockers.push('Còn tham chiếu ngân hàng chưa được ghi sổ; cần đối chiếu trước khi đóng.');
  if (
    BigInt(f.bankReportedAmount) > BigInt(f.recordedAmount) ||
    (!f.independentBankVerified && BigInt(f.recordedAmount) !== BigInt(f.bankReportedAmount))
  )
    blockers.push('Tiền payOS báo và sổ thu chưa khớp. Cần xác minh và ghi sổ thành công trước.');
  if (BigInt(f.recordedAmount) - BigInt(f.refundedAmount) !== BigInt(f.allocatedAmount))
    blockers.push('Tiền còn giữ sau hoàn chưa khớp phần đã tính vào hóa đơn.');
  if (f.providerStatus === 'PAID' && BigInt(f.recordedAmount) < BigInt(f.requestedAmount))
    blockers.push('payOS báo hoàn tất nhưng số tiền ghi sổ chưa đủ khoản đã lập.');
  if (
    f.providerStatus === 'PAID' &&
    BigInt(f.originalAllocatedAmount) < BigInt(f.requestedAmount) &&
    !f.quoteInvalidatedAtReceipt
  )
    blockers.push('Khoản thu chưa được phân bổ đủ đúng phạm vi đã lập.');
  return { canResolve: blockers.length === 0, blockers };
}
