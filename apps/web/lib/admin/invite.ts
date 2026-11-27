import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { publicEnv } from '../env';

/**
 * Email links for admin users. Every link lands on /auth/confirm, which signs the person in
 * and sends them to "create your password" (/admin/set-password).
 *   - New user      → Supabase "Invite user" email (inviteUserByEmail).
 *   - Existing user → Supabase "Reset password" email (e.g. resend, or a customer login promoted to staff).
 * When Supabase can't send the email (no custom SMTP yet, rate limit…), we generate the same
 * link without sending it, so the admin can pass it on securely.
 */
export type InviteResult = { userId: string; created: boolean; emailSent: boolean; link?: string; emailError?: string };

function confirmUrl(welcome: boolean): string {
  const base = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const next = `/admin/set-password${welcome ? '?welcome=1' : ''}`;
  return `${base}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function findAuthUserByEmail(email: string): Promise<{ id: string; last_sign_in_at?: string | null } | null> {
  const admin = supabaseAdmin().auth.admin;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return { id: hit.id, last_sign_in_at: hit.last_sign_in_at };
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Plain (non-PKCE) client: links in emails must work on the invitee's own device. */
function implicitClient() {
  const env = publicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Creates the login if needed and emails a link to set a password. */
export async function sendStaffInvite(email: string, displayName: string): Promise<InviteResult> {
  const admin = supabaseAdmin().auth.admin;
  const existing = await findAuthUserByEmail(email);

  if (!existing) {
    const invited = await admin.inviteUserByEmail(email, { redirectTo: confirmUrl(true), data: { display_name: displayName } });
    if (!invited.error && invited.data.user) return { userId: invited.data.user.id, created: true, emailSent: true };
    // Email not sent: create the login with a one-time invite link instead.
    const gen = await admin.generateLink({ type: 'invite', email, options: { redirectTo: confirmUrl(true), data: { display_name: displayName } } });
    if (gen.error || !gen.data.user) {
      const again = await findAuthUserByEmail(email);
      if (!again) throw new Error(invited.error?.message ?? gen.error?.message ?? 'Could not create the login');
      return linkForExisting(again.id, email, invited.error?.message);
    }
    return { userId: gen.data.user.id, created: true, emailSent: false, link: gen.data.properties.action_link, emailError: invited.error?.message };
  }

  const sent = await implicitClient().auth.resetPasswordForEmail(email, { redirectTo: confirmUrl(true) });
  if (!sent.error) return { userId: existing.id, created: false, emailSent: true };
  return linkForExisting(existing.id, email, sent.error.message);
}

async function linkForExisting(userId: string, email: string, emailError?: string): Promise<InviteResult> {
  const gen = await supabaseAdmin().auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: confirmUrl(true) } });
  if (gen.error) throw gen.error;
  return { userId, created: false, emailSent: false, link: gen.data.properties.action_link, emailError };
}

/** Last sign-in per auth user id (for the Users page). */
export async function lastSignIns(): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const admin = supabaseAdmin().auth.admin;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data.users) map.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 1000) break;
  }
  return map;
}
