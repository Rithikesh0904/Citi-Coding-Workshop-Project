/**
 * Date handling for the console.
 *
 * The API speaks ISO (YYYY-MM-DD) and the UI shows DD/MM/YYYY. Keeping state
 * in ISO throughout means validation comparisons still work with plain string
 * operators -- '2026-01-15' < '2026-06-30' is true, which would not hold for
 * DD/MM strings -- and the conversion happens only at the display edge.
 */

export const DISPLAY_FORMAT = 'DD/MM/YYYY';

/** ISO string (or timestamp) to DD/MM/YYYY for display. */
export function toDisplay(value) {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}
