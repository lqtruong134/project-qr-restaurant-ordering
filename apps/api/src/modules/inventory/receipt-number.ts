// The database sequence is global and never resets at a date or tenant boundary.
export function receiptNumber(sequence: string) {
  if (!/^[1-9]\d*$/.test(sequence)) throw new RangeError('Invalid receipt sequence');
  return 'PN-' + sequence.padStart(6, '0');
}
