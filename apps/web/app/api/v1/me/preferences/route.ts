import { preferencesBodySchema } from '@suntec/core';
import { ok, parseJson, route, rpc, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** PATCH /api/v1/me/preferences — leaderboard privacy and notification preferences. */
export const PATCH = route(async (req) => {
  const { member } = await requireMember(req);
  const body = await parseJson(req, preferencesBodySchema);
  const { error } = await supabaseAdmin().from('member_profiles').update(body).eq('member_id', member.id);
  if (error) throw toAppError(error);
  return ok(await rpc('member_summary', { p_member: member.id }));
});
