-- =============================================================================
-- 0005 · Games: type registry, configuration, outcomes, quiz bank, sessions,
--        earned attempts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- game_types — registry of game engines. New game types are added here plus a
-- resolver in the engine; the rest of the schema is generic.
-- -----------------------------------------------------------------------------
create table if not exists public.game_types (
  key            text primary key,
  name           text not null,
  description    text not null default '',
  weighted       boolean not null,     -- outcome drawn from weighted game_outcomes (spin, scratch)
  has_questions  boolean not null,     -- uses quiz_questions (quiz)
  enabled        boolean not null default true
);
comment on table public.game_types is 'Registry of game engines (spin_wheel, scratch_card, quiz). Extensible: add a row + an engine resolver.';

insert into public.game_types (key, name, description, weighted, has_questions) values
  ('spin_wheel',   'Spin & Win',    'Configurable prize wheel; outcome drawn server-side by weight', true,  false),
  ('scratch_card', 'Scratch & Win', 'Digital scratch card; outcome drawn server-side at card issue', true,  false),
  ('quiz',         'Quiz & Trivia', 'Timed multiple-choice quiz; scored server-side',                 false, true)
on conflict (key) do update set name = excluded.name, description = excluded.description,
  weighted = excluded.weighted, has_questions = excluded.has_questions;

-- -----------------------------------------------------------------------------
-- games — a configured game inside a campaign.
-- attempt_rules: {"free_per_day":1,"pp_cost":200,"max_per_day":5,"max_per_week":null,
--                 "max_per_campaign":null,"cooldown_seconds":30,"session_ttl_seconds":120}
-- config (per type):
--   spin_wheel   {"spin_duration_ms":4500}
--   scratch_card {"reveal_threshold":0.6,"cover_image":"…"}
--   quiz         {"questions_per_session":5,"time_limit_s":20,"pass_percent":60,"speed_bonus":true,
--                 "shuffle":true,"reward_tiers":[{"min_correct":5,"reward_id":"…"},{"min_correct":3,"reward_id":"…"}]}
-- -----------------------------------------------------------------------------
create table if not exists public.games (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid references public.campaigns (id) on delete cascade,
  type                text not null references public.game_types (key),
  slug                text not null,
  name                text not null,
  description         text not null default '',
  banner_path         text,
  status              public.lifecycle_status not null default 'draft',
  priority            int  not null default 100,
  starts_at           timestamptz,
  ends_at             timestamptz,
  eligibility_rule_id uuid references public.eligibility_rules (id) on delete set null,
  attempt_rules       jsonb not null default '{"free_per_day":1,"max_per_day":3,"cooldown_seconds":10,"session_ttl_seconds":180}',
  config              jsonb not null default '{}',
  rules_text          text not null default '',          -- customer-facing rules / T&Cs
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint games_slug_key unique (slug),
  constraint games_dates_chk check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint games_attempt_rules_is_object check (jsonb_typeof(attempt_rules) = 'object'),
  constraint games_config_is_object check (jsonb_typeof(config) = 'object')
);
comment on table public.games is 'A configured game (spin, scratch, quiz) with schedule, eligibility, attempt limits/cost and type-specific config.';
create index if not exists games_campaign_idx on public.games (campaign_id, status);
create index if not exists games_live_idx on public.games (status, starts_at, ends_at);

