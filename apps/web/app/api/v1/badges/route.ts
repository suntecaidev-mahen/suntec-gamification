import { ok, route, rpc, toAppError } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/v1/badges — badge collection with earned state and progress towards each. */
export const GET = route(async (req) => {
  const { member } = await requireMember(req);
  const db = supabaseAdmin();
  const [badges, mine, attrs] = await Promise.all([
    db.from('badges').select('id, key, name, description, icon, image_path, tier, hidden, criteria, sort').eq('status', 'active').order('sort'),
    db.from('member_badges').select('badge_id, awarded_at').eq('member_id', member.id),
    rpc<Record<string, number>>('member_attrs', { p_member: member.id }),
  ]);
  if (badges.error) throw toAppError(badges.error);
  const earned = new Map((mine.data ?? []).map((b) => [b.badge_id as string, b.awarded_at as string]));
  return ok({
    items: (badges.data ?? [])
      .filter((b) => !b.hidden || earned.has(b.id))
      .map((b) => {
        const c = (b.criteria ?? {}) as { metric?: string; op?: string; value?: number };
        const current = c.metric && c.metric !== 'monthly_rank' ? Number(attrs?.[c.metric] ?? 0) : null;
        return {
          id: b.id,
          key: b.key,
          name: b.name,
          description: b.description,
          icon: b.icon,
          image_path: b.image_path,
          tier: b.tier,
          earned: earned.has(b.id),
          awarded_at: earned.get(b.id) ?? null,
          progress: current !== null && c.value ? { current: Math.min(current, c.value), target: c.value } : null,
        };
      }),
  });
});
