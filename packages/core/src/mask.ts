/** PDPA-friendly masking helpers (mirror public._mask_* in SQL). */
export function maskName(first?: string | null, last?: string | null): string {
  const f = first?.trim();
  const l = last?.trim();
  return `${f ? f[0]!.toUpperCase() : '?'}***${l ? ` ${l[0]!.toUpperCase()}.` : ''}`;
}

export function maskEmail(email?: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  const at = email.indexOf('@');
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

export function maskTail(value?: string | null, keep = 4): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= keep) return '*'.repeat(value.length);
  return '*'.repeat(value.length - keep) + value.slice(-keep);
}
