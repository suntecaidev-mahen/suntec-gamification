import Link from 'next/link';
import { Alert, Card, Field, Input, Select, Button } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { cancelReward, markCollected, retryReward, runOutboxNow } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { DataTable, PageHeader, Section, StatCard } from '@/components/admin/ui';

export const metadata = { title: 'Reward transactions' };

const STATUSES = ['pending', 'issued', 'retrying', 'failed', 'cancelled', 'redeemed', 'expired'];

type Txn = {
  id: string;
  ref: string;
  reward_type: string;
  status: string;
  source: string;
  external_ref: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
  member_id: string;
  reward_snapshot: { name?: string };
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const staff = await requireStaff(['rewards.read', 'customers.read']);
  const { status, q } = await searchParams;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('reward_transactions')
    .select('id, ref, reward_type, status, source, external_ref, last_error, attempts, created_at, member_id, reward_snapshot')
    .not('reward_type', 'in', '(play_points,bonus_attempt)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (q?.trim()) query = query.eq('ref', q.trim().toUpperCase());
  const [{ data, error }, { data: outbox }] = await Promise.all([query, supabase.from('outbox').select('status').in('status', ['pending', 'retry', 'processing', 'dead'])]);
  const counts = (outbox ?? []).reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {});
  const canAct = staff.can('customers.act');

  return (
    <>
      <PageHeader title="Reward transactions" description="Every reward allocated to customers with its delivery status towards Suntec+ (Capillary) and the voucher system." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Queued deliveries" value={(counts.pending ?? 0) + (counts.processing ?? 0)} />
        <StatCard label="Waiting to retry" value={counts.retry ?? 0} tone={counts.retry ? 'warning' : 'default'} />
        <StatCard label="Dead (needs action)" value={counts.dead ?? 0} tone={counts.dead ? 'danger' : 'default'} />
        <Card className="flex items-center p-4">
          {canAct ? <ActionForm action={runOutboxNow} submitLabel="Process deliveries now" variant="secondary" /> : <p className="text-sm text-text-muted">Deliveries run automatically.</p>}
        </Card>
      </div>

      {canAct && (
        <Section title="Concierge: mark gift as collected" description="Enter the claim code shown on the customer’s screen (or the RT- reference).">
          <Card className="max-w-xl">
            <ActionForm action={markCollected} submitLabel="Mark collected" inline>
              <Field id="lookup" label="Claim code" className="flex-1">
                <Input id="lookup" name="lookup" required placeholder="A1B2C3D4E5" />
              </Field>
            </ActionForm>
          </Card>
        </Section>
      )}

      <Section title="Transactions">
        <form className="mb-3 flex flex-wrap items-end gap-2">
          <Field id="status" label="Status" className="w-40">
            <Select id="status" name="status" defaultValue={status ?? ''}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="q" label="Reference" className="w-56">
            <Input id="q" name="q" defaultValue={q ?? ''} placeholder="RT-20261127-…" />
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        {error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : (
          <DataTable<Txn>
            rows={(data as Txn[]) ?? []}
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'reward_snapshot.name', label: 'Reward' },
              { key: 'source', label: 'Source' },
              { key: 'status', label: 'Status', format: 'status' },
              { key: 'external_ref', label: 'Suntec+ ref' },
              { key: 'created_at', label: 'Allocated', format: 'datetime' },
              { key: 'member', label: 'Customer', render: (t) => <Link className="text-primary hover:underline" href={`/admin/customers/${t.member_id}`}>View</Link> },
              {
                key: 'actions',
                label: '',
                render: (t) =>
                  canAct && ['failed', 'retrying', 'pending'].includes(t.status) ? (
                    <div className="flex flex-col gap-1">
                      {t.last_error && <span className="max-w-xs text-xs text-danger">{t.last_error}</span>}
                      <div className="flex gap-2">
                        <ActionForm action={retryReward} submitLabel="Retry" inline variant="secondary">
                          <input type="hidden" name="txn_id" value={t.id} />
                        </ActionForm>
                        <ActionForm action={cancelReward} submitLabel="Cancel" inline variant="ghost" confirm="Cancel this reward?">
                          <input type="hidden" name="txn_id" value={t.id} />
                        </ActionForm>
                      </div>
                    </div>
                  ) : null,
              },
            ]}
            empty={{ title: 'No transactions match' }}
          />
        )}
      </Section>
    </>
  );
}
