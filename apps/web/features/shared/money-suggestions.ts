export function moneySuggestions(value: string, min = '1', max = '100000000000'): string[] {
  if (!/^\d{1,3}$/.test(value) || BigInt(value) === 0n) return [];
  const n = BigInt(value),
    low = BigInt(min),
    high = BigInt(max);
  return [1000n, 10000n, 100000n]
    .map((factor) => n * factor)
    .filter((amount) => amount >= low && amount <= high)
    .map(String);
}
