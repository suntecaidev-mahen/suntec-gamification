import { ok, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/notifications — in-app inbox (latest 50). */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  const { data, error } = await supabaseAdmin()
    .from('notifications')
    .select('id, template_key, title, body, deep_link, data, read_at, created_at')
    .eq('member_id', member.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw toAppError(error);
  return ok({ items: data ?? [], unread: (data ?? []).filter((n) => !n.read_at).length });
});
