import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { supabaseAdmin } from '../supabase/admin';
import { linkMemberForUser } from '../api/loyalty';
import { rpc } from '../api/core';
import { isSupabaseConfigured, serverEnv } from '../env';

export type PlayGateResult =
  | { state: 'unconfigured' }
  | { state: 'anon' }
  | { state: 'not_linked'; email: string | null; demo: boolean }
  | { state: 'blocked' }
  | { state: 'ok'; memberId: string; initial: { pp_balance: number; unread: number; first_name: string | null } };

/** Resolves the signed-in customer for /portal and /embed (links by email on first visit). */
export async function resolvePlayMember(): Promise<PlayGateResult> {
  if (!isSupabaseConfigured()) return { state: 'unconfigured' };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { state: 'anon' };
  const member = await linkMemberForUser(data.user);
  if (!member) return { state: 'not_linked', email: data.user.email ?? null, demo: serverEnv().LOYALTY_ADAPTER === 'mock' };
  if (member.status === 'blocked') return { state: 'blocked' };
  const s = await rpc<{ pp_balance: number; unread_notifications: number; member: { first_name: string | null } }>('member_summary', { p_member: member.id });
  return { state: 'ok', memberId: member.id, initial: { pp_balance: Number(s.pp_balance), unread: Number(s.unread_notifications), first_name: s.member.first_name } };
}

/** DEV/SIT only: demo members from the mock Capillary schema. */
export async function listDemoMembers(): Promise<{ member_id: string; name: string; tier: string; linked: boolean }[]> {
  if (serverEnv().LOYALTY_ADAPTER !== 'mock') return [];
  const { data } = await supabaseAdmin().rpc('mock_cap_list_members');
  return (data as { member_id: string; name: string; tier: string; linked: boolean }[] | null) ?? [];
}
