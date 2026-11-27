import { z } from 'zod';

/**
 * Declarative segment / eligibility rule grammar. The SAME grammar is evaluated
 * authoritatively in SQL (public.rules_match) — this TypeScript evaluator powers
 * admin previews ("would this member qualify?") and is kept in sync by tests.
 */
export const RULE_OPS = ['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;
export type RuleOp = (typeof RULE_OPS)[number];

/** Member attributes the rules can reference (see public.member_attrs). */
export const RULE_FIELDS = [
  'tier',
  'tags',
  'status',
  'joined_days',
  'checkins_total',
  'checkin_streak',
  'best_streak',
  'missions_completed',
  'games_played',
  'quiz_wins',
  'badges_count',
  'visits_count',
  'distinct_stores',
  'lifetime_spend_cents',
  'pp_balance',
  'pp_lifetime_earned',
] as const;

export const ruleConditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(RULE_OPS),
  value: z.unknown().optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleSetSchema = z.object({
  all: z.array(ruleConditionSchema).max(20).optional(),
  any: z.array(ruleConditionSchema).max(20).optional(),
  segments_any: z.array(z.uuid()).max(20).optional(),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

export type MemberAttrs = Record<string, unknown>;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function evaluateCondition(attrs: MemberAttrs, cond: RuleCondition): boolean {
  const v = attrs[cond.field];
  const val = cond.value;
  switch (cond.op) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const n = toNumber(v);
      const t = toNumber(val);
      if (n === null || t === null) return false;
      return cond.op === 'gt' ? n > t : cond.op === 'gte' ? n >= t : cond.op === 'lt' ? n < t : n <= t;
    }
    case 'eq':
      return v !== undefined && v !== null && deepEqual(v, val);
    case 'neq':
      return v === undefined || v === null || !deepEqual(v, val);
    case 'in':
    case 'nin': {
      let hit = false;
      if (v !== undefined && v !== null && Array.isArray(val)) {
        hit = Array.isArray(v) ? v.some((e) => val.some((x) => deepEqual(x, e))) : val.some((x) => deepEqual(x, v));
      }
      return cond.op === 'in' ? hit : !hit;
    }
    case 'contains':
      return Array.isArray(v) && v.some((e) => deepEqual(e, val));
    case 'exists':
      return v !== undefined && v !== null;
  }
}

/** Evaluates a rule set (segments_any is resolved server-side and ignored here). */
export function evaluateRules(attrs: MemberAttrs, rules: RuleSet | null | undefined): boolean {
  if (!rules) return true;
  for (const c of rules.all ?? []) if (!evaluateCondition(attrs, c)) return false;
  if (rules.any && rules.any.length > 0 && !rules.any.some((c) => evaluateCondition(attrs, c))) return false;
  return true;
}