-- -----------------------------------------------------------------------------
-- game_outcomes — weighted outcomes for spin wheels (segments) and scratch cards.
-- weight_bp: basis points; an ACTIVE weighted game must total exactly 10000 (100%).
-- display: {"color":"#F97316","text_color":"#1F2937","icon":"gift","image":"…"}
-- -----------------------------------------------------------------------------
create table if not exists public.game_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games (id) on delete cascade,
  position            int  not null check (position >= 0),
  label               text not null,
  display             jsonb not null default '{}',
  reward_id           uuid references public.rewards (id) on delete restrict,   -- null = no prize ("Try again")
  reward_qty          int  not null default 1 check (reward_qty > 0),
  weight_bp           int  not null check (weight_bp between 0 and 10000),
  fallback_strategy   public.fallback_strategy not null default 'renormalize',
  fallback_outcome_id uuid references public.game_outcomes (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint game_outcomes_position_key unique (game_id, position),
  constraint game_outcomes_fallback_chk check (fallback_strategy <> 'outcome' or fallback_outcome_id is not null),
  constraint game_outcomes_not_self_fallback check (fallback_outcome_id is null or fallback_outcome_id <> id)
);
comment on table public.game_outcomes is 'Weighted outcomes (wheel segments / scratch prizes). Weights in basis points must total 100% for an active game. Weights are NEVER sent to clients.';
create index if not exists game_outcomes_reward_idx on public.game_outcomes (reward_id);

-- -----------------------------------------------------------------------------
-- Quiz question bank (per game). Correct answers never leave the server.
-- -----------------------------------------------------------------------------
create table if not exists public.quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games (id) on delete cascade,
  category      text not null default 'general',          -- suntec | merchants | campaign | general
  text          text not null,
  image_path    text,
  explanation   text not null default '',
  time_limit_s  int  check (time_limit_s is null or time_limit_s between 5 and 300),  -- overrides game default
  points        int  not null default 100 check (points >= 0),
  status        public.record_status not null default 'active',
  sort          int  not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.quiz_questions is 'Quiz & Trivia question bank per game. Sessions sample questions from here.';
create index if not exists quiz_questions_game_idx on public.quiz_questions (game_id, status);

create table if not exists public.quiz_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.quiz_questions (id) on delete cascade,
  position     int  not null check (position >= 0),
  text         text not null,
  is_correct   boolean not null default false,
  constraint quiz_options_position_key unique (question_id, position)
);
comment on table public.quiz_options is 'Multiple-choice options. is_correct is readable by staff only; customers receive options without it.';
create index if not exists quiz_options_question_idx on public.quiz_options (question_id);

-- -----------------------------------------------------------------------------
-- game_sessions — GameSession: one participation with a unique transaction ID.
-- UNIQUE(member_id, idempotency_key) is the anti-duplicate-participation guarantee.
-- -----------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id                    uuid primary key default gen_random_uuid(),
  ref                   text not null default public.gen_public_ref('GS'),  -- participation transaction ID
  member_id             uuid not null references public.members (id) on delete cascade,
  game_id               uuid not null references public.games (id) on delete restrict,
  campaign_id           uuid references public.campaigns (id) on delete set null,
  game_type             text not null references public.game_types (key),
  status                public.session_status not null default 'in_progress',
  payment_source        public.payment_source not null,
  pp_cost               int  not null default 0 check (pp_cost >= 0),
  outcome_id            uuid references public.game_outcomes (id) on delete set null,
  outcome               jsonb not null default '{}',        -- snapshot of the result shown to the customer
  draw                  jsonb,                              -- audit of the RNG draw (drawn index, fallback applied)
  question_ids          uuid[],                             -- quiz: questions served, in order
  score                 int,
  correct_count         int,
  question_count        int,
  reward_transaction_id uuid,
  idempotency_key       text not null,
  device_hash           text,
  ip_hash               text,
  started_at            timestamptz not null default now(),
  expires_at            timestamptz,
  completed_at          timestamptz,
  constraint game_sessions_ref_key unique (ref),
  constraint game_sessions_idem_key unique (member_id, idempotency_key)
);
comment on table public.game_sessions is 'GameSession: each participation (unique GS- transaction ID), payment source, server-decided outcome/score, linked reward transaction. Immutable once completed.';
create index if not exists game_sessions_member_game_idx on public.game_sessions (member_id, game_id, started_at desc);
create index if not exists game_sessions_member_idx on public.game_sessions (member_id, started_at desc);
create index if not exists game_sessions_game_idx on public.game_sessions (game_id, started_at);
create index if not exists game_sessions_campaign_idx on public.game_sessions (campaign_id, started_at);
create index if not exists game_sessions_open_idx on public.game_sessions (expires_at) where status = 'in_progress';

