import { after } from 'next/server';
import { checkinBodySchema } from '@suntec/core';
import { fingerprint, ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { deliverNow } from '@/lib/api/outbox';

/** GET /api/v1/checkin — streak, ladder and whether I have checked in today. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req, undefined, { guests: true });
  return ok(await rpc('checkin_status', { p_member: member.id, p_program: null }));
});

/** POST /api/v1/checkin — daily check-in (once per business day, SGT). Safe to retry. */
export const POST = route(async (req) => {
  const { member } = await requireMember(req, { key: 'checkin', limit: 20 }, { guests: true });
  const body = await parseJson(req, checkinBodySchema);
  const result = await rpc<{ rewards?: { id?: string }[] }>('checkin', {
    p_member: member.id,
    p_program: body.program_id ?? null,
    p_source: 'app',
    p_qr: null,
    p_device: fingerprint(body.device_id ?? req.headers.get('x-device-id')),
  });
  const ids = (result.rewards ?? []).map((r) => r.id);
  if (ids.length) after(() => deliverNow(ids));
  return ok(result);
});
