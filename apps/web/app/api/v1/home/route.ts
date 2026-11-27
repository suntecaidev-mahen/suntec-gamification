import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/home — everything the Play & Win home screen needs in one call. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  return ok(await rpc('member_home', { p_member: member.id }));
});
