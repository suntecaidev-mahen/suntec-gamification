import { after } from 'next/server';
import { claimBodySchema } from '@suntec/core';
import { ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireClient } from '@/lib/api/auth';
import { processOutbox } from '@/lib/api/outbox';

/**
 * POST /api/v1/integrations/members/{memberId}/claims  (scope: claims:write)
 * Called by the Suntec+ backend right after a new member signs up with a Play & Win
 * claim code (passed from the "Join Suntec+" link). Moves the guest's held winnings
 * to the new member and delivers them. Idempotent for the same member.
 */
export const POST = route<{ memberId: string }>(async (req, { memberId }) => {
  await requireClient(req, 'claims:write');
  const { code } = await parseJson(req, claimBodySchema);
  const id = await rpc<string>('ensure_member', { p_suntec_member_id: memberId, p_profile: {}, p_auth_user_id: null });
  const result = await rpc<{ claimed: boolean; already: boolean; rewards: number; points: number }>('guest_claim', {
    p_member: id,
    p_code: code,
    p_guest: null,
  });
  if (result.rewards > 0) after(() => processOutbox({ limit: 50 }));
  return ok({ member_id: memberId, ...result });
});
