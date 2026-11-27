import { ok, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/rewards — rewards catalogue redeemable with Play Points. */
export const GET = route(async (req) => {
  await requireMember(req);
  const { data, error } = await supabaseAdmin()
    .from('rewards')
    .select(
      'id, key, type, name, description, image_path, value, pp_cost, validity_days, terms, per_member_cap, per_member_period, sort, reward_categories(key, name, icon, sort), reward_inventory(remaining_qty, low_stock_threshold)',
    )
    .eq('in_catalogue', true)
    .eq('status', 'active')
    .order('sort');
  if (error) throw toAppError(error);
  return ok({
    items: (data ?? []).map((r) => {
      const invRaw = r.reward_inventory as unknown;
      const inv = (Array.isArray(invRaw) ? invRaw[0] : invRaw) as { remaining_qty: number | null; low_stock_threshold: number } | null;
      const cat = r.reward_categories as unknown as { key: string; name: string; icon: string } | null;
      const value = (r.value ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        description: r.description,
        image_path: r.image_path,
        pp_cost: r.pp_cost,
        validity_days: r.validity_days,
        terms: r.terms,
        limit: r.per_member_cap ? { count: r.per_member_cap, period: r.per_member_period } : null,
        face_value_cents: (value.face_value_cents as number) ?? null,
        category: cat,
        in_stock: !inv || inv.remaining_qty === null || inv.remaining_qty > 0,
        low_stock: Boolean(inv && inv.remaining_qty !== null && inv.remaining_qty <= inv.low_stock_threshold),
      };
    }),
  });
});
