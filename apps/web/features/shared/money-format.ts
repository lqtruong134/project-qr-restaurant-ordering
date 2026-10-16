/** VND uses whole đồng. Never interpret signs, fractions or scientific notation as money. */
export function parseMoneyInput(input: string): string | null {
  const text = input.trim().replace(/[\u00a0\u202f]/g, ' ');
  if (!text) return '';
  if (!/^\d+$/.test(text) && !/^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.test(text)) return null;
  return BigInt(text.replace(/[., ]/g, '')).toString();
}
export function formatMoneyInput(input: string): string {
  const parsed = parseMoneyInput(input);
  return parsed === null ? input : parsed === '' ? '' : BigInt(parsed).toLocaleString('vi-VN');
}
