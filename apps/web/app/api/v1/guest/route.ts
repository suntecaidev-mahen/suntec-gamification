import { cookies } from 'next/headers';
import { clientIp, enforceRateLimit, fingerprint, ok, route, rpc, sha256 } from '@/lib/api/core';
import { GUEST_COOKIE, guestCookieOptions, newGuestToken } from '@/lib/api/guest';

type Guest = { member_id: string; claim_code: string; claim_expires_at: string; claimed: boolean };

/**
 * POST /api/v1/guest — start (or resume) guest play on the public Play & Win link.
 * Sets an httpOnly guest cookie; the guest's winnings are held under a claim code
 * until they sign in or sign up as a Suntec+ member. Rate-limited per IP.
 */
export const POST = route(async (req) => {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  const device = fingerprint(req.headers.get('x-device-id'));
  if (existing && existing.length >= 20 && existing.length <= 100) {
    const g = await rpc<Guest>('guest_create', { p_token_hash: sha256(existing), p_device: device });
    if (!g.claimed) return ok({ guest: true, claim_code: g.claim_code, claim_expires_at: g.claim_expires_at });
  }
  await enforceRateLimit(`guest-ip:${fingerprint(clientIp(req)) ?? 'unknown'}`, 20, 3600);
  const token = newGuestToken();
  const g = await rpc<Guest>('guest_create', { p_token_hash: sha256(token), p_device: device });
  jar.set(GUEST_COOKIE, token, guestCookieOptions());
  return ok({ guest: true, claim_code: g.claim_code, claim_expires_at: g.claim_expires_at }, { status: 201 });
});
