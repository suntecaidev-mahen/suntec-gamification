import Link from 'next/link';
import { Alert, cn } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DataTable, PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Leaderboard standings' };

type View = { board: { name: string; periods: string[] }; period: string; period_key: string; entries: { rank: number; name: string; score: number }[] };

export default async function StandingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  await requireStaff('campaigns.read');
  const { id } = await params;
  const { period } = await searchParams;
  const { data, error } = await (await createSupabaseServerClient()).rpc('admin_leaderboard', { p_board: id, p_period: period ?? null });
  if (error || !data) return <Alert tone="danger">{error?.message ?? 'Not found'}</Alert>;
  const v = data as View;
  return (
    <>
      <PageHeader title={`${v.board.name} — standings`} description={`Period ${v.period_key}. Names are shown exactly as customers see them.`} back={{ href: `/admin/r/leaderboards/${id}`, label: 'Leaderboard settings' }} />
      <nav className="mb-4 flex gap-2" aria-label="Period">
        {v.board.periods.map((p) => (
          <Link key={p} href={`?period=${p}`} aria-current={p === v.period ? 'page' : undefined} className={cn('rounded-full px-3 py-1 text-sm', p === v.period ? 'bg-primary text-primary-fg' : 'bg-surface text-text border border-border')}>
            {p}
          </Link>
        ))}
      </nav>
      <DataTable rows={v.entries.map((e) => ({ ...e, id: e.rank }))} columns={[{ key: 'rank', label: 'Rank' }, { key: 'name', label: 'Member' }, { key: 'score', label: 'Score' }]} empty={{ title: 'No scores yet this period' }} />
    </>
  );
}
