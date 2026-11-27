import 'server-only';
import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { createSupabaseServerClient } from '../supabase/server';
import { enforceRateLimit, fail, sha256 } from './core';
import { linkMemberForUser, type MemberRow } from './loyalty';
import { findGuest } from './guest';

export interface MemberContext {
  user: User | null;
  member: MemberRow;
  /** True for a guest playing from the public link (winnings are held until claimed). */
  guest: boolean;
}

/**
 * Resolves the calling customer from either
 *   - `Authorization: Bearer <supabase access token>` (native apps / WebView fallback), or
 *   - the Supabase session cookie (Play & Win web and in-app), or
 *   - with `{ guests: true }`: the guest cookie of someone playing from the public link.
 * Then maps the auth user to the gamification member (linking by email on first use).
 */
export async function requireMember(
  req: NextRequest,
  rate: { key: string; limit: number } = { key: 'api', limit: 120 },
  opts: { guests?: boolean } = {},
): Promise<MemberContext> {
  let user: User | null = null;
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const { data } = await supabaseAdmin().auth.getUser(auth.slice(7).trim());
    user = data.user ?? null;
  } else {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  }
  if (!user) {
    const guest = opts.guests ? await findGuest(req.cookies) : null;
    if (!guest) fail('UNAUTHENTICATED', opts.guests ? 'Your session has ended. Please reload the page.' : 'Please sign in as a Suntec+ member');
    if (guest.status === 'blocked') fail('MEMBER_BLOCKED', 'Play & Win is not available on this device.');
    await enforceRateLimit(`m:${guest.id}:${rate.key}`, rate.limit, 60);
    return { user: null, member: guest, guest: true };
  }

  const member = await linkMemberForUser(user);
  if (!member) fail('MEMBER_NOT_LINKED', 'This login is not linked to a Suntec+ membership');
  if (member.status === 'blocked') fail('MEMBER_BLOCKED', 'Your Play & Win access is suspended. Please contact Suntec+ Customer Service.');

  await enforceRateLimit(`m:${member.id}:${rate.key}`, rate.limit, 60);
  return { user, member, guest: false };
}

export interface ClientContext {
  id: string;
  name: string;
  scopes: string[];
}

/**
 * Server-to-server authentication for the Suntec+ backend / Capillary / POS:
 * `X-API-Key: sk_live_…` (stored as SHA-256 only) with scope checks and per-client rate limits.
 */
export async function requireClient(req: NextRequest, scope: string): Promise<ClientContext> {
  const key = req.headers.get('x-api-key')?.trim();
  if (!key || key.length < 20) fail('INVALID_API_KEY', 'Missing or invalid X-API-Key header');
  const { data } = await supabaseAdmin()
    .from('api_clients')
    .select('id, name, scopes, active, expires_at, revoked_at, rate_limit_per_min')
    .eq('key_hash', sha256(key))
    .maybeSingle();
  if (!data || !data.active || data.revoked_at || (data.expires_at && new Date(data.expires_at) < new Date())) {
    fail('INVALID_API_KEY', 'API key is invalid, expired or revoked');
  }
  if (!(data.scopes as string[]).includes(scope)) fail('INSUFFICIENT_SCOPE', `API key lacks scope ${scope}`);
  await enforceRateLimit(`c:${data.id}`, data.rate_limit_per_min, 60);
  void supabaseAdmin().from('api_clients').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => undefined);
  return { id: data.id, name: data.name, scopes: data.scopes };
}

/** Cron / scheduler authentication: `Authorization: Bearer $CRON_SECRET`. */
export function requireCron(req: NextRequest, secret: string | undefined) {
  if (!secret) fail('NOT_CONFIGURED', 'CRON_SECRET is not configured');
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) fail('UNAUTHENTICATED', 'Invalid cron secret');
}
