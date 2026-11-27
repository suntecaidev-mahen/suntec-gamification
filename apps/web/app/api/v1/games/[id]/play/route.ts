import { after } from 'next/server';
import { AppError, playBodySchema, uuid } from '@suntec/core';
import { clientIp, fail, fingerprint, ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { deliverNow } from '@/lib/api/outbox';

type Session = { id: string; game_id: string; outcome?: { reward?: { id?: string } | null } };

/**
 * POST /api/v1/games/{id}/play — start a play. Requires an `Idempotency-Key` header
 * (a UUID generated per tap). The outcome is decided on the server; the client only
 * animates to the returned result.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req, { key: 'play', limit: 30 });
  const gameId = uuid.parse(id);
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key || key.length < 8 || key.length > 200) fail('INVALID', 'Idempotency-Key header (8-200 chars) is required');
  const body = await parseJson(req, playBodySchema);
  try {
    const session = await rpc<Session>('game_start', {
      p_member: member.id,
      p_game: gameId,
      p_idem: key,
      p_payment: body.payment,
      p_device: fingerprint(body.device_id ?? req.headers.get('x-device-id')),
      p_ip: fingerprint(clientIp(req)),
    });
    if (session.game_id !== gameId) fail('IDEMPOTENCY_MISMATCH', 'Idempotency-Key was already used for a different game');
    const txn = session.outcome?.reward?.id;
    if (txn) after(() => deliverNow([txn]));
    return ok(session, { status: 201 });
  } catch (e) {
    if (e instanceof AppError && e.code === 'VELOCITY') {
      await rpc('fraud_record', {
        p_member: member.id,
        p_kind: 'velocity',
        p_severity: 'medium',
        p_details: { game_id: gameId },
        p_device: null,
        p_ip: fingerprint(clientIp(req)),
      }).catch(() => undefined);
    }
    throw e;
  }
});
