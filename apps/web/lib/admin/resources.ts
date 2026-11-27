import type { ZodType } from 'zod';
import {
  attemptRulesSchema,
  badgeCriteriaSchema,
  campaignLimitsSchema,
  gameConfigSchemas,
  rewardValueSchemas,
  missionObjectiveSchema,
  prizeRulesSchema,
  ruleSetSchema,
  type Permission,
} from '@suntec/core';

/**
 * Declarative admin resources. Each entry drives a list screen, a create/edit form and a
 * server action that validates input and writes through the staff user's session
 * (RLS-enforced and audited). Specialised editors (wheel outcomes, quiz bank, customers…)
 * live in their own pages.
 */
export type Option = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'money'
    | 'datetime'
    | 'time'
    | 'select'
    | 'ref'
    | 'checkbox'
    | 'json'
    | 'rewards'
    | 'multiselect'
    | 'm2m'
    | 'tags';
  required?: boolean;
  help?: string;
  options?: Option[];
  /** ref/m2m: table + label column to load options from */
  ref?: { table: string; label: string; filter?: Record<string, string> };
  /** m2m: join table and its two foreign keys */
  m2m?: { table: string; self: string; other: string };
  /** json: schema used to validate the parsed value */
  schema?: ZodType;
  /** json: pick the schema from another field's value (e.g. reward type) */
  schemaBy?: { field: string; map: Record<string, ZodType> };
  default?: unknown;
  readOnlyOnEdit?: boolean;
  placeholder?: string;
  width?: 'full' | 'half' | 'third';
  min?: number;
  max?: number;
  step?: number;
};

export type ColumnDef = { key: string; label: string; format?: 'date' | 'datetime' | 'status' | 'bool' | 'money' | 'percent' };

export type ResourceDef = {
  key: string;
  title: string;
  singular: string;
  description: string;
  table: string;
  idColumn?: string;
  select: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  orderBy: { column: string; ascending?: boolean };
  search?: string[];
  readPerm: Permission;
  writePerm: Permission[];
  deletable?: boolean;
  links?: (row: Record<string, unknown>) => { href: string; label: string }[];
};

