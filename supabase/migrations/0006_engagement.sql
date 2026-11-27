-- =============================================================================
-- 0006 · Engagement: daily check-in, missions, badges, leaderboards, QR codes
-- Reward specs used below are arrays: [{"reward_id":"<uuid>","qty":1}, …]
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Daily check-in programmes
-- -----------------------------------------------------------------------------
create table if not exists public.checkin_programs (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid references public.campaigns (id) on delete cascade,   -- null = always-on programme
  name                text not null,
  description         text not null default '',
  status              public.lifecycle_status not null default 'draft',
  starts_at           timestamptz,
  ends_at             timestamptz,
  eligibility_rule_id uuid references public.eligibility_rules (id) on delete set null,
  base_rewards        jsonb not null default '[]',      -- given on every check-in
  reset_rule          public.streak_reset_rule not null default 'strict',
  grace_days          int not null default 0 check (grace_days between 0 and 7),
  reset_period        public.reset_period not null default 'none',   -- streak also resets each week/month
  qr_multiplier       numeric(4,2) not null default 1 check (qr_multiplier >= 1),  -- location-verified bonus
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint checkin_programs_dates_chk check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint checkin_programs_rewards_is_array check (jsonb_typeof(base_rewards) = 'array')
);
comment on table public.checkin_programs is 'Daily check-in programme: base reward, streak reset rules (strict/grace, weekly/monthly reset), QR bonus multiplier.';

create table if not exists public.checkin_streak_rules (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references public.checkin_programs (id) on delete cascade,
  streak_day    int  not null check (streak_day > 0),            -- reward when streak reaches this day
  repeat_every  int  check (repeat_every is null or repeat_every > 0),  -- e.g. every 7 days after
  rewards       jsonb not null default '[]',
  label         text not null default '',
  constraint checkin_streak_rules_day_key unique (program_id, streak_day),
  constraint checkin_streak_rules_rewards_is_array check (jsonb_typeof(rewards) = 'array')
);
comment on table public.checkin_streak_rules is 'Escalating streak ladder (e.g. day 3 +20 PP, day 7 +100 PP + bonus spin).';

-- CheckInHistory: one row per member per programme per business day (anti-abuse via UNIQUE).
create table if not exists public.checkins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  program_id    uuid not null references public.checkin_programs (id) on delete cascade,
  day           date not null,                                  -- business day (SGT)
  streak_after  int  not null check (streak_after > 0),
  source        public.checkin_source not null default 'app',
  qr_code_id    uuid,
  device_hash   text,
  created_at    timestamptz not null default now(),
  constraint checkins_once_per_day unique (member_id, program_id, day)
);
comment on table public.checkins is 'Check-in history. UNIQUE(member, programme, day) prevents repeated check-in abuse.';
create index if not exists checkins_member_idx on public.checkins (member_id, day desc);
create index if not exists checkins_day_idx on public.checkins (day);

create table if not exists public.member_streaks (
  member_id    uuid not null references public.members (id) on delete cascade,
  program_id   uuid not null references public.checkin_programs (id) on delete cascade,
  current      int  not null default 0 check (current >= 0),
  best         int  not null default 0 check (best >= 0),
  last_day     date,
  updated_at   timestamptz not null default now(),
  primary key (member_id, program_id)
);
comment on table public.member_streaks is 'Current and best streak per member per check-in programme.';

-- -----------------------------------------------------------------------------
-- Missions & challenges
-- objective: {"type":"spend_amount","target":5000,"filters":{"merchant_ids":["…"],"participating_only":true}}
--   (spend targets in cents; visit/store/check-in/game targets are counts)
-- -----------------------------------------------------------------------------
create table if not exists public.missions (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid references public.campaigns (id) on delete cascade,
  key                 text not null,
  title               text not null,
  description         text not null default '',
  how_to              text not null default '',
  category            text not null default 'general',   -- shopping | visit | engagement | games | dining …
  icon                text,
  banner_path         text,
  objective_type      public.mission_objective not null,
  objective           jsonb not null default '{}',
  target              numeric(14,2) not null check (target > 0),
  recurrence          public.recurrence not null default 'once',
  enrolment_mode      public.enrolment_mode not null default 'auto',
  max_participants    int check (max_participants is null or max_participants > 0),
  completions_count   int not null default 0,
  rewards             jsonb not null default '[]',
  eligibility_rule_id uuid references public.eligibility_rules (id) on delete set null,
  status              public.lifecycle_status not null default 'draft',
  priority            int not null default 100,
  starts_at           timestamptz,
  ends_at             timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint missions_key_key unique (key),
  constraint missions_dates_chk check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint missions_rewards_is_array check (jsonb_typeof(rewards) = 'array')
);
comment on table public.missions is 'Missions/challenges: objective type + target, recurrence (once/daily/weekly/monthly), enrolment mode, limits, eligibility and rewards.';
create index if not exists missions_live_idx on public.missions (status, objective_type, starts_at, ends_at);
create index if not exists missions_campaign_idx on public.missions (campaign_id);

