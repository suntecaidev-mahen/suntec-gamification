import { attemptGrantBodySchema } from '@suntec/core';
import { ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireClient } from '@/lib/api/auth';

/**
 * POST /api/v1/integrations/members/{memberId}/attempts  (scope: attempts:write)
 * Grants bonus game attempts (e.g. a purchase promotion). Idempotent on external_id.
 */
export const POST = route<{ memberId: string }>(async (req, { memberId }) => {
  const client = await requireClient(req, 'attempts:write');
  const body = await parseJson(req, attemptGrantBodySchema);
  const id = await rpc<string>('ensure_member', { p_suntec_member_id: memberId, p_profile: {}, p_auth_user_id: null });
  const balance = await rpc<number>('attempt_post', {
    p_member: id,
    p_game: body.game_id,
    p_delta: body.count,
    p_reason: 'event_grant',
    p_ref_type: 'api_client',
    p_ref_id: client.id,
    p_idem: `client:${client.id}:${body.external_id}`,
    p_actor: null,
  });
  return ok({ member_id: memberId, game_id: body.game_id, attempts: balance }, { status: 201 });
});
