import { uuid } from '@suntec/core';
import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** POST /api/v1/missions/{id}/enrol — join an opt-in mission. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req, undefined, { guests: true });
  return ok(await rpc('mission_enrol', { p_member: member.id, p_mission: uuid.parse(id) }));
});
