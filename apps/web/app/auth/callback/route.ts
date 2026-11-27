import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { linkMemberForUser } from '@/lib/api/loyalty';
import { claimBrowserGuest } from '@/lib/api/guest';

/**
 * Email link landing (Play & Win member sign-in and admin): supports both PKCE (`?code=`)
 * and token-hash (`?token_hash=&type=`) links from Supabase Auth emails.
 * A Suntec+ member who played as a guest in this browser gets the held winnings moved
 * to their account automatically.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/play';
  const admin = safeNext.startsWith('/admin');
  const supabase = await createSupabaseServerClient();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  if (!ok) return NextResponse.redirect(new URL(`${admin ? '/admin/login' : '/play/signin'}?error=link`, url.origin));

  const target = new URL(safeNext, url.origin);
  if (!admin) {
    const { data } = await supabase.auth.getUser();
    const member = data.user ? await linkMemberForUser(data.user).catch(() => null) : null;
    if (member) {
      const claimed = await claimBrowserGuest(member.id, await cookies());
      if (claimed.rewards > 0) target.searchParams.set('claimed', String(claimed.points || claimed.rewards));
    }
  }
  return NextResponse.redirect(target);
}
