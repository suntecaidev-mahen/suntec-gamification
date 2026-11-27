import { uuid } from '@suntec/core';
import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/games/{id} — display configuration (no weights, no answers) + my availability. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req, undefined, { guests: true });
  return ok(await rpc('game_public', { p_member: member.id, p_game: uuid.parse(id) }));
});