const lifecycle: Option[] = ['draft', 'scheduled', 'active', 'paused', 'ended', 'archived'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
const recordStatus: Option[] = ['active', 'inactive', 'archived'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
const opts = (...v: string[]): Option[] => v.map((x) => ({ value: x, label: x.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));

const campaignRef: FieldDef = { name: 'campaign_id', label: 'Campaign', type: 'ref', ref: { table: 'campaigns', label: 'name' }, help: 'Leave empty for always-on / platform-wide.' };
const eligibilityRef: FieldDef = { name: 'eligibility_rule_id', label: 'Eligibility rule', type: 'ref', ref: { table: 'eligibility_rules', label: 'name' } };
const schedule: FieldDef[] = [
  { name: 'starts_at', label: 'Starts (SGT)', type: 'datetime', width: 'half' },
  { name: 'ends_at', label: 'Ends (SGT)', type: 'datetime', width: 'half' },
];

export const RESOURCES: Record<string, ResourceDef> = {
  campaigns: {
    key: 'campaigns',
    title: 'Campaigns',
    singular: 'Campaign',
    description: 'Containers for games, missions and rewards with schedule, audience and participation limits.',
    table: 'campaigns',
    select: 'id, name, slug, status, priority, starts_at, ends_at',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'priority', label: 'Priority' },
      { key: 'starts_at', label: 'Starts', format: 'datetime' },
      { key: 'ends_at', label: 'Ends', format: 'datetime' },
    ],
    orderBy: { column: 'priority' },
    search: ['name', 'slug'],
    readPerm: 'campaigns.read',
    writePerm: ['campaigns.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'slug', label: 'Slug', type: 'text', required: true, width: 'half', help: 'Lowercase, used in links, e.g. year-end-spin' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', options: lifecycle, default: 'draft', width: 'third', help: 'Changing status needs the Publish permission.' },
      { name: 'priority', label: 'Priority', type: 'number', default: 100, width: 'third', help: 'Lower shows first' },
      { ...eligibilityRef, width: 'third' },
      ...schedule,
      { name: 'segments', label: 'Target segments', type: 'm2m', ref: { table: 'segments', label: 'name' }, m2m: { table: 'campaign_segments', self: 'campaign_id', other: 'segment_id' }, help: 'None selected = all members.' },
      { name: 'limits', label: 'Participation limits (JSON)', type: 'json', schema: campaignLimitsSchema, default: {}, help: '{"per_day":10,"per_week":40,"per_campaign":300,"cooldown_seconds":10} — across all games in the campaign.' },
      { name: 'banner_path', label: 'Banner image URL', type: 'text', placeholder: 'https://… or storage path' },
      { name: 'terms', label: 'Terms & conditions', type: 'textarea' },
    ],
  },
  games: {
    key: 'games',
    title: 'Games',
    singular: 'Game',
    description: 'Spin & Win wheels, scratch cards and quizzes: schedule, attempt rules and display config.',
    table: 'games',
    select: 'id, name, type, status, priority, starts_at, ends_at, campaigns(name)',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'campaigns.name', label: 'Campaign' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'ends_at', label: 'Ends', format: 'datetime' },
    ],
    orderBy: { column: 'priority' },
    search: ['name', 'slug'],
    readPerm: 'campaigns.read',
    writePerm: ['games.write'],
    links: (row) => [
      ...(row.type === 'quiz' ? [{ href: `/admin/games/${row.id}/questions`, label: 'Question bank' }] : [{ href: `/admin/games/${row.id}/outcomes`, label: 'Prizes & probabilities' }]),
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'slug', label: 'Slug', type: 'text', required: true, width: 'half' },
      { name: 'type', label: 'Game type', type: 'select', options: [{ value: 'spin_wheel', label: 'Spin & Win wheel' }, { value: 'scratch_card', label: 'Scratch & Win card' }, { value: 'quiz', label: 'Quiz & Trivia' }], required: true, readOnlyOnEdit: true, width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: lifecycle, default: 'draft', width: 'third', help: 'A wheel/scratch card can only go live when prizes total 100%.' },
      { name: 'priority', label: 'Priority', type: 'number', default: 100, width: 'third' },
      { ...campaignRef, width: 'half' },
      { ...eligibilityRef, width: 'half' },
      ...schedule,
      { name: 'description', label: 'Short description', type: 'textarea' },
      { name: 'attempt_rules', label: 'Attempt rules (JSON)', type: 'json', schema: attemptRulesSchema, default: { free_per_day: 1, pp_cost: 200, max_per_day: 5, cooldown_seconds: 10, session_ttl_seconds: 180 }, help: 'free_per_day, pp_cost (Play Points per extra play), max_per_day / max_per_week / max_per_campaign, cooldown_seconds, session_ttl_seconds.' },
      { name: 'config', label: 'Game config (JSON)', type: 'json', default: {}, schemaBy: { field: 'type', map: gameConfigSchemas }, help: 'Wheel: {"spin_duration_ms":4500} · Scratch: {"reveal_threshold":0.6} · Quiz: {"questions_per_session":5,"time_limit_s":20,"pass_percent":60,"speed_bonus":true,"reward_tiers":[{"min_correct":5,"reward_id":"…"}]}' },
      { name: 'rules_text', label: 'Rules shown to customers', type: 'textarea' },
      { name: 'banner_path', label: 'Banner image URL', type: 'text' },
    ],
  },
  missions: {
    key: 'missions',
    title: 'Missions',
    singular: 'Mission',
    description: 'Challenges with objectives, targets, recurrence and rewards.',
    table: 'missions',
    select: 'id, title, objective_type, target, recurrence, status, completions_count, ends_at',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'objective_type', label: 'Objective' },
      { key: 'target', label: 'Target' },
      { key: 'recurrence', label: 'Repeats' },
      { key: 'completions_count', label: 'Completions' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'priority' },
    search: ['title', 'key'],
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half', help: 'Unique, e.g. visit-3x-month' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'how_to', label: 'How to complete', type: 'textarea' },
      { name: 'objective_type', label: 'Objective', type: 'select', required: true, options: opts('visit_count', 'spend_amount', 'distinct_stores', 'checkin_count', 'campaign_participation', 'voucher_redeemed', 'game_plays', 'quiz_score', 'activity_count'), width: 'third' },
      { name: 'target', label: 'Target', type: 'number', required: true, min: 1, width: 'third', help: 'Spend targets are in cents (5000 = $50).' },
      { name: 'recurrence', label: 'Repeats', type: 'select', options: opts('once', 'daily', 'weekly', 'monthly'), default: 'once', width: 'third' },
      { name: 'objective', label: 'Objective filters (JSON)', type: 'json', schema: missionObjectiveSchema, default: {}, help: '{"participating_only":true} · {"merchant_ids":["…"]} · {"campaign_id":"…"} · {"game_id":"…"}' },
      { name: 'rewards', label: 'Rewards on completion', type: 'rewards', default: [] },
      { name: 'enrolment_mode', label: 'Enrolment', type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: 'opt_in', label: 'Customer opts in' }], default: 'auto', width: 'third' },
      { name: 'max_participants', label: 'Max completions (optional)', type: 'number', width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: lifecycle, default: 'draft', width: 'third' },
      { ...campaignRef, width: 'half' },
      { ...eligibilityRef, width: 'half' },
      ...schedule,
      { name: 'category', label: 'Category', type: 'text', default: 'general', width: 'third' },
      { name: 'icon', label: 'Icon', type: 'text', width: 'third', placeholder: 'map-pin, bag, calendar…' },
      { name: 'priority', label: 'Priority', type: 'number', default: 100, width: 'third' },
    ],
  },
  checkin_programs: {
    key: 'checkin_programs',
    title: 'Check-in programmes',
    singular: 'Check-in programme',
    description: 'Daily check-in reward and streak reset rules. Streak rewards are configured under Streak ladder.',
    table: 'checkin_programs',
    select: 'id, name, status, reset_rule, grace_days, qr_multiplier',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'reset_rule', label: 'Reset rule' },
      { key: 'grace_days', label: 'Grace days' },
      { key: 'qr_multiplier', label: 'QR bonus ×' },
    ],
    orderBy: { column: 'created_at' },
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'status', label: 'Status', type: 'select', options: lifecycle, default: 'draft', width: 'half' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'base_rewards', label: 'Reward for every check-in', type: 'rewards', default: [] },
      { name: 'reset_rule', label: 'Streak reset', type: 'select', options: [{ value: 'strict', label: 'Strict (miss a day → reset)' }, { value: 'grace', label: 'Grace days allowed' }], default: 'strict', width: 'third' },
      { name: 'grace_days', label: 'Grace days', type: 'number', default: 0, min: 0, max: 7, width: 'third' },
      { name: 'reset_period', label: 'Also reset', type: 'select', options: [{ value: 'none', label: 'Never' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }], default: 'none', width: 'third' },
      { name: 'qr_multiplier', label: 'QR check-in Play Points multiplier', type: 'number', default: 1, min: 1, step: 0.5, width: 'half' },
      { ...campaignRef, width: 'half' },
      { ...eligibilityRef, width: 'half' },
      ...schedule,
    ],
  },
  checkin_streak_rules: {
    key: 'checkin_streak_rules',
    title: 'Streak ladder',
    singular: 'Streak reward',
    description: 'Escalating rewards when a member reaches a streak day (optionally repeating).',
    table: 'checkin_streak_rules',
    select: 'id, streak_day, repeat_every, label, checkin_programs(name)',
    columns: [
      { key: 'checkin_programs.name', label: 'Programme' },
      { key: 'streak_day', label: 'Day' },
      { key: 'repeat_every', label: 'Repeats every' },
      { key: 'label', label: 'Label' },
    ],
    orderBy: { column: 'streak_day' },
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    deletable: true,
    fields: [
      { name: 'program_id', label: 'Programme', type: 'ref', ref: { table: 'checkin_programs', label: 'name' }, required: true, width: 'half' },
      { name: 'label', label: 'Label shown to customers', type: 'text', width: 'half', placeholder: '+100 PP + Bonus Spin' },
      { name: 'streak_day', label: 'Streak day', type: 'number', required: true, min: 1, width: 'half' },
      { name: 'repeat_every', label: 'Repeat every N days (optional)', type: 'number', min: 1, width: 'half' },
      { name: 'rewards', label: 'Rewards', type: 'rewards', default: [] },
    ],
  },
  rewards: {
    key: 'rewards',
    title: 'Rewards',
    singular: 'Reward',
    description: 'Every prize and catalogue item: Play Points, bonus attempts, Suntec+ points, vouchers, gifts, privileges.',
    table: 'rewards',
    select: 'id, name, type, in_catalogue, pp_cost, status, reward_inventory(remaining_qty)',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'in_catalogue', label: 'In catalogue', format: 'bool' },
      { key: 'pp_cost', label: 'PP price' },
      { key: 'reward_inventory.remaining_qty', label: 'Stock left' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'sort' },
    search: ['name', 'key'],
    readPerm: 'rewards.read',
    writePerm: ['rewards.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half' },
      { name: 'type', label: 'Type', type: 'select', required: true, options: opts('play_points', 'bonus_attempt', 'capillary_points', 'digital_voucher', 'merchant_voucher', 'promo_gift', 'exclusive_reward', 'privilege', 'none'), width: 'third' },
      { name: 'category_id', label: 'Category', type: 'ref', ref: { table: 'reward_categories', label: 'name' }, width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
      { name: 'value', label: 'Value (JSON, depends on type)', type: 'json', default: {}, schemaBy: { field: 'type', map: rewardValueSchemas }, help: 'play_points {"amount":50} · bonus_attempt {"count":1,"game_id":"…"} · capillary_points {"points":500} · digital_voucher {"series_id":"DIN5"} · merchant_voucher {"source":"vms"|"code_pool","series_id":"…"} · promo_gift {"collect_at":"…"} · exclusive_reward {"fulfilment":"manual"|"code_pool"}' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'unit_cost_cents', label: 'Business cost per unit', type: 'money', default: 0, width: 'third', help: 'Used by the simulator and cost reports.' },
      { name: 'validity_days', label: 'Valid for (days)', type: 'number', width: 'third' },
      { name: 'valid_until', label: 'Or valid until (SGT)', type: 'datetime', width: 'third' },
      { name: 'in_catalogue', label: 'Redeemable in the Play Points catalogue', type: 'checkbox', default: false, width: 'half' },
      { name: 'pp_cost', label: 'Play Points price', type: 'number', width: 'half', min: 1 },
      { name: 'per_member_cap', label: 'Max per member', type: 'number', width: 'half', min: 1 },
      { name: 'per_member_period', label: 'Per', type: 'select', options: opts('once', 'daily', 'weekly', 'monthly'), default: 'once', width: 'half', help: '"once" = lifetime' },
      { ...campaignRef, width: 'half' },
      { ...eligibilityRef, width: 'half' },
      { name: 'image_path', label: 'Image URL', type: 'text' },
      { name: 'terms', label: 'Terms', type: 'textarea' },
      { name: 'sort', label: 'Sort order', type: 'number', default: 100, width: 'third' },
    ],
  },
  reward_categories: {
    key: 'reward_categories',
    title: 'Reward categories',
    singular: 'Category',
    description: 'Groups in the rewards catalogue.',
    table: 'reward_categories',
    select: 'id, name, key, sort, status',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'key', label: 'Key' },
      { key: 'sort', label: 'Sort' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'sort' },
    readPerm: 'rewards.read',
    writePerm: ['rewards.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'icon', label: 'Icon', type: 'text', width: 'third' },
      { name: 'sort', label: 'Sort', type: 'number', default: 100, width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
    ],
  },
  merchants: {
    key: 'merchants',
    title: 'Merchants',
    singular: 'Merchant',
    description: 'Suntec City tenants for spend/visit missions and merchant vouchers.',
    table: 'merchants',
    select: 'id, name, merchant_code, category, unit_no, is_participating, status',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'merchant_code', label: 'Code' },
      { key: 'category', label: 'Category' },
      { key: 'unit_no', label: 'Unit' },
      { key: 'is_participating', label: 'Participating', format: 'bool' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'name' },
    search: ['name', 'merchant_code'],
    readPerm: 'campaigns.read',
    writePerm: ['rewards.write', 'campaigns.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'merchant_code', label: 'Merchant code (as sent by POS)', type: 'text', required: true, width: 'half' },
      { name: 'category', label: 'Category', type: 'text', default: 'retail', width: 'third' },
      { name: 'unit_no', label: 'Unit', type: 'text', width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
      { name: 'is_participating', label: 'Participating merchant', type: 'checkbox', default: true },
      { name: 'logo_path', label: 'Logo URL', type: 'text' },
    ],
  },
  segments: {
    key: 'segments',
    title: 'Segments',
    singular: 'Segment',
    description: 'Target audiences defined by rules on tier, tags, join date and engagement.',
    table: 'segments',
    select: 'id, name, key, status',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'key', label: 'Key' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'name' },
    readPerm: 'campaigns.read',
    writePerm: ['campaigns.write'],
    deletable: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'rules', label: 'Rules (JSON)', type: 'json', schema: ruleSetSchema, default: { all: [] }, help: '{"all":[{"field":"tier","op":"in","value":["gold","platinum"]},{"field":"joined_days","op":"lte","value":90}]}. Fields: tier, tags, joined_days, checkins_total, checkin_streak, missions_completed, games_played, visits_count, lifetime_spend_cents… Ops: eq neq in nin gt gte lt lte contains exists.' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
    ],
  },
  eligibility_rules: {
    key: 'eligibility_rules',
    title: 'Eligibility rules',
    singular: 'Eligibility rule',
    description: 'Reusable participation conditions for campaigns, games, missions and rewards.',
    table: 'eligibility_rules',
    select: 'id, name, description',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
    ],
    orderBy: { column: 'name' },
    readPerm: 'campaigns.read',
    writePerm: ['campaigns.write'],
    deletable: true,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'rules', label: 'Rules (JSON)', type: 'json', schema: ruleSetSchema, default: { all: [] }, help: 'Same grammar as segments, plus "segments_any":["<segment id>"].' },
    ],
  },
  badges: {
    key: 'badges',
    title: 'Badges',
    singular: 'Badge',
    description: 'Achievements awarded automatically when a metric reaches a value.',
    table: 'badges',
    select: 'id, name, tier, hidden, status, criteria',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'tier', label: 'Tier' },
      { key: 'hidden', label: 'Secret', format: 'bool' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'sort' },
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'criteria', label: 'Award when (JSON)', type: 'json', schema: badgeCriteriaSchema, default: { metric: 'checkins_total', op: 'gte', value: 1 }, help: 'metric: checkins_total, checkin_streak, missions_completed, games_played, quiz_wins, distinct_stores, visits_count, lifetime_spend_cents, pp_lifetime_earned, monthly_rank (lte N on a monthly leaderboard).' },
      { name: 'rewards', label: 'Rewards when unlocked', type: 'rewards', default: [] },
      { name: 'tier', label: 'Tier', type: 'select', options: opts('bronze', 'silver', 'gold', 'platinum'), default: 'bronze', width: 'third' },
      { name: 'icon', label: 'Icon', type: 'text', width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
      { name: 'hidden', label: 'Secret badge (hidden until earned)', type: 'checkbox', default: false },
      { name: 'image_path', label: 'Badge artwork URL', type: 'text' },
      { name: 'sort', label: 'Sort', type: 'number', default: 100, width: 'third' },
    ],
  },
  leaderboards: {
    key: 'leaderboards',
    title: 'Leaderboards',
    singular: 'Leaderboard',
    description: 'Rankings by metric and period with privacy display and period prizes.',
    table: 'leaderboards',
    select: 'id, name, metric, periods, display_mode, status',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'metric', label: 'Metric' },
      { key: 'periods', label: 'Periods' },
      { key: 'display_mode', label: 'Names' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'created_at' },
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    links: (row) => [{ href: `/admin/leaderboards/${row.id}`, label: 'View standings' }],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Key', type: 'text', required: true, width: 'half' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'metric', label: 'Ranked by', type: 'select', options: opts('play_points_earned', 'missions_completed', 'activities', 'quiz_score', 'checkins'), required: true, width: 'third' },
      { name: 'display_mode', label: 'Show names as', type: 'select', options: [{ value: 'masked', label: 'Masked (T*** K.)' }, { value: 'nickname', label: 'Nickname if set' }, { value: 'hidden', label: 'Hidden' }], default: 'masked', width: 'third' },
      { name: 'top_n', label: 'Show top N', type: 'number', default: 100, min: 3, max: 1000, width: 'third' },
      { name: 'periods', label: 'Periods', type: 'multiselect', options: opts('daily', 'weekly', 'monthly', 'overall'), default: ['daily', 'weekly', 'monthly', 'overall'] },
      { name: 'prize_rules', label: 'Period prizes (JSON)', type: 'json', schema: prizeRulesSchema, default: [], help: '[{"period":"monthly","rank_from":1,"rank_to":3,"rewards":[{"reward_id":"…","qty":1}]}]' },
      { name: 'game_id', label: 'Only this game (quiz score boards)', type: 'ref', ref: { table: 'games', label: 'name' }, width: 'half' },
      { ...campaignRef, width: 'half' },
      { name: 'status', label: 'Status', type: 'select', options: lifecycle, default: 'draft', width: 'third' },
      ...schedule,
    ],
  },
  qr_codes: {
    key: 'qr_codes',
    title: 'QR codes',
    singular: 'QR code',
    description: 'Printable QR codes for location-verified check-ins, mall visits, missions and events.',
    table: 'qr_codes',
    select: 'id, label, purpose, location, scans_count, status',
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'location', label: 'Location' },
      { key: 'scans_count', label: 'Scans' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'created_at', ascending: false },
    search: ['label', 'location'],
    readPerm: 'campaigns.read',
    writePerm: ['missions.write'],
    fields: [
      { name: 'label', label: 'Label', type: 'text', required: true, width: 'half' },
      { name: 'location', label: 'Location', type: 'text', width: 'half' },
      { name: 'purpose', label: 'Purpose', type: 'select', required: true, options: [{ value: 'checkin', label: 'Location check-in' }, { value: 'visit', label: 'Mall visit' }, { value: 'mission', label: 'Mission step' }, { value: 'event', label: 'Event check-in' }], width: 'third' },
      { name: 'per_member_daily_limit', label: 'Scans per member per day', type: 'number', default: 1, min: 1, width: 'third' },
      { name: 'max_scans', label: 'Total scan limit (optional)', type: 'number', width: 'third' },
      { name: 'program_id', label: 'Check-in programme', type: 'ref', ref: { table: 'checkin_programs', label: 'name' }, width: 'third' },
      { name: 'mission_id', label: 'Mission', type: 'ref', ref: { table: 'missions', label: 'title' }, width: 'third' },
      { ...campaignRef, width: 'third' },
      { name: 'valid_from', label: 'Valid from (SGT)', type: 'datetime', width: 'half' },
      { name: 'valid_to', label: 'Valid to (SGT)', type: 'datetime', width: 'half' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
    ],
  },
  notification_templates: {
    key: 'notification_templates',
    title: 'Notification templates',
    singular: 'Template',
    description: 'Messages per event with {{variables}}, channels, deep links and quiet hours.',
    table: 'notification_templates',
    select: 'id, key, name, channels, status',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'key', label: 'Event' },
      { key: 'channels', label: 'Channels' },
      { key: 'status', label: 'Status', format: 'status' },
    ],
    orderBy: { column: 'key' },
    readPerm: 'campaigns.read',
    writePerm: ['notifications.write'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, width: 'half' },
      { name: 'key', label: 'Event key', type: 'select', required: true, readOnlyOnEdit: true, width: 'half', options: opts('campaign_launched', 'mission_available', 'checkin_reminder', 'mission_completed', 'game_result', 'reward_allocated', 'reward_expiring', 'badge_unlocked', 'leaderboard_update') },
      { name: 'title', label: 'Title', type: 'text', required: true, help: 'Variables: {{first_name}}, {{reward_name}}, {{mission_title}}, {{badge_name}}, {{rank}}, {{board_name}}, {{game_name}}, {{expires_on}}, {{transaction_ref}}' },
      { name: 'body', label: 'Message', type: 'textarea', required: true },
      { name: 'deep_link', label: 'Deep link', type: 'text', placeholder: 'suntecplus://play/rewards' },
      { name: 'channels', label: 'Channels', type: 'multiselect', options: [{ value: 'inbox', label: 'In-app inbox' }, { value: 'push', label: 'Push' }, { value: 'email', label: 'Email' }], default: ['inbox'] },
      { name: 'quiet_hours_start', label: 'Quiet hours from', type: 'time', width: 'third' },
      { name: 'quiet_hours_end', label: 'Quiet hours to', type: 'time', width: 'third' },
      { name: 'status', label: 'Status', type: 'select', options: recordStatus, default: 'active', width: 'third' },
    ],
  },
};

export function getResource(key: string): ResourceDef | undefined {
  return Object.prototype.hasOwnProperty.call(RESOURCES, key) ? RESOURCES[key] : undefined;
}
