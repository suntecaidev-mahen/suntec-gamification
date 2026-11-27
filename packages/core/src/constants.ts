/**
 * Domain constants mirrored from the database enums / reference data
 * (supabase/migrations/0001_extensions_enums.sql and 0002_identity_access.sql).
 * Keep in sync — the DB is the source of truth.
 */

export const GAME_TYPES = ['spin_wheel', 'scratch_card', 'quiz'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const REWARD_TYPES = [
  'play_points',
  'bonus_attempt',
  'capillary_points',
  'digital_voucher',
  'merchant_voucher',
  'promo_gift',
  'exclusive_reward',
  'privilege',
  'none',
] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export const STAFF_ROLES = [
  'super_admin',
  'campaign_admin',
  'marketing',
  'customer_service',
  'reporting',
  'read_only',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'staff.manage',
  'settings.manage',
  'api_clients.manage',
  'campaigns.read',
  'campaigns.write',
  'campaigns.publish',
  'games.write',
  'missions.write',
  'content.write',
  'rewards.read',
  'rewards.write',
  'notifications.write',
  'customers.read',
  'customers.pii',
  'customers.act',
  'reports.read',
  'reports.export',
  'audit.read',
  'audit.read_own',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Probability weights are integer basis points; a weighted game's outcomes must sum to this. */
export const WEIGHT_TOTAL_BP = 10_000;

export const DEFAULT_TIMEZONE = 'Asia/Singapore';
export const DEFAULT_CURRENCY = 'SGD';
