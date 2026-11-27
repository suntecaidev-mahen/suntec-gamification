import { fail, ok, route, rpc } from '@/lib/api/core';
import { requireClient } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * GET /api/v1/integrations/members/{memberId}/summary  (scope: members:read)
 * Play & Win summary for a Suntec+ member, e.g. to show a badge on the app home tile.
 */
export const GET = route<{ memberId: string }>(async (req, { memberId }) => {
  await requireClient(req, 'members:read');
  const { data } = await supabaseAdmin().from('members').select('id').eq('suntec_member_id', memberId).maybeSingle();
  if (!data) fail('NOT_FOUND', 'Member has not used Play & Win yet');
  const [summary, checkin] = await Promise.all([
    rpc<Record<string, unknown>>('member_summary', { p_member: data.id }),
    rpc<Record<string, unknown>>('checkin_status', { p_member: data.id, p_program: null }),
  ]);
  const rest: Record<string, unknown> = { ...summary };
  delete rest.member; // no personal data in server-to-server summaries
  delete rest.preferences;
  return ok({ member_id: memberId, ...rest, checkin });
});