-- MissionParticipation (opt-in missions; auto missions create a row on first progress).
create table if not exists public.mission_enrolments (
  mission_id   uuid not null references public.missions (id) on delete cascade,
  member_id    uuid not null references public.members (id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  primary key (mission_id, member_id)
);
comment on table public.mission_enrolments is 'Members participating in a mission (explicit opt-in or implicit on first progress).';
create index if not exists mission_enrolments_member_idx on public.mission_enrolments (member_id);

-- MissionProgress per recurrence period. UNIQUE prevents duplicate completion in a period.
create table if not exists public.mission_progress (
  id                uuid primary key default gen_random_uuid(),
  mission_id        uuid not null references public.missions (id) on delete cascade,
  member_id         uuid not null references public.members (id) on delete cascade,
  period_key        text not null,                       -- 'all' | '2026-11-27' | '2026-W48' | '2026-11'
  progress          numeric(14,2) not null default 0 check (progress >= 0),
  target            numeric(14,2) not null,
  distinct_values   text[] not null default '{}',        -- distinct_stores: merchant ids counted
  completed_at      timestamptz,
  rewarded_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint mission_progress_period_key unique (mission_id, member_id, period_key)
);
comment on table public.mission_progress is 'Progress per member per mission per period. One completion per period (UNIQUE).';
create index if not exists mission_progress_member_idx on public.mission_progress (member_id, updated_at desc);
create index if not exists mission_progress_completed_idx on public.mission_progress (mission_id, completed_at) where completed_at is not null;

-- Each source event counts at most once per mission (prevents double counting on retries).
create table if not exists public.mission_progress_events (
  mission_id       uuid not null references public.missions (id) on delete cascade,
  source_event_id  text not null,
  member_id        uuid not null references public.members (id) on delete cascade,
  period_key       text not null,
  amount           numeric(14,2) not null default 1,
  created_at       timestamptz not null default now(),
  primary key (mission_id, source_event_id)
);
comment on table public.mission_progress_events is 'Dedup of events applied to mission progress (idempotent progress updates).';

-- -----------------------------------------------------------------------------
-- Badges & achievements
-- criteria: {"metric":"checkin_streak","op":"gte","value":30}
--   metrics: checkins_total, checkin_streak, missions_completed, games_played, quiz_wins,
--            distinct_stores, visits_count, lifetime_spend_cents, monthly_rank, pp_lifetime_earned
-- -----------------------------------------------------------------------------
create table if not exists public.badges (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,
  name         text not null,
  description  text not null default '',
  image_path   text,
  icon         text,
  tier         public.badge_tier not null default 'bronze',
  hidden       boolean not null default false,          -- secret achievement until earned
  criteria     jsonb not null default '{}',
  rewards      jsonb not null default '[]',
  sort         int not null default 100,
  status       public.record_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint badges_key_key unique (key),
  constraint badges_rewards_is_array check (jsonb_typeof(rewards) = 'array')
);
comment on table public.badges is 'Badge definitions with declarative award criteria and optional rewards.';

create table if not exists public.member_badges (
  member_id     uuid not null references public.members (id) on delete cascade,
  badge_id      uuid not null references public.badges (id) on delete cascade,
  awarded_at    timestamptz not null default now(),
  source_event  text,
  primary key (member_id, badge_id)
);
comment on table public.member_badges is 'CustomerBadge: badges earned (each at most once).';
create index if not exists member_badges_awarded_idx on public.member_badges (member_id, awarded_at desc);

-- -----------------------------------------------------------------------------
-- Leaderboards
-- -----------------------------------------------------------------------------
create table if not exists public.leaderboards (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns (id) on delete cascade,   -- null = global
  key           text not null,
  name          text not null,
  description   text not null default '',
  metric        public.leaderboard_metric not null,
  periods       public.leaderboard_period[] not null default '{daily,weekly,monthly,overall}',
  game_id       uuid references public.games (id) on delete cascade,      -- optional: quiz_score for one quiz
  segment_id    uuid references public.segments (id) on delete set null,
  display_mode  public.display_mode not null default 'masked',
  top_n         int not null default 100 check (top_n between 3 and 1000),
  prize_rules   jsonb not null default '[]',   -- [{"period":"monthly","rank_from":1,"rank_to":3,"rewards":[…]}]
  status        public.lifecycle_status not null default 'draft',
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leaderboards_key_key unique (key)
);
comment on table public.leaderboards is 'Leaderboard definitions: metric, periods (daily/weekly/monthly/overall), scope, privacy display mode, period prizes.';

-- Scores per period, upserted in the same transaction as the scoring event.
create table if not exists public.leaderboard_scores (
  board_id     uuid not null references public.leaderboards (id) on delete cascade,
  period_key   text not null,
  member_id    uuid not null references public.members (id) on delete cascade,
  score        bigint not null default 0,
  reached_at   timestamptz not null default now(),    -- tie-break: earlier wins
  primary key (board_id, period_key, member_id)
);
comment on table public.leaderboard_scores is 'Incremental scores per board per period key. Ranked by score desc, reached_at asc (index-backed).';
create index if not exists leaderboard_scores_rank_idx on public.leaderboard_scores (board_id, period_key, score desc, reached_at asc);
create index if not exists leaderboard_scores_member_idx on public.leaderboard_scores (member_id);

create table if not exists public.leaderboard_snapshots (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.leaderboards (id) on delete cascade,
  period_key  text not null,
  frozen_at   timestamptz not null default now(),
  entries     jsonb not null default '[]',
  prizes_awarded_at timestamptz,
  constraint leaderboard_snapshots_period_key unique (board_id, period_key)
);
comment on table public.leaderboard_snapshots is 'Frozen final rankings per closed period (history + prize awarding).';

create table if not exists public.leaderboard_exclusions (
  board_id    uuid not null references public.leaderboards (id) on delete cascade,
  member_id   uuid not null references public.members (id) on delete cascade,
  reason      text not null default '',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (board_id, member_id)
);
comment on table public.leaderboard_exclusions is 'Members hidden from a leaderboard by admins (fraud, complaints).';

-- -----------------------------------------------------------------------------
-- QR codes (location-verified check-in, mall visits, event check-ins)
-- -----------------------------------------------------------------------------
create table if not exists public.qr_codes (
  id                     uuid primary key default gen_random_uuid(),
  token                  text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  purpose                public.qr_purpose not null,
  label                  text not null,
  location               text not null default '',
  campaign_id            uuid references public.campaigns (id) on delete cascade,
  mission_id             uuid references public.missions (id) on delete cascade,
  program_id             uuid references public.checkin_programs (id) on delete cascade,
  valid_from             timestamptz,
  valid_to               timestamptz,
  max_scans              int check (max_scans is null or max_scans > 0),
  per_member_daily_limit int not null default 1 check (per_member_daily_limit > 0),
  scans_count            int not null default 0,
  status                 public.record_status not null default 'active',
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint qr_codes_token_key unique (token)
);
comment on table public.qr_codes is 'Printed/displayed QR codes for location-verified check-ins, visits and events. Token is unguessable (144-bit).';

create table if not exists public.qr_scans (
  id           uuid primary key default gen_random_uuid(),
  qr_code_id   uuid not null references public.qr_codes (id) on delete cascade,
  member_id    uuid not null references public.members (id) on delete cascade,
  day          date not null,
  device_hash  text,
  scanned_at   timestamptz not null default now()
);
comment on table public.qr_scans is 'QR scan log (per-member daily limits, fraud burst detection).';
create index if not exists qr_scans_member_day_idx on public.qr_scans (member_id, qr_code_id, day);
create index if not exists qr_scans_code_idx on public.qr_scans (qr_code_id, scanned_at);