-- Quiz answers per session (validated against quiz_options server-side; timing from server clock).
create table if not exists public.game_session_answers (
  session_id   uuid not null references public.game_sessions (id) on delete cascade,
  question_id  uuid not null references public.quiz_questions (id) on delete restrict,
  option_id    uuid references public.quiz_options (id) on delete restrict,
  is_correct   boolean not null default false,
  points       int not null default 0,
  answered_at  timestamptz not null default now(),
  primary key (session_id, question_id)
);
comment on table public.game_session_answers is 'Quiz answers per session with server-side correctness and points.';

-- -----------------------------------------------------------------------------
-- Earned game attempts (from missions, check-in streaks, events, admin grants,
-- bonus-attempt prizes). Free daily attempts are computed from attempt_rules and
-- are not ledgered.
-- -----------------------------------------------------------------------------
create table if not exists public.attempt_balances (
  member_id   uuid not null references public.members (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  balance     int  not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now(),
  primary key (member_id, game_id)
);
comment on table public.attempt_balances is 'Earned (non-free) attempts available per member per game. Locked FOR UPDATE when consumed.';

create table if not exists public.attempt_ledger (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members (id) on delete cascade,
  game_id          uuid not null references public.games (id) on delete cascade,
  delta            int  not null check (delta <> 0),
  balance_after    int  not null check (balance_after >= 0),
  reason           public.attempt_reason not null,
  ref_type         text,
  ref_id           text,
  expires_at       timestamptz,
  idempotency_key  text not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint attempt_ledger_idem_key unique (member_id, idempotency_key)
);
comment on table public.attempt_ledger is 'Append-only ledger of earned/consumed game attempts.';
create index if not exists attempt_ledger_member_idx on public.attempt_ledger (member_id, created_at desc);

drop trigger if exists attempt_ledger_append_only on public.attempt_ledger;
create trigger attempt_ledger_append_only before update or delete on public.attempt_ledger
  for each row execute function public.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Probability integrity: an ACTIVE weighted game must have outcomes totalling
-- exactly 10000 bp. Checked when a game is activated and (deferred, at commit)
-- whenever outcomes of an active game change.
-- -----------------------------------------------------------------------------
create or replace function public.assert_game_weights(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  g record;
  total int;
  n int;
begin
  select ga.status, gt.weighted into g
  from public.games ga join public.game_types gt on gt.key = ga.type
  where ga.id = p_game_id;

  if not found or not g.weighted or g.status not in ('active', 'scheduled') then
    return;
  end if;

  select coalesce(sum(weight_bp), 0), count(*) into total, n
  from public.game_outcomes where game_id = p_game_id;

  if n = 0 then
    raise exception 'Game % cannot be active/scheduled without outcomes', p_game_id using errcode = 'P0001';
  end if;
  if total <> 10000 then
    raise exception 'Outcome weights for game % total % bp (% percent); they must total 10000 bp (100 percent)',
      p_game_id, total, round(total / 100.0, 2) using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.trg_games_check_weights()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_game_weights(new.id);
  return new;
end;
$$;

create or replace function public.trg_outcomes_check_weights()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.assert_game_weights(old.game_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.assert_game_weights(new.game_id);
  end if;
  return null;
end;
$$;

drop trigger if exists games_check_weights on public.games;
create trigger games_check_weights after insert or update of status, type on public.games
  for each row execute function public.trg_games_check_weights();

drop trigger if exists game_outcomes_check_weights on public.game_outcomes;
create constraint trigger game_outcomes_check_weights
  after insert or update or delete on public.game_outcomes
  deferrable initially deferred
  for each row execute function public.trg_outcomes_check_weights();
