import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Permission } from '@suntec/core';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../env';

export interface StaffSession {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: Set<string>;
  can: (p: Permission) => boolean;
}

/**
 * The signed-in staff user (or null). Everything the admin panel reads or writes goes
 * through this user's own Supabase session, so RLS + audit triggers apply to every change.
 */
export const getStaff = cache(async (): Promise<StaffSession | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [{ data: staff }, { data: perms }, { data: roles }] = await Promise.all([
    supabase.from('staff_users').select('id, email, display_name, active').eq('id', auth.user.id).maybeSingle(),
    supabase.rpc('my_permissions'),
    supabase.from('staff_user_roles').select('role_key').eq('user_id', auth.user.id),
  ]);
  if (!staff || !staff.active) return null;
  const permissions = new Set<string>((perms as string[] | null) ?? []);
  return {
    userId: auth.user.id,
    email: staff.email,
    displayName: staff.display_name,
    roles: (roles ?? []).map((r) => r.role_key as string),
    permissions,
    can: (p) => permissions.has(p),
  };
});

/** Guard for admin pages: redirects to login, or to the dashboard when a permission is missing. */
export async function requireStaff(permission?: Permission | Permission[]): Promise<StaffSession> {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const needed = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];
  if (needed.length > 0 && !needed.some((p) => staff.can(p))) redirect('/admin?denied=1');
  return staff;
}

/** Guard for server actions (returns an error message instead of redirecting). */
export async function staffCan(permission: Permission | Permission[]): Promise<StaffSession | null> {
  const staff = await getStaff();
  if (!staff) return null;
  const needed = Array.isArray(permission) ? permission : [permission];
  return needed.some((p) => staff.can(p)) ? staff : null;
}
