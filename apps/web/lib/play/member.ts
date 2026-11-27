import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getVerifiedUser } from '../supabase/server';
import { supabaseAdmin } from '../supabase/admin';
import { linkMemberForUser } from '../api/loyalty';
import { APP_COOKIE, findGuest } from '../api/guest';
import { isSupabaseConfigured, serverEnv } from '../env';

export type PlayMode = 'app' | 'web';
export type Viewer = { guest: boolean; firstName: string | null; claimCode: string | null };

export type PlayGateResult =
  | { state: 'unconfigured' }
  /** Public link, first visit: the browser needs a guest session (created client-side). */
  | { state: 'new_visitor' }
  /** Opened from the Suntec+ app but the session is gone: ask to reopen from the app. */
  | { state: 'app_session_ended' }
  | { state: 'not_linked'; email: string | null; demo: boolean }
  | { state: 'blocked' }
  | { state: 'ok'; memberId: string; mode: PlayMode; viewer: Viewer };

/**
 * Who is playing? In order: a signed-in Suntec+ member (from the app or a web sign-in),
 * otherwise this browser's guest, otherwise a new visitor.
 */
export const resolvePlayMember = cache(async (): Promise<PlayGateResult> => {
  if (!isSupabaseConfigured()) return { state: 'unconfigured' };
  const jar = await cookies();
  const mode: PlayMode = jar.get(APP_COOKIE)?.value === '1' ? 'app' : 'web';
  const user = await getVerifiedUser();

  if (user) {
    const member = await linkMemberForUser(user);
    if (!member) return { state: 'not_linked', email: user.email ?? null, demo: serverEnv().LOYALTY_ADAPTER === 'mock' };
    if (member.status === 'blocked') return { state: 'blocked' };
    return { state: 'ok', memberId: member.id, mode, viewer: { guest: false, firstName: member.first_name ?? null, claimCode: null } };
  }

  if (mode === 'app') return { state: 'app_session_ended' };
  const guest = await findGuest(jar);
  if (!guest) return { state: 'new_visitor' };
  if (guest.status === 'blocked') return { state: 'blocked' };
  return { state: 'ok', memberId: guest.id, mode: 'web', viewer: { guest: true, firstName: null, claimCode: guest.claim_code } };
});

/** DEV/SIT only: demo members from the mock Capillary schema. */
export async function listDemoMembers(): Promise<{ member_id: string; name: string; tier: string; linked: boolean }[]> {
  if (serverEnv().LOYALTY_ADAPTER !== 'mock') return [];
  const { data } = await supabaseAdmin().rpc('mock_cap_list_members');
  return (data as { member_id: string; name: string; tier: string; linked: boolean }[] | null) ?? [];
}
