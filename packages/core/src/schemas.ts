import { z } from 'zod';
import { GAME_TYPES, REWARD_TYPES } from './constants';

/**
 * Zod schemas for every API request body and every admin-configurable JSON column.
 * The API rejects anything that does not match; the DB re-checks critical invariants.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
export const uuid = z.uuid();
export const deviceId = z.string().trim().min(4).max(128);
export const idempotencyKey = z.string().trim().min(8).max(200);

export const memberProfileSchema = z.object({
  card_no: z.string().max(64).optional(),
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
  email: z.email().max(254).optional(),
  mobile: z.string().max(32).optional(),
  tier: z.string().max(32).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  joined_at: z.iso.datetime({ offset: true }).optional(),
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;

// ---------------------------------------------------------------------------
// Customer API
// ---------------------------------------------------------------------------
export const playBodySchema = z.object({
  payment: z.enum(['auto', 'free', 'attempt', 'play_points']).default('auto'),
  device_id: deviceId.optional(),
});

export const quizSubmitBodySchema = z.object({
  answers: z
    .array(z.object({ question_id: uuid, option_id: uuid.nullable().optional() }))
    .max(50),
});

export const checkinBodySchema = z.object({
  program_id: uuid.optional(),
  device_id: deviceId.optional(),
});

export const qrScanBodySchema = z.object({
  token: z.string().trim().min(8).max(160),
  device_id: deviceId.optional(),
});

export const preferencesBodySchema = z
  .object({
    lb_display_mode: z.enum(['masked', 'nickname', 'hidden']).optional(),
    lb_nickname: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, dots, dashes and underscores only')
      .nullable()
      .optional(),
    lb_opt_out: z.boolean().optional(),
    notify_push: z.boolean().optional(),
    notify_email: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one preference');

export const notificationsReadBodySchema = z
  .object({ ids: z.array(uuid).max(100).optional(), all: z.boolean().optional() })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), 'Provide ids or all=true');

export const leaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'overall']).optional(),
  limit: z.coerce.number().int().min(3).max(100).optional(),
});

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.iso.datetime({ offset: true }).optional(),
});

// ---------------------------------------------------------------------------
// Integration API (server-to-server, X-API-Key)
// ---------------------------------------------------------------------------
export const handoffBodySchema = z.object({
  member_id: z.string().trim().min(1).max(64),
  profile: memberProfileSchema.optional(),
  entry: z.enum(['home', 'games', 'spin', 'scratch', 'quiz', 'missions', 'rewards', 'badges', 'leaderboard', 'inbox', 'checkin']).default('home'),
  game_id: uuid.optional(),
});

export const EVENT_TYPES = ['transaction', 'mall_visit', 'voucher_redeemed', 'campaign_participation', 'activity'] as const;

export const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  external_id: z.string().trim().min(1).max(128),
  member_id: z.string().trim().min(1).max(64),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  payload: z
    .object({
      amount_cents: z.number().int().min(0).max(100_000_000).optional(),
      merchant_code: z.string().max(64).optional(),
      voucher_ref: z.string().max(128).optional(),
      voucher_code: z.string().max(128).optional(),
      campaign_id: uuid.optional(),
    })
    .catchall(z.unknown())
    .default({}),
  profile: memberProfileSchema.optional(),
});
export type InboundEvent = z.infer<typeof eventSchema>;

export const eventsBodySchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema).min(1).max(100) }),
]);

/** Claim code a guest received after playing (e.g. "7K3M-Q9XD"); spaces/dashes are ignored. */
export const claimBodySchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9]{8}$/, 'Enter the 8-character claim code')),
});

export const attemptGrantBodySchema = z.object({
  game_id: uuid,
  count: z.number().int().min(1).max(20),
  reason: z.string().trim().min(3).max(200),
  external_id: z.string().trim().min(1).max(128),
});

// ---------------------------------------------------------------------------
// Admin-configurable JSON columns
// ---------------------------------------------------------------------------
const optInt = (min = 0, max = 1_000_000) => z.number().int().min(min).max(max).nullable().optional();

export const attemptRulesSchema = z.object({
  free_per_day: z.number().int().min(0).max(100).default(1),
  pp_cost: optInt(1),
  max_per_day: optInt(1, 1000),
  max_per_week: optInt(1, 10_000),
  max_per_campaign: optInt(1, 100_000),
  cooldown_seconds: z.number().int().min(0).max(86_400).default(10),
  session_ttl_seconds: z.number().int().min(30).max(3600).default(180),
});
export type AttemptRules = z.infer<typeof attemptRulesSchema>;

