import { after } from 'next/server';
import { uuid } from '@suntec/core';
import { fail, ok, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { deliverNow } from '@/lib/api/outbox';

/** POST /api/v1/rewards/{id}/redeem — spend Play Points on a catalogue reward. Requires Idempotency-Key. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req, { key: 'redeem', limit: 10 });
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key || key.length < 8 || key.length > 200) fail('INVALID', 'Idempotency-Key header (8-200 chars) is required');
  const rewardId = uuid.parse(id);
  const txn = await rpc<{ id: string; reward_id: string }>('reward_redeem', { p_member: member.id, p_reward: rewardId, p_idem: key });
  if (txn.reward_id !== rewardId) fail('IDEMPOTENCY_MISMATCH', 'Idempotency-Key was already used for a different reward');
  after(() => deliverNow([txn.id]));
  return ok(txn, { status: 201 });
});
