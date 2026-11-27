import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/me — profile summary: Play Points, counters, unread inbox, preferences. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  return ok(await rpc('member_summary', { p_member: member.id }));
});
