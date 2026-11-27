import { leaderboardQuerySchema, uuid } from '@suntec/core';
import { ok, parseQuery, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/leaderboards/{id}?period=weekly — ranking with masked names and my position. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req);
  const q = parseQuery(req, leaderboardQuerySchema);
  return ok(
    await rpc('leaderboard_view', { p_board: uuid.parse(id), p_period: q.period ?? null, p_member: member.id, p_limit: q.limit ?? null }),
  );
});
