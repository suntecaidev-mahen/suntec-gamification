import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Email link landing (portal & admin): supports both PKCE (`?code=`) and
 * token-hash (`?token_hash=&type=`) links from Supabase Auth emails.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/portal';
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
  return NextResponse.redirect(new URL(ok ? safeNext : `${safeNext.startsWith('/admin') ? '/admin/login' : '/portal/login'}?error=link`, url.origin));
}
