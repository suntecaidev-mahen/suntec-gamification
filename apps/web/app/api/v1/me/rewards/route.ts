import { ok, route, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/me/rewards — "My Rewards" wallet (vouchers, gifts, privileges, Suntec+ points). */
export const GET = route(async (req) => {
  const { member } = await requireMember(req, undefined, { guests: true });
  const { data, error } = await supabaseAdmin()
    .from('reward_transactions')
    .select('id, ref, reward_id, reward_type, reward_snapshot, quantity, source, status, voucher_code, claim_token, pp_cost, issued_at, expires_at, redeemed_at, created_at')
    .eq('member_id', member.id)
    .not('reward_type', 'in', '(play_points,bonus_attempt,none)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw toAppError(error);
  return ok({
    items: (data ?? []).map((t) => {
      const snap = (t.reward_snapshot ?? {}) as Record<string, unknown>;
      const value = (snap.value ?? {}) as Record<string, unknown>;
      return {
        id: t.id,
        ref: t.ref,
        reward_id: t.reward_id,
        type: t.reward_type,
        name: snap.name,
        description: snap.description,
        image_path: snap.image_path,
        terms: snap.terms,
        points: t.reward_type === 'capillary_points' ? Number(value.points ?? 0) * t.quantity : null,
        collect_at: value.collect_at ?? null,
        source: t.source,
        status: t.status,
        voucher_code: t.voucher_code,
        claim_token: t.claim_token,
        pp_cost: t.pp_cost,
        issued_at: t.issued_at,
        expires_at: t.expires_at,
        redeemed_at: t.redeemed_at,
        created_at: t.created_at,
      };
    }),
  });
});
