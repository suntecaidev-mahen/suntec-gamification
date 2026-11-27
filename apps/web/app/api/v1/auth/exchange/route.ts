import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';
import { sha256 } from '@/lib/api/core';
import { APP_COOKIE, GUEST_COOKIE } from '@/lib/api/guest';

/**
 * GET /api/v1/auth/exchange?code=…  — SSO handoff for the in-app WebView.
 * Consumes a single-use code created by POST /integrations/sessions, signs the member in
 * (Supabase session cookie, no password) and redirects into Play & Win (/play) in app mode.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const failTo = (reason: string) => NextResponse.redirect(new URL(`/play/error?reason=${reason}`, origin));
  const code = req.nextUrl.searchParams.get('code');
  if (!code || code.length < 20 || code.length > 100) return failTo('invalid');

  try {
    const db = supabaseAdmin();
    const { data: handoff } = await db
      .from('session_handoffs')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', sha256(code))
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('member_id, entry')
      .maybeSingle();
    if (!handoff) return failTo('expired');

    const { data: member } = await db
      .from('members')
      .select('id, suntec_member_id, email, auth_user_id, status, first_name')
      .eq('id', handoff.member_id)
      .single();
    if (!member || member.status === 'blocked') return failTo('blocked');

    // One Supabase Auth user per member: reuse the linked user, else the member's email,
    // else a non-routable synthetic address (never emailed).
    const synthetic = `${String(member.suntec_member_id).toLowerCase().replace(/[^a-z0-9._-]/g, '-')}@members.invalid`;
    let email: string | null = null;
    if (member.auth_user_id) {
      const u = await db.auth.admin.getUserById(member.auth_user_id);
      email = u.data.user?.email ?? null;
    }
    const candidates = [email, member.email, synthetic].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);

    let tokenHash: string | null = null;
    for (const candidate of candidates) {
      const link = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: candidate,
        options: { data: { suntec_member_id: member.suntec_member_id, first_name: member.first_name } },
      });
      if (link.error || !link.data.user) continue;
      if (!member.auth_user_id) {
        const upd = await db.from('members').update({ auth_user_id: link.data.user.id }).eq('id', member.id).is('auth_user_id', null).select('id');
        if (upd.error) continue; // that login already belongs to another member → try the next candidate
      } else if (member.auth_user_id !== link.data.user.id) {
        continue;
      }
      tokenHash = link.data.properties.hashed_token;
      break;
    }
    if (!tokenHash) return failTo('signin');

    const entry = (handoff.entry ?? '').replace(/^\/embed/, '/play');
    const target = entry.startsWith('/play') ? entry : '/play';
    const response = NextResponse.redirect(new URL(target, origin));
    // Opened from the Suntec+ app: members only (no guest mode), native bridge events on.
    response.cookies.set(APP_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/' });
    response.cookies.delete(GUEST_COOKIE);
    const env = publicEnv();
    const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        },
      },
    });
    const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
    if (error) return failTo('signin');
    return response;
  } catch (e) {
    console.error('handoff exchange failed', e);
    return failTo('server');
  }
}
