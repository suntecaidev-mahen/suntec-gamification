import { notificationsReadBodySchema } from '@suntec/core';
import { ok, parseJson, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** POST /api/v1/notifications/read — mark notifications as read ({"ids":[…]} or {"all":true}). */
export const POST = route(async (req) => {
  const { member } = await requireMember(req);
  const body = await parseJson(req, notificationsReadBodySchema);
  let q = supabaseAdmin().from('notifications').update({ read_at: new Date().toISOString() }).eq('member_id', member.id).is('read_at', null);
  if (!body.all && body.ids) q = q.in('id', body.ids);
  const { error } = await q;
  if (error) throw toAppError(error);
  return ok({ ok: true });
});
