'use server';

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { outcomeInputSchema, rewardSpecSchema, type Permission } from '@suntec/core';
import { z } from 'zod';
import { createSupabaseServerClient } from '../supabase/server';
import { supabaseAdmin } from '../supabase/admin';
import { staffCan } from './session';
import { getResource, type FieldDef } from './resources';
import { friendlyDbError, fromSgtInput } from './format';

export type ActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
};

const denied: ActionState = { error: 'You do not have permission to do this.' };
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
};

async function db() {
  return createSupabaseServerClient();
}

/* ----------------------------------------------------------------------------
 * Generic resource create / update
 * ------------------------------------------------------------------------- */
function coerce(field: FieldDef, fd: FormData, errors: Record<string, string>, typeValue?: string): unknown {
  const raw = str(fd, field.name);
  switch (field.type) {
    case 'checkbox':
      return fd.get(field.name) === 'on' || fd.get(field.name) === 'true';
    case 'number':
    case 'money': {
      if (raw === '') {
        if (field.required) errors[field.name] = 'Required';
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        errors[field.name] = 'Must be a number';
        return null;
      }
      if (field.min !== undefined && n < field.min) errors[field.name] = `Must be at least ${field.min}`;
      if (field.max !== undefined && n > field.max) errors[field.name] = `Must be at most ${field.max}`;
      return field.type === 'money' ? Math.round(n * 100) : n;
    }
    case 'datetime':
      return fromSgtInput(raw);
    case 'time':
      return raw || null;
    case 'multiselect':
      return fd.getAll(field.name).map(String);
    case 'tags':
      return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    case 'rewards': {
      try {
        const parsed = rewardSpecSchema.safeParse(JSON.parse(raw || '[]'));
        if (!parsed.success) {
          errors[field.name] = 'Choose a reward and quantity for every row';
          return [];
        }
        return parsed.data;
      } catch {
        errors[field.name] = 'Invalid rewards';
        return [];
      }
    }
    case 'json': {
      let value: unknown;
      try {
        value = raw ? JSON.parse(raw) : (field.default ?? {});
      } catch {
        errors[field.name] = 'Not valid JSON';
        return null;
      }
      const schema = field.schemaBy && typeValue ? field.schemaBy.map[typeValue] : field.schema;
      if (schema) {
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
          errors[field.name] = parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
          return null;
        }
        return field.schemaBy ? value : parsed.data;
      }
      return value;
    }
    default:
      if (!raw && field.required) errors[field.name] = 'Required';
      return raw === '' ? null : raw;
  }
}

export async function saveResource(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = getResource(str(fd, '__resource'));
  if (!res) return { error: 'Unknown resource' };
  if (!(await staffCan(res.writePerm))) return denied;
  const id = str(fd, '__id') || null;
  const idCol = res.idColumn ?? 'id';
  const errors: Record<string, string> = {};
  const payload: Record<string, unknown> = {};
  const m2m: FieldDef[] = [];
  const typeValue = str(fd, 'type') || undefined;
  for (const f of res.fields) {
    if (f.type === 'm2m') {
      m2m.push(f);
      continue;
    }
    if (id && f.readOnlyOnEdit) continue;
    payload[f.name] = coerce(f, fd, errors, typeValue);
  }
  if (Object.keys(errors).length > 0) return { error: 'Please fix the highlighted fields.', fieldErrors: errors };

  const supabase = await db();
  const q = id ? supabase.from(res.table).update(payload).eq(idCol, id) : supabase.from(res.table).insert(payload);
  const { data, error } = await q.select(idCol).single();
  if (error) return { error: friendlyDbError(error) };
  const savedId = String((data as unknown as Record<string, unknown>)[idCol]);

  for (const f of m2m) {
    if (!f.m2m) continue;
    const selected = fd.getAll(f.name).map(String);
    const del = await supabase.from(f.m2m.table).delete().eq(f.m2m.self, savedId);
    if (del.error) return { error: friendlyDbError(del.error) };
    if (selected.length) {
      const ins = await supabase.from(f.m2m.table).insert(selected.map((o) => ({ [f.m2m!.self]: savedId, [f.m2m!.other]: o })));
      if (ins.error) return { error: friendlyDbError(ins.error) };
    }
  }

  revalidatePath(`/admin/r/${res.key}`);
  if (!id) redirect(`/admin/r/${res.key}/${savedId}?saved=1`);
  revalidatePath(`/admin/r/${res.key}/${savedId}`);
  return { ok: true, message: `${res.singular} saved.` };
}

