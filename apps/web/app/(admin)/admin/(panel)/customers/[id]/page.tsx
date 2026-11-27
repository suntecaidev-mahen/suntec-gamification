import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { Alert, Badge, Card, Field, Input, Select } from '@suntec/ui';
import { formatDate, formatDateTime } from '@suntec/core';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { cancelReward, grantAttempts, grantReward, retryReward, setMemberStatus } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { DataTable, PageHeader, Section, StatCard, StatusBadge } from '@/components/admin/ui';

export const metadata = { title: 'Customer' };

type Detail = {
  pii: boolean;
  can_act: boolean;
  member: { id: string; suntec_member_id: string; card_no: string | null; name: string; email: string | null; mobile: string | null; tier: string; tags: string[]; status: string; status_reason: string | null; joined_at: string | null; created_at: string; linked: boolean };
  profile: Record<string, number | string | boolean | null> | null;
  streaks: { program: string; current: number; best: number; last_day: string | null }[];
  attempts: { game_id: string; game: string; balance: number }[];
  sessions: { id: string; ref: string; game: string; type: string; status: string; payment: string; outcome: string | null; won: boolean | null; reward: string | null; score: number | null; started_at: string }[];
  rewards: { id: string; ref: string; name: string; type: string; status: string; source: string; external_ref: string | null; last_error: string | null; voucher_code: string | null; created_at: string; expires_at: string | null }[];
  ledger: { delta: number; balance_after: number; reason: string; note: string | null; created_at: string }[];
  badges: { name: string; tier: string; awarded_at: string }[];
  fraud: { id: string; kind: string; severity: string; created_at: string; resolved_at: string | null; details: unknown }[];
  devices: number;
  checkins: string[];
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff('customers.read');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_customer_detail', { p_member: id });
  if (error?.message?.includes('not found')) notFound();
  if (error || !data) return <Alert tone="danger">{error?.message ?? 'Not found'}</Alert>;
  const d = data as Detail;
  const p = d.profile ?? {};
  const { data: pts } = await supabase.rpc('admin_points_summary', { p_member: id });
  const pointsWon = Number((pts as { member_points_won?: number } | null)?.member_points_won ?? 0);
  const isGuest = d.member.suntec_member_id.startsWith('GUEST-');
  const [{ data: games }, { data: rewards }] = d.can_act
    ? await Promise.all([
        supabase.from('games').select('id, name').in('status', ['active', 'scheduled']).order('name'),
        supabase.from('rewards').select('id, name').eq('status', 'active').neq('type', 'none').order('sort'),
      ])
    : [{ data: [] }, { data: [] }];
  const back = `/admin/customers/${id}`;

  return (
    <>
      <PageHeader
        title={d.member.name || d.member.suntec_member_id}
        description={`${d.member.suntec_member_id} · ${d.member.tier} · joined ${formatDate(d.member.joined_at) || '—'}${d.pii ? '' : ' · personal data masked'}`}
        back={{ href: '/admin/customers', label: 'Customers' }}
        actions={<StatusBadge value={d.member.status} />}
      />
      {d.member.status !== 'active' && d.member.status_reason && <Alert tone="warning" className="mb-4">Status reason: {d.member.status_reason}</Alert>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Suntec+ Points won" value={pointsWon.toLocaleString()} hint={isGuest ? 'Guest — winnings held until claimed' : 'Credited in Capillary'} />
        <StatCard label="Games played" value={String(p.games_played ?? 0)} />
        <StatCard label="Check-ins" value={String(p.checkins_total ?? 0)} hint={d.streaks[0] ? `Streak ${d.streaks[0].current} (best ${d.streaks[0].best})` : undefined} />
        <StatCard label="Missions" value={String(p.missions_completed ?? 0)} />
        <StatCard label="Badges" value={String(p.badges_count ?? 0)} />
        <StatCard label="Devices" value={d.devices} tone={d.devices > 3 ? 'warning' : 'default'} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-base font-semibold">Profile</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-text-muted">Email</dt>
            <dd>{d.member.email ?? '—'}</dd>
            <dt className="text-text-muted">Mobile</dt>
            <dd>{d.member.mobile ?? '—'}</dd>
            <dt className="text-text-muted">Card</dt>
            <dd>{d.member.card_no ?? '—'}</dd>
            <dt className="text-text-muted">Tags</dt>
            <dd>{d.member.tags.join(', ') || '—'}</dd>
            <dt className="text-text-muted">App login</dt>
            <dd>{d.member.linked ? 'Linked' : 'Not yet'}</dd>
            <dt className="text-text-muted">Attempts</dt>
            <dd>{d.attempts.map((a) => `${a.game}: ${a.balance}`).join(' · ') || '—'}</dd>
            <dt className="text-text-muted">Badges</dt>
            <dd>{d.badges.map((b) => b.name).join(', ') || '—'}</dd>
          </dl>
        </Card>
        {d.can_act && (
          <Card className="space-y-5">
            <h2 className="text-base font-semibold">Customer service actions</h2>
            <p className="-mt-3 text-xs text-text-muted">Every action requires a reason and is written to the audit log.</p>
            <ActionForm action={grantAttempts} submitLabel="Grant attempts" inline>
              <input type="hidden" name="member_id" value={id} />
              <input type="hidden" name="idem" value={randomUUID()} />
              <Field id="ga-game" label="Game" className="w-48">
                <Select id="ga-game" name="game_id" required>
                  {(games ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="ga-count" label="Count" className="w-20">
                <Input id="ga-count" name="count" type="number" defaultValue={1} required />
              </Field>
              <Field id="ga-reason" label="Reason" className="min-w-40 flex-1">
                <Input id="ga-reason" name="reason" required minLength={3} />
              </Field>
            </ActionForm>
            <ActionForm action={grantReward} submitLabel="Grant reward" inline confirm="Grant this reward to the customer?">
              <input type="hidden" name="member_id" value={id} />
              <input type="hidden" name="idem" value={randomUUID()} />
              <Field id="gr-reward" label="Reward" className="w-56">
                <Select id="gr-reward" name="reward_id" required>
                  {(rewards ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="gr-reason" label="Reason" className="min-w-40 flex-1">
                <Input id="gr-reason" name="reason" required minLength={3} />
              </Field>
            </ActionForm>
            <ActionForm action={setMemberStatus} submitLabel="Update status" inline variant="secondary">
              <input type="hidden" name="member_id" value={id} />
              <Field id="st-status" label="Status" className="w-36">
                <Select id="st-status" name="status" defaultValue={d.member.status}>
                  <option value="active">Active</option>
                  <option value="flagged">Flagged</option>
                  <option value="blocked">Blocked</option>
                </Select>
              </Field>
              <Field id="st-reason" label="Reason" className="min-w-40 flex-1">
                <Input id="st-reason" name="reason" required minLength={3} />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>

      <Section title="Rewards">
        <DataTable
          rows={d.rewards}
          columns={[
            { key: 'ref', label: 'Reference' },
            { key: 'name', label: 'Reward' },
            { key: 'source', label: 'Source' },
            { key: 'status', label: 'Status', format: 'status' },
            { key: 'voucher_code', label: 'Code' },
            { key: 'created_at', label: 'Allocated', format: 'datetime' },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) =>
                d.can_act && ['failed', 'retrying', 'pending'].includes(r.status) ? (
                  <div className="flex gap-2">
                    <ActionForm action={retryReward} submitLabel="Retry" inline variant="secondary">
                      <input type="hidden" name="txn_id" value={r.id} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                    <ActionForm action={cancelReward} submitLabel="Cancel" inline variant="ghost" confirm="Cancel this reward?">
                      <input type="hidden" name="txn_id" value={r.id} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                  </div>
                ) : r.last_error ? (
                  <span className="text-xs text-danger">{r.last_error}</span>
                ) : null,
            },
          ]}
          empty={{ title: 'No rewards yet' }}
        />
      </Section>

      <Section title="Recent plays">
        <DataTable
          rows={d.sessions}
          columns={[
            { key: 'ref', label: 'Reference' },
            { key: 'game', label: 'Game' },
            { key: 'payment', label: 'Paid with' },
            { key: 'outcome', label: 'Result', render: (s) => (s.type === 'quiz' ? `Score ${s.score ?? 0}` : s.outcome) },
            { key: 'reward', label: 'Reward' },
            { key: 'status', label: 'Status', format: 'status' },
            { key: 'started_at', label: 'When', format: 'datetime' },
          ]}
          empty={{ title: 'No plays yet' }}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Fraud signals">
          {d.fraud.length === 0 ? (
            <p className="text-sm text-text-muted">None.</p>
          ) : (
            <ul className="space-y-2">
              {d.fraud.map((f) => (
                <li key={f.id}>
                  <Card className="flex items-center justify-between p-3 text-sm">
                    <span>
                      <StatusBadge value={f.severity} /> {f.kind.replace(/_/g, ' ')} · {formatDateTime(f.created_at)}
                    </span>
                    {f.resolved_at ? <Badge tone="success">Resolved</Badge> : <Badge tone="warning">Open</Badge>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
