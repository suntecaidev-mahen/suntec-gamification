import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { linkMemberForUser } from '@/lib/api/loyalty';
import { claimBrowserGuest } from '@/lib/api/guest';

/**
 * GET /auth/claim?next=/play — after a member signs in with the 6-digit email code
 * (verified in the browser), move this browser's guest winnings to their account.
 * (Email-link sign-ins do the same inside /auth/callback.)
 */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next');
  const target = new URL(next && next.startsWith('/') && !next.startsWith('//') ? next : '/play', req.nextUrl.origin);
  const { data } = await (await createSupabaseServerClient()).auth.getUser();
  if (data.user) {
    const member = await linkMemberForUser(data.user).catch(() => null);
    if (member) {
      const claimed = await claimBrowserGuest(member.id, await cookies());
      if (claimed.rewards > 0) target.searchParams.set('claimed', String(claimed.points || claimed.rewards));
    }
  }
  return NextResponse.redirect(target);
}