export async function deleteResource(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = getResource(str(fd, '__resource'));
  if (!res || !res.deletable) return { error: 'This record cannot be deleted — archive it instead.' };
  if (!(await staffCan(res.writePerm))) return denied;
  const { error } = await (await db()).from(res.table).delete().eq(res.idColumn ?? 'id', str(fd, '__id'));
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/admin/r/${res.key}`);
  redirect(`/admin/r/${res.key}?deleted=1`);
}

/* ----------------------------------------------------------------------------
 * Games: outcomes (atomic, 100% rule) and quiz bank
 * ------------------------------------------------------------------------- */
export async function saveOutcomes(gameId: string, outcomes: unknown): Promise<ActionState> {
  if (!(await staffCan('games.write'))) return denied;
  const parsed = z.array(outcomeInputSchema).min(1).max(24).safeParse(outcomes);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const { error } = await (await db()).rpc('admin_save_outcomes', { p_game: gameId, p_outcomes: parsed.data });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/admin/games/${gameId}/outcomes`);
  return { ok: true, message: 'Prizes and probabilities saved.' };
}

const questionSchema = z.object({
  id: z.string().optional(),
  category: z.string().max(40).default('general'),
  text: z.string().trim().min(3).max(500),
  explanation: z.string().max(1000).default(''),
  time_limit_s: z.number().int().min(5).max(300).nullable().optional(),
  points: z.number().int().min(0).max(10000).default(100),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  sort: z.number().int().default(100),
  options: z.array(z.object({ text: z.string().trim().min(1).max(200), is_correct: z.boolean() })).min(2).max(6),
});

export async function saveQuestion(gameId: string, question: unknown): Promise<ActionState> {
  if (!(await staffCan(['games.write', 'content.write']))) return denied;
  const parsed = questionSchema.safeParse(question);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const { error } = await (await db()).rpc('admin_save_question', { p_game: gameId, p_question: parsed.data });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/admin/games/${gameId}/questions`);
  return { ok: true, message: 'Question saved.' };
}

/* ----------------------------------------------------------------------------
 * Rewards: inventory and code pool
 * ------------------------------------------------------------------------- */
export async function saveInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await staffCan('rewards.write'))) return denied;
  const rewardId = str(fd, 'reward_id');
  const n = (k: string) => (str(fd, k) === '' ? null : Math.max(0, Math.floor(Number(str(fd, k)))));
  const total = n('total_qty');
  const remaining = total === null ? null : (n('remaining_qty') ?? total);
  if (remaining !== null && total !== null && remaining > total) return { error: 'Remaining cannot exceed total.' };
  const { error } = await (await db())
    .from('reward_inventory')
    .upsert({ reward_id: rewardId, total_qty: total, remaining_qty: remaining, daily_cap: n('daily_cap'), low_stock_threshold: n('low_stock_threshold') ?? 0 });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/admin/r/rewards/${rewardId}`);
  return { ok: true, message: 'Inventory saved.' };
}

