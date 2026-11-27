import { ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';

/** GET /api/v1/me — profile summary: member or guest, Suntec+ Points won, held guest winnings + claim code, counters. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req, undefined, { guests: true });
  return ok(await rpc('member_summary', { p_member: member.id }));
});
