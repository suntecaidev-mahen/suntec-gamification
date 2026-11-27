import { uuid } from '@suntec/core';
import { fail, ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/sessions/{id} — one of my game sessions (e.g. resume a quiz). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req);
  const sid = uuid.parse(id);
  const { data } = await supabaseAdmin().from('game_sessions').select('member_id').eq('id', sid).maybeSingle();
  if (!data || data.member_id !== member.id) fail('NOT_FOUND', 'Session not found');
  return ok(await rpc('game_session_view', { p_session: sid }));
});