export async function uploadCodes(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await staffCan('rewards.write'))) return denied;
  const rewardId = str(fd, 'reward_id');
  const codes = [...new Set(str(fd, 'codes').split(/[\s,;]+/).map((c) => c.trim()).filter((c) => c.length >= 3 && c.length <= 64))];
  if (codes.length === 0) return { error: 'Paste at least one code (3–64 characters each).' };
  if (codes.length > 5000) return { error: 'Upload at most 5000 codes at a time.' };
  const expires = fromSgtInput(str(fd, 'expires_at'));
  const { error, count } = await (await db())
    .from('voucher_code_pool')
    .upsert(codes.map((code) => ({ reward_id: rewardId, code, expires_at: expires })), { onConflict: 'reward_id,code', ignoreDuplicates: true, count: 'exact' });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/admin/r/rewards/${rewardId}`);
  return { ok: true, message: `${count ?? codes.length} new code(s) added (duplicates skipped).` };
}

/* ----------------------------------------------------------------------------
 * Customer service actions (admin_* RPCs check permissions and write the audit log)
 * ------------------------------------------------------------------------- */
async function callAdmin(perm: Permission, fn: string, args: Record<string, unknown>, revalidate: string, message: string): Promise<ActionState> {
  if (!(await staffCan(perm))) return denied;
  const { data, error } = await (await db()).rpc(fn, args);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(revalidate);
  return { ok: true, message, data: (data as Record<string, unknown>) ?? undefined };
}

export async function adjustPoints(_p: ActionState, fd: FormData) {
  const member = str(fd, 'member_id');
  return callAdmin('customers.act', 'admin_adjust_pp', { p_member: member, p_delta: Math.trunc(Number(str(fd, 'delta'))), p_reason: str(fd, 'reason'), p_idem: str(fd, 'idem') || randomUUID() }, `/admin/customers/${member}`, 'Play Points adjusted.');
}

export async function grantAttempts(_p: ActionState, fd: FormData) {
  const member = str(fd, 'member_id');
  return callAdmin('customers.act', 'admin_grant_attempts', { p_member: member, p_game: str(fd, 'game_id'), p_count: Math.trunc(Number(str(fd, 'count'))), p_reason: str(fd, 'reason'), p_idem: str(fd, 'idem') || randomUUID() }, `/admin/customers/${member}`, 'Attempts granted.');
}

export async function grantReward(_p: ActionState, fd: FormData) {
  const member = str(fd, 'member_id');
  return callAdmin('customers.act', 'admin_grant_reward', { p_member: member, p_reward: str(fd, 'reward_id'), p_reason: str(fd, 'reason'), p_idem: str(fd, 'idem') || randomUUID() }, `/admin/customers/${member}`, 'Reward granted.');
}

export async function setMemberStatus(_p: ActionState, fd: FormData) {
  const member = str(fd, 'member_id');
  return callAdmin('customers.act', 'admin_set_member_status', { p_member: member, p_status: str(fd, 'status'), p_reason: str(fd, 'reason') }, `/admin/customers/${member}`, 'Status updated.');
}

export async function retryReward(_p: ActionState, fd: FormData) {
  const r = await callAdmin('customers.act', 'admin_retry_reward', { p_txn: str(fd, 'txn_id') }, str(fd, 'back') || '/admin/transactions', 'Queued for retry.');
  if (r.ok) {
    const { processOutbox } = await import('../api/outbox');
    await processOutbox({ limit: 20 }).catch(() => undefined);
  }
  return r;
}

export async function cancelReward(_p: ActionState, fd: FormData) {
  return callAdmin('customers.act', 'admin_cancel_reward', { p_txn: str(fd, 'txn_id'), p_reason: str(fd, 'reason') || 'Cancelled by staff' }, str(fd, 'back') || '/admin/transactions', 'Reward cancelled.');
}

export async function markCollected(_p: ActionState, fd: FormData) {
  return callAdmin('customers.act', 'admin_mark_redeemed', { p_lookup: str(fd, 'lookup') }, '/admin/transactions', 'Marked as collected.');
}

export async function runOutboxNow(): Promise<ActionState> {
  if (!(await staffCan(['customers.act', 'settings.manage']))) return denied;
  const { processOutbox } = await import('../api/outbox');
  const r = await processOutbox({ limit: 50 });
  revalidatePath('/admin/transactions');
  return { ok: true, message: `Processed ${r.length} job(s), ${r.filter((x) => !x.ok).length} failed.` };
}

export async function resolveFraud(_p: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffCan('customers.act');
  if (!staff) return denied;
  const { error } = await (await db())
    .from('fraud_signals')
    .update({ resolved_at: new Date().toISOString(), resolved_by: staff.userId, resolution: str(fd, 'resolution') || 'Reviewed' })
    .eq('id', str(fd, 'id'));
  if (error) return { error: friendlyDbError(error) };
  revalidatePath('/admin/fraud');
  return { ok: true, message: 'Signal resolved.' };
}

/* ----------------------------------------------------------------------------
 * API clients (keys shown ONCE, stored as SHA-256)
 * ------------------------------------------------------------------------- */
export async function createApiClient(_p: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffCan('api_clients.manage');
  if (!staff) return denied;
  const name = str(fd, 'name');
  const scopes = fd.getAll('scopes').map(String).filter((s) => ['sessions:write', 'events:write', 'attempts:write', 'members:read'].includes(s));
  if (name.length < 3) return { error: 'Give the client a descriptive name.' };
  if (scopes.length === 0) return { error: 'Choose at least one scope.' };
  const key = `sk_live_${randomBytes(24).toString('base64url')}`;
  const { error } = await (await db()).from('api_clients').insert({
    name,
    scopes,
    key_prefix: key.slice(0, 12),
    key_hash: createHash('sha256').update(key, 'utf8').digest('hex'),
    rate_limit_per_min: Math.max(1, Number(str(fd, 'rate_limit_per_min') || 1200)),
    created_by: staff.userId,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath('/admin/api-clients');
  return { ok: true, message: 'API client created. Copy the key now — it will not be shown again.', data: { key } };
}

export async function revokeApiClient(_p: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await staffCan('api_clients.manage'))) return denied;
  const { error } = await (await db()).from('api_clients').update({ active: false, revoked_at: new Date().toISOString() }).eq('id', str(fd, 'id'));
  if (error) return { error: friendlyDbError(error) };
  revalidatePath('/admin/api-clients');
  return { ok: true, message: 'Key revoked.' };
}

/* ----------------------------------------------------------------------------
 * Staff & roles
 * ------------------------------------------------------------------------- */
export async function inviteStaff(_p: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffCan('staff.manage');
  if (!staff) return denied;
  const email = str(fd, 'email').toLowerCase();
  const name = str(fd, 'display_name');
  const roles = fd.getAll('roles').map(String);
  if (!z.email().safeParse(email).success) return { fieldErrors: { email: 'Enter a valid email' }, error: 'Please fix the highlighted fields.' };
  if (name.length < 2) return { fieldErrors: { display_name: 'Required' }, error: 'Please fix the highlighted fields.' };
  if (roles.length === 0) return { error: 'Choose at least one role.' };

  // Auth users can only be created with the service role (server-side, after the permission check above).
  const tempPassword = `Sp-${randomBytes(9).toString('base64url')}!`;
  const admin = supabaseAdmin().auth.admin;
  let userId: string | undefined;
  const created = await admin.createUser({ email, password: tempPassword, email_confirm: true, user_metadata: { display_name: name } });
  if (created.error) {
    const list = await admin.listUsers({ page: 1, perPage: 1000 });
    userId = list.data?.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (!userId) return { error: created.error.message };
  } else {
    userId = created.data.user.id;
  }
  const supabase = await db();
  const up = await supabase.from('staff_users').upsert({ id: userId, email, display_name: name, active: true });
  if (up.error) return { error: friendlyDbError(up.error) };
  const ins = await supabase.from('staff_user_roles').upsert(roles.map((r) => ({ user_id: userId, role_key: r, granted_by: staff.userId })));
  if (ins.error) return { error: friendlyDbError(ins.error) };
  revalidatePath('/admin/staff');
  return {
    ok: true,
    message: created.error ? 'Existing login promoted to staff.' : 'Staff user created. Share the temporary password securely; they should change it after first login.',
    data: created.error ? {} : { email, tempPassword },
  };
}

export async function updateStaff(_p: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffCan('staff.manage');
  if (!staff) return denied;
  const userId = str(fd, 'user_id');
  const roles = fd.getAll('roles').map(String);
  const active = fd.get('active') === 'on';
  if (userId === staff.userId && (!active || !roles.includes('super_admin')) && staff.roles.includes('super_admin')) {
    return { error: 'You cannot deactivate yourself or remove your own Super Administrator role.' };
  }
  const supabase = await db();
  const u = await supabase.from('staff_users').update({ active }).eq('id', userId);
  if (u.error) return { error: friendlyDbError(u.error) };
  const d = await supabase.from('staff_user_roles').delete().eq('user_id', userId);
  if (d.error) return { error: friendlyDbError(d.error) };
  if (roles.length) {
    const i = await supabase.from('staff_user_roles').insert(roles.map((r) => ({ user_id: userId, role_key: r, granted_by: staff.userId })));
    if (i.error) return { error: friendlyDbError(i.error) };
  }
  revalidatePath('/admin/staff');
  return { ok: true, message: 'Staff user updated.' };
}

/* ----------------------------------------------------------------------------
 * Settings & session
 * ------------------------------------------------------------------------- */
export async function saveSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await staffCan('settings.manage'))) return denied;
  const int = (k: string, min: number, max: number) => {
    const n = Math.trunc(Number(str(fd, k)));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };
  const tz = str(fd, 'timezone') || 'Asia/Singapore';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    return { fieldErrors: { timezone: 'Unknown IANA timezone' }, error: 'Please fix the highlighted fields.' };
  }
  const expiry = str(fd, 'pp_expiry_days');
  const { error } = await (await db())
    .from('app_settings')
    .update({
      timezone: tz,
      pp_name: str(fd, 'pp_name') || 'Play Points',
      pp_expiry_days: expiry ? int('pp_expiry_days', 1, 3650) : null,
      max_plays_per_minute: int('max_plays_per_minute', 1, 1000),
      max_members_per_device: int('max_members_per_device', 1, 100),
      auto_flag_on_high_severity: fd.get('auto_flag_on_high_severity') === 'on',
      push_daily_cap: int('push_daily_cap', 0, 50),
    })
    .eq('id', true);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Settings saved.' };
}

export async function signOut() {
  await (await db()).auth.signOut();
  redirect('/admin/login');
}