export const campaignLimitsSchema = z.object({
  per_day: optInt(1, 1000),
  per_week: optInt(1, 10_000),
  per_campaign: optInt(1, 100_000),
  cooldown_seconds: optInt(0, 86_400),
});

export const spinConfigSchema = z.object({ spin_duration_ms: z.number().int().min(1500).max(12_000).default(4500) });
export const scratchConfigSchema = z.object({ reveal_threshold: z.number().min(0.2).max(0.95).default(0.6) });
export const quizConfigSchema = z.object({
  questions_per_session: z.number().int().min(1).max(30).default(5),
  time_limit_s: z.number().int().min(5).max(300).default(20),
  pass_percent: z.number().int().min(0).max(100).default(60),
  speed_bonus: z.boolean().default(true),
  shuffle: z.boolean().default(true),
  reward_tiers: z
    .array(z.object({ min_correct: z.number().int().min(0).max(30), reward_id: uuid, qty: z.number().int().min(1).max(100).optional() }))
    .max(10)
    .default([]),
});

export const gameConfigSchemas = {
  spin_wheel: spinConfigSchema,
  scratch_card: scratchConfigSchema,
  quiz: quizConfigSchema,
} as const;

export const gameTypeSchema = z.enum(GAME_TYPES);

export const outcomeDisplaySchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(32).optional(),
  image: z.string().max(512).optional(),
});

export const outcomeInputSchema = z.object({
  id: uuid.optional(),
  position: z.number().int().min(0).max(50),
  label: z.string().trim().min(1).max(40),
  display: outcomeDisplaySchema.default({}),
  reward_id: uuid.nullable(),
  reward_qty: z.number().int().min(1).max(1000).default(1),
  weight_bp: z.number().int().min(0).max(10_000),
  fallback_strategy: z.enum(['none', 'outcome', 'renormalize']).default('renormalize'),
  fallback_position: z.number().int().min(0).max(50).nullable().optional(),
});
export type OutcomeInput = z.infer<typeof outcomeInputSchema>;

export const rewardSpecSchema = z.array(z.object({ reward_id: uuid, qty: z.number().int().min(1).max(1000).default(1) })).max(10);

export const rewardTypeSchema = z.enum(REWARD_TYPES);

/** Per reward-type value schema (rewards.value). */
export const rewardValueSchemas = {
  play_points: z.object({ amount: z.number().int().min(1).max(1_000_000) }),
  bonus_attempt: z.object({ count: z.number().int().min(1).max(20), game_id: uuid.nullable().optional() }),
  capillary_points: z.object({ points: z.number().int().min(1).max(1_000_000) }),
  digital_voucher: z.object({ series_id: z.string().min(1).max(64), face_value_cents: z.number().int().min(0).optional() }),
  merchant_voucher: z.object({
    merchant_id: uuid.optional(),
    source: z.enum(['vms', 'code_pool']).default('vms'),
    series_id: z.string().max(64).optional(),
    face_value_cents: z.number().int().min(0).optional(),
  }),
  promo_gift: z.object({ collect_at: z.string().max(200).optional() }),
  exclusive_reward: z.object({ fulfilment: z.enum(['manual', 'code_pool']).default('manual') }),
  privilege: z.object({ duration_days: z.number().int().min(1).max(3650).optional(), benefit: z.string().max(200).optional() }),
  none: z.object({}),
} as const;

export const missionObjectiveSchema = z.object({
  distinct_days: z.boolean().optional(),
  participating_only: z.boolean().optional(),
  merchant_ids: z.array(uuid).max(50).optional(),
  campaign_id: uuid.optional(),
  game_id: uuid.optional(),
});

export const badgeCriteriaSchema = z.object({
  metric: z.enum([
    'checkins_total',
    'checkin_streak',
    'missions_completed',
    'games_played',
    'quiz_wins',
    'distinct_stores',
    'visits_count',
    'lifetime_spend_cents',
    'monthly_rank',
    'pp_lifetime_earned',
  ]),
  op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']).default('gte'),
  value: z.number(),
});

export const prizeRulesSchema = z
  .array(
    z.object({
      period: z.enum(['daily', 'weekly', 'monthly']),
      rank_from: z.number().int().min(1),
      rank_to: z.number().int().min(1),
      rewards: rewardSpecSchema,
    }),
  )
  .max(10);
