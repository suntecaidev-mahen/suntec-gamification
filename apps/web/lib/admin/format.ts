/** Admin date inputs are entered in Singapore time (UTC+8, no DST). */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function toSgtInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 16);
}

export function fromSgtInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function getPath(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined) return undefined;
    const v = Array.isArray(acc) ? (acc[0] as Record<string, unknown> | undefined)?.[k] : (acc as Record<string, unknown>)[k];
    return v;
  }, row);
}

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function friendlyDbError(e: { message?: string; code?: string; hint?: string | null } | null | undefined): string {
  if (!e) return 'Unknown error';
  const msg = e.message ?? '';
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'You do not have permission to make this change.';
  if (e.code === '23505') return 'A record with the same key already exists.';
  if (e.code === '23503') return 'This record is referenced by other data and cannot be removed. Archive it instead.';
  if (e.code === '23514') return `A value is outside the allowed range (${msg}).`;
  return msg || 'Unknown error';
}
