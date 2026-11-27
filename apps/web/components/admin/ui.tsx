import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card, EmptyState, type BadgeTone } from '@suntec/ui';
import { formatDate, formatDateTime, formatMoney } from '@suntec/core';
import { getPath, humanize } from '@/lib/admin/format';

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-medium text-primary hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  issued: 'success',
  completed: 'success',
  done: 'success',
  redeemed: 'info',
  processed: 'success',
  scheduled: 'info',
  pending: 'warning',
  retrying: 'warning',
  retry: 'warning',
  in_progress: 'warning',
  paused: 'warning',
  flagged: 'warning',
  draft: 'neutral',
  inactive: 'neutral',
  ended: 'neutral',
  archived: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  failed: 'danger',
  dead: 'danger',
  blocked: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

export function StatusBadge({ value }: { value: unknown }) {
  const v = String(value ?? '');
  return <Badge tone={STATUS_TONES[v] ?? 'neutral'}>{humanize(v)}</Badge>;
}

export function formatCell(value: unknown, format?: string): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-text-subtle">—</span>;
  switch (format) {
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'status':
      return <StatusBadge value={value} />;
    case 'bool':
      return value ? 'Yes' : 'No';
    case 'money':
      return formatMoney(Number(value));
    case 'percent':
      return `${Number(value).toFixed(2)}%`;
    default:
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

export type Column<T> = { key: string; label: string; format?: string; render?: (row: T) => ReactNode; className?: string };

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  rowHref,
  empty,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowHref?: (row: T) => string;
  empty?: { title: string; description?: string; action?: ReactNode };
  caption?: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty?.title ?? 'Nothing here yet'} description={empty?.description} action={empty?.action} />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-border bg-surface-muted text-xs font-medium text-text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-3 font-semibold ${c.className ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)} className="hover:bg-surface-muted">
              {columns.map((c, ci) => {
                const content = c.render ? c.render(row) : formatCell(getPath(row, c.key), c.format);
                return (
                  <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ''}`}>
                    {ci === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium text-primary hover:underline">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'warning' | 'danger' }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-normal text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

/** Simple accessible bar chart (no chart library needed for the dashboard). */
export function BarChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex h-40 items-end gap-1.5" role="list">
        {data.map((d) => (
          <div key={d.label} role="listitem" className="flex flex-1 flex-col items-center gap-1" aria-label={`${d.label}: ${d.value}`}>
            <span className="text-[10px] text-text-muted">{d.value}</span>
            <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(2, (d.value / max) * 120)}px` }} />
            <span className="text-[10px] text-text-subtle">{d.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
