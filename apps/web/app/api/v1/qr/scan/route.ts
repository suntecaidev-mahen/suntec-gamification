import { after } from 'next/server';
import { qrScanBodySchema } from '@suntec/core';
import { fingerprint, ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { processOutbox } from '@/lib/api/outbox';

/** POST /api/v1/qr/scan — location-verified check-in, mall visit, mission or event QR. */
export const POST = route(async (req) => {
  const { member } = await requireMember(req, { key: 'qr', limit: 20 });
  const body = await parseJson(req, qrScanBodySchema);
  const result = await rpc('qr_scan', {
    p_member: member.id,
    p_token: body.token,
    p_device: fingerprint(body.device_id ?? req.headers.get('x-device-id')),
  });
  after(async () => {
    await processOutbox({ limit: 10 }).catch(() => undefined);
  });
  return ok(result);
});
