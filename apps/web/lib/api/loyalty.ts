import 'server-only';
import { createCapillaryAdapter, createMockAdapter, toMemberProfile, type LoyaltyAdapter } from '@suntec/core';
import type { User } from '@supabase/supabase-js';
import { serverEnv } from '../env';
import { supabaseAdmin } from '../supabase/admin';
import { rpc, toAppError } from './core';

let adapter: LoyaltyAdapter | undefined;

/** The configured Suntec+ loyalty adapter (mock in DEV/SIT, Capillary REST in UAT/PROD). */
export function loyalty(): LoyaltyAdapter {
  if (adapter) return adapter;
  const env = serverEnv();
  if (env.LOYALTY_ADAPTER === 'capillary') {
    if (!env.SUNTEC_API_BASE_URL || !env.SUNTEC_API_KEY) {
      throw new Error('LOYALTY_ADAPTER=capillary requires SUNTEC_API_BASE_URL and SUNTEC_API_KEY');
    }
    adapter = createCapillaryAdapter({
      baseUrl: env.SUNTEC_API_BASE_URL,
      apiKey: env.SUNTEC_API_KEY,
      timeoutMs: env.SUNTEC_API_TIMEOUT_MS,
    });
  } else {
    adapter = createMockAdapter(async (fn, args) => {
      const { data, error } = await supabaseAdmin().rpc(fn, args);
      if (error) throw toAppError(error);
      return data;
    });
  }
  return adapter;
}

export type MemberRow = { id: string; suntec_member_id: string; status: string; auth_user_id: string | null; email: string | null };

/**
 * Links a signed-in portal user to their Suntec+ membership by verified email.
 * Returns null when the email is not a Suntec+ member.
 */
export async function linkMemberForUser(user: User): Promise<MemberRow | null> {
  const db = supabaseAdmin();
  const existing = await db.from('members').select('id, suntec_member_id, status, auth_user_id, email').eq('auth_user_id', user.id).maybeSingle();
  if (existing.data) return existing.data as MemberRow;
  if (!user.email) return null;

  const lm = await loyalty().findMemberByEmail(user.email);
  if (!lm) return null;
  const id = await rpc<string>('ensure_member', {
    p_suntec_member_id: lm.memberId,
    p_profile: toMemberProfile(lm),
    p_auth_user_id: user.id,
  });
  const row = await db.from('members').select('id, suntec_member_id, status, auth_user_id, email').eq('id', id).single();
  if (row.data && !row.data.auth_user_id) {
    // Member already existed (e.g. from POS events) without a login: attach this user.
    await db.from('members').update({ auth_user_id: user.id }).eq('id', id).is('auth_user_id', null);
    row.data.auth_user_id = user.id;
  }
  return (row.data as MemberRow) ?? null;
}
