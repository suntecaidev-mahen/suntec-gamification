import Link from 'next/link';
import { Alert, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveFraud } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { DataTable, PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Fraud signals' };

type Signal = { id: string; member_id: string | null; kind: string; severity: string; details: Record<string, unknown>; created_at: string; resolved_at: string | null; resolution: string | null };

export default async function FraudPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const staff = await requireStaff('customers.read');
  const { all } = await searchParams;
  const supabase = await createSupabaseServerClient();
  let q = supabase.from('fraud_signals').select('id, member_id, kind, severity, details, created_at, resolved_at, resolution').order('created_at', { ascending: false }).limit(200);
  if (!all) q = q.is('resolved_at', null);
  const { data, error } = await q;
  return (
    <>
      <PageHeader
        title="Fraud signals"
        description="Automatic signals: play velocity, device sharing, QR scan bursts and suspicious quiz timing. High severity signals auto-flag the member (configurable in Settings)."
        actions={
          <Link href={all ? '/admin/fraud' : '/admin/fraud?all=1'} className="text-sm font-medium text-primary hover:underline">
            {all ? 'Show open only' : 'Show all'}
          </Link>
        }
      />
      {error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : (
        <DataTable<Signal>
          rows={(data as Signal[]) ?? []}
          columns={[
            { key: 'created_at', label: 'When', format: 'datetime' },
            { key: 'kind', label: 'Signal', render: (s) => s.kind.replace(/_/g, ' ') },
            { key: 'severity', label: 'Severity', format: 'status' },
            { key: 'details', label: 'Details', render: (s) => <code className="text-xs">{JSON.stringify(s.details)}</code> },
            { key: 'member_id', label: 'Customer', render: (s) => (s.member_id ? <Link className="text-primary hover:underline" href={`/admin/customers/${s.member_id}`}>Open</Link> : '—') },
            {
              key: 'resolve',
              label: '',
              render: (s) =>
                s.resolved_at ? (
                  <span className="text-xs text-text-muted">{s.resolution}</span>
                ) : staff.can('customers.act') ? (
                  <ActionForm action={resolveFraud} submitLabel="Resolve" inline variant="secondary">
                    <input type="hidden" name="id" value={s.id} />
                    <Input name="resolution" aria-label="Resolution note" placeholder="Note" className="h-8 w-36" />
                  </ActionForm>
                ) : null,
            },
          ]}
          empty={{ title: 'No open signals', description: 'Nice — nothing suspicious right now.' }}
        />
      )}
    </>
  );
}
