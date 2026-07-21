/** Format a number for the English-only UI. */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en", opts).format(n);
}

/** Format a date/timestamp for the English-only UI.
 *  Accepts a Date or a millisecond epoch. */
export function formatDate(value: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", opts).format(value);
}
