import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/missions — active missions with my progress for the current period. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  return ok({ items: await rpc('missions_for_member', { p_member: member.id }) });
});
