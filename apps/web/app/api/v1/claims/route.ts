import { after } from 'next/server';
import { claimBodySchema } from '@suntec/core';
import { ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { processOutbox } from '@/lib/api/outbox';

/**
 * POST /api/v1/claims — a signed-in Suntec+ member enters the claim code they got as a
 * guest; the held winnings move to their account and are delivered to Capillary.
 */
export const POST = route(async (req) => {
  const { member } = await requireMember(req, { key: 'claim', limit: 10 });
  const { code } = await parseJson(req, claimBodySchema);
  const result = await rpc<{ claimed: boolean; already: boolean; rewards: number; points: number }>('guest_claim', {
    p_member: member.id,
    p_code: code,
    p_guest: null,
  });
  if (result.rewards > 0) after(() => processOutbox({ limit: 50 }));
  return ok(result);
});
