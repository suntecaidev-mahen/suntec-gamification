-- =============================================================================
-- 0007 · Play Points ledger, reward transactions, outbox
-- =============================================================================

-- -----------------------------------------------------------------------------
-- points_ledger — append-only ledger of PLAY POINTS (gamification currency).
-- Completely separate from Suntec+/Capillary loyalty points, which are never
-- stored on this platform. member_profiles.pp_balance is the locked running total.
-- -----------------------------------------------------------------------------
create table if not exists public.points_ledger (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members (id) on delete cascade,
  delta            int  not null check (delta <> 0),
  balance_after    bigint not null check (balance_after >= 0),
  reason           public.points_reason not null,
  ref_type         text,                  -- game_session | checkin | mission_progress | reward_transaction | admin …
  ref_id           text,
  expires_at       timestamptz,           -- for earned points when PP expiry is enabled
  idempotency_key  text not null,
  note             text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint points_ledger_idem_key unique (member_id, idempotency_key)
);
comment on table public.points_ledger is 'Append-only Play Points ledger (earn/spend/expire/reverse). Separate from Capillary loyalty points.';
create index if not exists points_ledger_member_idx on public.points_ledger (member_id, created_at desc);
create index if not exists points_ledger_reason_idx on public.points_ledger (reason, created_at);

drop trigger if exists points_ledger_append_only on public.points_ledger;
create trigger points_ledger_append_only before update or delete on public.points_ledger
  for each row execute function public.forbid_mutation();

-- -----------------------------------------------------------------------------
-- reward_transactions — RewardTransaction: every allocation of a reward to a member,
-- from any source, with delivery status towards Capillary / VMS and redemption tracking.
-- UNIQUE(source, source_id, reward_id) makes allocation idempotent per triggering record.
-- -----------------------------------------------------------------------------
create table if not exists public.reward_transactions (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null default public.gen_public_ref('RT'),
  member_id        uuid not null references public.members (id) on delete cascade,
  reward_id        uuid not null references public.rewards (id) on delete restrict,
  reward_type      public.reward_type not null,
  reward_snapshot  jsonb not null default '{}',     -- name/value/cost at allocation time
  quantity         int  not null default 1 check (quantity > 0),
  source           public.reward_source not null,
  source_id        text not null,                   -- game_session id, mission_progress id, checkin id, admin request id …
  campaign_id      uuid references public.campaigns (id) on delete set null,
  pp_cost          int  not null default 0 check (pp_cost >= 0),   -- PP spent (catalogue redemption)
  unit_cost_cents  int  not null default 0,
  status           public.reward_txn_status not null default 'pending',
  external_ref     text,                            -- Capillary txn id / VMS voucher id
  voucher_code     text,                            -- visible to the owning member only (RLS)
  claim_token      text,                            -- QR claim code for gifts / privileges
  attempts         int  not null default 0,
  last_error       text,
  issued_at        timestamptz,
  redeemed_at      timestamptz,
  expires_at       timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  idempotency_key  text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reward_transactions_ref_key unique (ref),
  constraint reward_transactions_source_key unique (source, source_id, reward_id),
  constraint reward_transactions_idem_key unique (member_id, idempotency_key)
);
comment on table public.reward_transactions is 'RewardTransaction: allocation lifecycle pending→issued→redeemed/expired (or failed→retry/cancel), external refs from Capillary/VMS.';
create index if not exists reward_transactions_member_idx on public.reward_transactions (member_id, created_at desc);
create index if not exists reward_transactions_status_idx on public.reward_transactions (status, updated_at);
create index if not exists reward_transactions_reward_idx on public.reward_transactions (reward_id, created_at);
create index if not exists reward_transactions_campaign_idx on public.reward_transactions (campaign_id, created_at);
create index if not exists reward_transactions_expiry_idx on public.reward_transactions (expires_at) where status = 'issued';

-- game_sessions → reward_transactions (added here because of creation order)
do $$ begin
  alter table public.game_sessions
    add constraint game_sessions_reward_txn_fk foreign key (reward_transaction_id)
    references public.reward_transactions (id) on delete set null;
exception when duplicate_object then null; end $$;

-- voucher_code_pool → reward_transactions
do $$ begin
  alter table public.voucher_code_pool
    add constraint voucher_code_pool_txn_fk foreign key (assigned_txn_id)
    references public.reward_transactions (id) on delete set null;
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- outbox — transactional outbox for all external side effects (Capillary points,
-- VMS vouchers, push notifications). Written in the same DB transaction as the
-- business change; delivered asynchronously with retries & exponential backoff.
-- kind: capillary.award_points | capillary.deduct_points | vms.issue_voucher | push.send …
-- -----------------------------------------------------------------------------
create table if not exists public.outbox (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  aggregate_type   text not null,                 -- reward_transaction | notification …
  aggregate_id     uuid not null,
  payload          jsonb not null default '{}',
  status           public.outbox_status not null default 'pending',
  attempts         int  not null default 0,
  max_attempts     int  not null default 10,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint outbox_aggregate_kind_key unique (aggregate_type, aggregate_id, kind)
);
comment on table public.outbox is 'Transactional outbox for external calls (Capillary, VMS, push). Idempotency key towards upstream = aggregate_id.';
create index if not exists outbox_due_idx on public.outbox (next_attempt_at) where status in ('pending', 'retry');
create index if not exists outbox_status_idx on public.outbox (status, updated_at);
