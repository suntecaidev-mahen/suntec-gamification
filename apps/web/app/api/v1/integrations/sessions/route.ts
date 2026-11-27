import { randomBytes } from 'node:crypto';
import { handoffBodySchema } from '@suntec/core';
import { ok, parseJson, route, rpc, sha256, toAppError, clientIp, fingerprint } from '@/lib/api/core';
import { requireClient } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';

const ENTRY_PATHS: Record<string, string> = {
  home: '/play',
  games: '/play',
  checkin: '/play',
  missions: '/play/missions',
  rewards: '/play/rewards',
  badges: '/play',
  leaderboard: '/play',
  inbox: '/play',
};

/**
 * POST /api/v1/integrations/sessions  (scope: sessions:write)
 * Called by the Suntec+ backend when a signed-in member taps "Play & Win".
 * Returns a single-use URL (60 s) that the app opens in its WebView; the code is
 * exchanged server-side for a normal session cookie. Codes are stored hashed only.
 */
export const POST = route(async (req) => {
  const client = await requireClient(req, 'sessions:write');
  const body = await parseJson(req, handoffBodySchema);
  const memberId = await rpc<string>('ensure_member', {
    p_suntec_member_id: body.member_id,
    p_profile: body.profile ?? {},
    p_auth_user_id: null,
  });
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60_000);
  const entry = body.game_id && ['spin', 'scratch', 'quiz'].includes(body.entry) ? `/play/games/${body.game_id}` : (ENTRY_PATHS[body.entry] ?? '/play');
  const { error } = await supabaseAdmin().from('session_handoffs').insert({
    code_hash: sha256(code),
    member_id: memberId,
    client_id: client.id,
    entry,
    expires_at: expiresAt.toISOString(),
    ip_hash: fingerprint(clientIp(req)),
  });
  if (error) throw toAppError(error);
  const base = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  return ok({ url: `${base}/api/v1/auth/exchange?code=${code}`, code, expires_at: expiresAt.toISOString(), member_ref: memberId }, { status: 201 });
});
