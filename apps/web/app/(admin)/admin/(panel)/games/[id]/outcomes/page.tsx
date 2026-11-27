import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OutcomeEditor, type EditorOutcome, type RewardOption } from '@/components/admin/OutcomeEditor';
import { PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Prizes & probabilities' };

export default async function OutcomesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff('campaigns.read');
  const supabase = await createSupabaseServerClient();
  const { data: game } = await supabase.from('games').select('id, name, type, status').eq('id', id).maybeSingle();
  if (!game) notFound();
  if (game.type === 'quiz') notFound();

  const [{ data: outcomes }, { data: rewards }] = await Promise.all([
    supabase.from('game_outcomes').select('*').eq('game_id', id).order('position'),
    supabase.from('rewards').select('id, name, type, unit_cost_cents, reward_inventory(remaining_qty)').eq('status', 'active').order('sort'),
  ]);
  const byId = new Map((outcomes ?? []).map((o) => [o.id as string, o.position as number]));
  const initial: EditorOutcome[] = (outcomes ?? []).map((o) => ({
    id: o.id,
    position: o.position,
    label: o.label,
    display: o.display ?? {},
    reward_id: o.reward_id,
    reward_qty: o.reward_qty,
    weight_bp: o.weight_bp,
    fallback_strategy: o.fallback_strategy,
    fallback_position: o.fallback_outcome_id ? (byId.get(o.fallback_outcome_id) ?? null) : null,
  }));
  const rewardOptions: RewardOption[] = (rewards ?? [])
    .filter((r) => r.type !== 'none')
    .map((r) => {
      const inv = r.reward_inventory as unknown;
      const first = (Array.isArray(inv) ? inv[0] : inv) as { remaining_qty: number | null } | null;
      return { id: r.id, name: r.name, type: r.type, unit_cost_cents: r.unit_cost_cents, stock: first?.remaining_qty ?? null };
    });

  return (
    <>
      <PageHeader
        title={`${game.name}: prizes & probabilities`}
        description="Each outcome’s chance is set in percent (stored as basis points). The total must be exactly 100% before the game can go live, and changes to a live game are validated atomically."
        back={{ href: `/admin/r/games/${id}`, label: 'Game settings' }}
        actions={
          <>
            <Badge tone={game.status === 'active' ? 'success' : 'neutral'}>{game.status}</Badge>
            <Link href={`/admin/r/games/${id}`}>
              <Button variant="secondary">Edit game</Button>
            </Link>
          </>
        }
      />
      <OutcomeEditor gameId={id} gameType={game.type} initial={initial} rewards={rewardOptions} canWrite={staff.can('games.write')} />
    </>
  );
}
