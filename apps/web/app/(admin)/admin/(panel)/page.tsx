import Link from 'next/link';
import { Alert, Card } from '@suntec/ui';
import { formatMoney } from '@suntec/core';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BarChart, PageHeader, Section, StatCard } from '@/components/admin/ui';

export const metadata = { title: 'Dashboard' };

type Dashboard = {
  day: string;
  members_total: number;
  members_active_today: number;
  plays_today: number;
  wins_today: number;
  checkins_today: number;
  missions_completed_today: number;
  rewards_issued_today: number;
  reward_cost_today_cents: number;
  active_campaigns: number;
  active_games: number;
  open_fraud_signals: number;
  failed_rewards: number;
  low_stock: { reward_id: string; name: string; remaining: number; threshold: number }[];
  plays_by_day: { day: string; plays: number; members: number }[];
  top_rewards_7d: { name: string; count: number }[];
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const staff = await requireStaff();
  const { denied } = await searchParams;
  const canSee = staff.can('reports.read') || staff.can('campaigns.read');
  const db = await createSupabaseServerClient();
  const [{ data, error }, { data: pts }] = canSee ? await Promise.all([db.rpc('admin_dashboard'), db.rpc('admin_points_summary')]) : [{ data: null, error: null }, { data: null }];
  const d = data as Dashboard | null;
  const p = (pts ?? { points_awarded_today: 0, points_held: 0, guests_today: 0, guests_claimed_today: 0 }) as { points_awarded_today: number; points_held: number; guests_today: number; guests_claimed_today: number };

  return (
    <>
      <PageHeader title={`Welcome, ${staff.displayName.split(' ')[0]}`} />
      {denied && <Alert tone="warning" className="mb-4">You don’t have access to that page.</Alert>}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!canSee && <Alert tone="info">Your role has no dashboard access. Use the menu to get started.</Alert>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Active players today" value={d.members_active_today.toLocaleString()} hint={`${Number(p.guests_today).toLocaleString()} new guests · ${Number(p.guests_claimed_today).toLocaleString()} joined & claimed`} />
            <StatCard label="Plays today" value={d.plays_today.toLocaleString()} hint={`${d.wins_today.toLocaleString()} wins`} />
            <StatCard label="Check-ins today" value={d.checkins_today.toLocaleString()} />
            <StatCard label="Missions completed" value={d.missions_completed_today.toLocaleString()} />
            <StatCard label="Rewards issued today" value={d.rewards_issued_today.toLocaleString()} hint={`Cost ${formatMoney(d.reward_cost_today_cents)}`} />
            <StatCard label="Suntec+ Points awarded today" value={Number(p.points_awarded_today).toLocaleString()} hint={`${Number(p.points_held).toLocaleString()} held for guests`} />
            <StatCard label="Open fraud signals" value={d.open_fraud_signals} tone={d.open_fraud_signals > 0 ? 'warning' : 'default'} hint={<Link className="text-primary hover:underline" href="/admin/fraud">Review</Link>} />
            <StatCard label="Failed deliveries" value={d.failed_rewards} tone={d.failed_rewards > 0 ? 'danger' : 'default'} hint={<Link className="text-primary hover:underline" href="/admin/transactions?status=failed">Retry</Link>} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="mb-4 text-base font-semibold">Plays, last 14 days</h2>
              {d.plays_by_day.length ? (
                <BarChart label="Plays per day" data={d.plays_by_day.map((p) => ({ label: p.day.slice(5), value: Number(p.plays) }))} />
              ) : (
                <p className="text-sm text-text-muted">No plays yet.</p>
              )}
            </Card>
            <Card>
              <h2 className="mb-3 text-base font-semibold">Top rewards (7 days)</h2>
              <ul className="space-y-2 text-sm">
                {d.top_rewards_7d.length === 0 && <li className="text-text-muted">No rewards yet.</li>}
                {d.top_rewards_7d.map((r) => (
                  <li key={r.name} className="flex justify-between">
                    <span>{r.name}</span>
                    <span className="font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Section title="Low stock" description="Rewards at or below their low-stock threshold.">
            {d.low_stock.length === 0 ? (
              <p className="text-sm text-text-muted">All rewards are sufficiently stocked.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {d.low_stock.map((r) => (
                  <Link key={r.reward_id} href={`/admin/r/rewards/${r.reward_id}`}>
                    <Card className="flex items-center justify-between p-3 hover:border-primary">
                      <span className="font-medium">{r.name}</span>
                      <span className={r.remaining === 0 ? 'font-semibold text-danger' : 'text-warning'}>{r.remaining} left</span>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </Section>
          <p className="mt-8 text-xs text-text-muted">
            {d.active_campaigns} active campaign(s) · {d.active_games} live game(s)
          </p>
        </>
      )}
    </>
  );
}
