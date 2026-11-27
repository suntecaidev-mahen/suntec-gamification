import { DEFAULT_TIMEZONE } from './constants';

/**
 * Business-day helpers in the configured timezone (default Asia/Singapore).
 * Mirrors public.business_day() / public.period_key() in SQL.
 */
function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** YYYY-MM-DD of the business day containing `date`. */
export function businessDay(date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const { y, m, d } = parts(date, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ISO-8601 week-numbering year and week for a calendar date. */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7; // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week };
}

export type Period = 'daily' | 'weekly' | 'monthly' | 'once' | 'overall';

/** daily → 2026-11-27 · weekly → 2026-W48 · monthly → 2026-11 · once/overall → all */
export function periodKey(period: Period | string, date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const { y, m, d } = parts(date, timeZone);
  switch (period) {
    case 'daily':
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    case 'weekly': {
      const w = isoWeek(y, m, d);
      return `${w.year}-W${String(w.week).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${y}-${String(m).padStart(2, '0')}`;
    default:
      return 'all';
  }
}

/** Display helper: "27 Nov 2026" in the business timezone. */
export function formatDate(value: string | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-SG', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatMoney(cents: number | null | undefined, currency = 'SGD'): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format((cents ?? 0) / 100);
}
