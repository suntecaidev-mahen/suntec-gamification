import { ok, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/me/history — recent plays and Play Points ledger. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  const db = supabaseAdmin();
  const [sessions, ledger] = await Promise.all([
    db
      .from('game_sessions')
      .select('id, ref, game_type, status, payment_source, pp_cost, outcome, score, correct_count, question_count, started_at, games(name)')
      .eq('member_id', member.id)
      .order('started_at', { ascending: false })
      .limit(50),
    db.from('points_ledger').select('id, delta, balance_after, reason, note, created_at').eq('member_id', member.id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (sessions.error) throw toAppError(sessions.error);
  if (ledger.error) throw toAppError(ledger.error);
  return ok({
    sessions: (sessions.data ?? []).map((s) => {
      const outcome = (s.outcome ?? {}) as Record<string, unknown>;
      const reward = outcome.reward as Record<string, unknown> | null | undefined;
      const game = s.games as unknown as { name?: string } | null;
      return {
        id: s.id,
        ref: s.ref,
        game_name: game?.name ?? '',
        game_type: s.game_type,
        status: s.status,
        payment_source: s.payment_source,
        pp_cost: s.pp_cost,
        won: Boolean(outcome.won),
        result: s.game_type === 'quiz' ? `${s.correct_count ?? 0}/${s.question_count ?? 0} correct` : ((outcome.label as string) ?? ''),
        reward_name: (reward?.name as string) ?? null,
        score: s.score,
        started_at: s.started_at,
      };
    }),
    ledger: ledger.data ?? [],
  });
});
