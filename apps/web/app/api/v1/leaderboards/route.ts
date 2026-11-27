import { ok, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/leaderboards — active leaderboards. */
export const GET = route(async (req) => {
  await requireMember(req);
  const { data, error } = await supabaseAdmin()
    .from('leaderboards')
    .select('id, key, name, description, metric, periods, display_mode, top_n, prize_rules, campaign_id')
    .eq('status', 'active')
    .order('created_at');
  if (error) throw toAppError(error);
  return ok({ items: data ?? [] });
});
