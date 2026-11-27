import 'server-only';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../supabase/admin';
import { appEnv } from '../env';
import { rpc, sha256 } from './core';
import type { MemberRow } from './loyalty';

/**
 * Guest play from the public Play & Win link.
 * A guest is identified by a random token in an httpOnly cookie; only its SHA-256 is stored.
 * Guest winnings are held until the person signs in / signs up as a Suntec+ member.
 */
export const GUEST_COOKIE = 'sp_guest';
/** Set when Play & Win was opened from the Suntec+ app (SSO handoff): members only, no guest mode. */
export const APP_COOKIE = 'sp_app';
export const GUEST_DAYS = 30;

type CookieReader = { get(name: string): { value: string } | undefined };
type CookieWriter = {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
};

export function guestCookieOptions() {
  return {
    httpOnly: true,
    secure: appEnv() !== 'local',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: GUEST_DAYS * 24 * 60 * 60,
  };
}

export function newGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The (unclaimed, not blocked) guest for this browser, or null. */
export async function findGuest(cookies: CookieReader): Promise<(MemberRow & { claim_code: string | null }) | null> {
  const token = cookies.get(GUEST_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 100) return null;
  const { data } = await supabaseAdmin()
    .from('members')
    .select('id, suntec_member_id, status, auth_user_id, email, first_name, claim_code')
    .eq('guest_token_hash', sha256(token))
    .eq('is_guest', true)
    .is('claimed_by', null)
    .maybeSingle();
  return (data as (MemberRow & { claim_code: string | null }) | null) ?? null;
}

/**
 * Same browser, guest → member: move this browser's held guest winnings to the member
 * and forget the guest cookie. Returns how much was claimed (0 when nothing to claim).
 */
export async function claimBrowserGuest(memberId: string, cookies: CookieReader & CookieWriter): Promise<{ rewards: number; points: number }> {
  const guest = await findGuest(cookies);
  if (!guest) return { rewards: 0, points: 0 };
  try {
    const r = await rpc<{ rewards: number; points: number }>('guest_claim', { p_member: memberId, p_code: null, p_guest: guest.id });
    cookies.delete(GUEST_COOKIE);
    return { rewards: Number(r.rewards ?? 0), points: Number(r.points ?? 0) };
  } catch (e) {
    console.error('guest claim failed', e);
    return { rewards: 0, points: 0 };
  }
}
