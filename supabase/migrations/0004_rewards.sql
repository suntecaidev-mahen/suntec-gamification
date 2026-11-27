-- =============================================================================
-- 0004 · Reward catalogue & inventory
-- =============================================================================

create table if not exists public.reward_categories (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  name        text not null,
  description text not null default '',
  icon        text,
  sort        int  not null default 100,
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reward_categories_key_key unique (key)
);
comment on table public.reward_categories is 'Reward catalogue categories (Dining, Retail, Suntec+ Points, Gifts, Privileges…).';

-- -----------------------------------------------------------------------------
-- rewards — every prize/reward the platform can allocate (game outcomes, mission,
-- check-in, badge and leaderboard rewards, catalogue redemptions).
-- `value` depends on `type`:
--   play_points      {"amount": 50}
--   bonus_attempt    {"count": 1, "game_id": null}          (null = same game that awarded it)
--   capillary_points {"points": 500}                        (awarded in Capillary via API)
--   digital_voucher  {"series_id": "DIN5", "face_value_cents": 500}
--   merchant_voucher {"merchant_id": "…", "source": "code_pool"|"vms", "series_id": "…", "face_value_cents": 1000}
--   promo_gift       {"collect_at": "Concierge, Tower 3 Level 1"}
--   exclusive_reward {"fulfilment": "code_pool"|"manual"}
--   privilege        {"duration_days": 30, "benefit": "VIP lounge access"}
--   none             {}
-- -----------------------------------------------------------------------------
create table if not exists public.rewards (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid references public.reward_categories (id) on delete set null,
  campaign_id         uuid references public.campaigns (id) on delete set null,   -- null = platform-wide
  key                 text not null,
  type                public.reward_type not null,
  name                text not null,
  description         text not null default '',
  image_path          text,
  value               jsonb not null default '{}',
  unit_cost_cents     int  not null default 0 check (unit_cost_cents >= 0),        -- business cost, used by simulator & reports
  in_catalogue        boolean not null default false,                              -- redeemable with Play Points
  pp_cost             int check (pp_cost is null or pp_cost > 0),
  eligibility_rule_id uuid references public.eligibility_rules (id) on delete set null,
  validity_days       int check (validity_days is null or validity_days > 0),      -- expiry relative to issue
  valid_until         timestamptz,                                                 -- or a fixed expiry date
  per_member_cap      int check (per_member_cap is null or per_member_cap > 0),
  per_member_period   public.recurrence not null default 'once',                   -- window for per_member_cap
  terms               text not null default '',
  sort                int not null default 100,
  status              public.record_status not null default 'active',
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint rewards_key_key unique (key),
  constraint rewards_value_is_object check (jsonb_typeof(value) = 'object'),
  constraint rewards_catalogue_needs_cost check (not in_catalogue or pp_cost is not null)
);
comment on table public.rewards is 'Reward definitions: Play Points, bonus attempts, Capillary points, vouchers, gifts, privileges. Catalogue items carry a Play Points price.';
create index if not exists rewards_catalogue_idx on public.rewards (category_id, sort) where in_catalogue and status = 'active';
create index if not exists rewards_campaign_idx on public.rewards (campaign_id);

-- -----------------------------------------------------------------------------
-- reward_inventory — stock per reward. NULL total_qty = unlimited.
-- remaining_qty is decremented under SELECT … FOR UPDATE by the engine.
-- -----------------------------------------------------------------------------
create table if not exists public.reward_inventory (
  reward_id           uuid primary key references public.rewards (id) on delete cascade,
  total_qty           int check (total_qty is null or total_qty >= 0),
  remaining_qty       int check (remaining_qty is null or remaining_qty >= 0),
  daily_cap           int check (daily_cap is null or daily_cap >= 0),
  low_stock_threshold int not null default 0,
  updated_at          timestamptz not null default now(),
  constraint reward_inventory_unlimited_chk check ((total_qty is null) = (remaining_qty is null)),
  constraint reward_inventory_le_total_chk  check (remaining_qty is null or remaining_qty <= total_qty)
);
comment on table public.reward_inventory is 'Stock & daily cap per reward (NULL = unlimited). Locked row-by-row during allocation to prevent overselling.';

-- Daily issued counter per reward (enforces daily_cap without scanning transactions).
create table if not exists public.reward_inventory_daily (
  reward_id  uuid not null references public.rewards (id) on delete cascade,
  day        date not null,
  issued     int  not null default 0 check (issued >= 0),
  primary key (reward_id, day)
);
comment on table public.reward_inventory_daily is 'Per-day issued counter per reward, for daily caps.';

-- Pre-loaded unique codes for merchant / exclusive rewards fulfilled from a code pool.
create table if not exists public.voucher_code_pool (
  id               uuid primary key default gen_random_uuid(),
  reward_id        uuid not null references public.rewards (id) on delete cascade,
  code             text not null,
  status           text not null default 'available' check (status in ('available', 'assigned', 'void')),
  assigned_txn_id  uuid,
  assigned_at      timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint voucher_code_pool_code_key unique (reward_id, code)
);
comment on table public.voucher_code_pool is 'Unique voucher codes uploaded by admins for code-pool rewards; assigned atomically with FOR UPDATE SKIP LOCKED.';
create index if not exists voucher_code_pool_available_idx on public.voucher_code_pool (reward_id, created_at) where status = 'available';
