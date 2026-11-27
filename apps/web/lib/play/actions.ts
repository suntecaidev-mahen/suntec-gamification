'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { toMemberProfile } from '@suntec/core';
import { createSupabaseServerClient } from '../supabase/server';
import { supabaseAdmin } from '../supabase/admin';
import { loyalty } from '../api/loyalty';
import { rpc } from '../api/core';
import { claimBrowserGuest } from '../api/guest';
import { serverEnv } from '../env';

/**
 * DEV/SIT only (LOYALTY_ADAPTER=mock): link the signed-in user to one of the mock
 * Capillary demo members, so Play & Win can be tested with any real inbox.
 * In production members are linked automatically by their verified email.
 * Winnings this browser earned as a guest are claimed for the member.
 */
export async function linkDemoMember(formData: FormData): Promise<void> {
  if (serverEnv().LOYALTY_ADAPTER !== 'mock') redirect('/play');
  const { data } = await (await createSupabaseServerClient()).auth.getUser();
  if (!data.user) redirect('/play/signin');
  const lm = await loyalty().getMember(String(formData.get('member_id') ?? ''));
  if (!lm) redirect('/play?link=notfound');
  const id = await rpc<string>('ensure_member', { p_suntec_member_id: lm.memberId, p_profile: toMemberProfile(lm), p_auth_user_id: data.user.id });
  const db = supabaseAdmin();
  await db.from('members').update({ auth_user_id: data.user.id }).eq('id', id).is('auth_user_id', null);
  const { data: row } = await db.from('members').select('auth_user_id').eq('id', id).single();
  if (row?.auth_user_id !== data.user.id) redirect('/play?link=taken');
  const claimed = await claimBrowserGuest(id, await cookies());
  redirect(claimed.rewards > 0 ? `/play?claimed=${claimed.points || claimed.rewards}` : '/play');
}

/** Web only: sign the member out; they can keep playing as a guest. */
export async function signOutPlay(): Promise<void> {
  await (await createSupabaseServerClient()).auth.signOut();
  redirect('/play');
}
