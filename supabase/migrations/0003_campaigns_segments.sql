-- =============================================================================
-- 0003 · Segments, eligibility rules, merchants, campaigns
-- =============================================================================

-- -----------------------------------------------------------------------------
-- segments — target customer segments, defined as declarative rules evaluated
-- against member attributes (tier, tags, join date, engagement counters).
-- Rule format (validated by Zod in packages/core):
--   {"all":[{"field":"tier","op":"in","value":["gold","platinum"]},
--           {"field":"joined_days","op":"lte","value":90}]}
-- -----------------------------------------------------------------------------
create table if not exists public.segments (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,
  name         text not null,
  description  text not null default '',
  rules        jsonb not null default '{"all":[]}',
  status       public.record_status not null default 'active',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint segments_key_key unique (key),
  constraint segments_rules_is_object check (jsonb_typeof(rules) = 'object')
);
comment on table public.segments is 'Target customer segments as declarative rules (tier, tags, join date, engagement). Evaluated by the engine.';

-- -----------------------------------------------------------------------------
-- eligibility_rules — reusable participation conditions attached to campaigns,
-- games, missions, rewards and check-in programmes. Same rule grammar as segments,
-- plus optional segment references: {"segments_any":["<uuid>"], "all":[...]}
-- -----------------------------------------------------------------------------
create table if not exists public.eligibility_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null default '',
  rules        jsonb not null default '{"all":[]}',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint eligibility_rules_rules_is_object check (jsonb_typeof(rules) = 'object')
);
comment on table public.eligibility_rules is 'Reusable eligibility conditions (tier, new vs existing, segments, dates) referenced by campaigns, games, missions and rewards.';

-- -----------------------------------------------------------------------------
-- merchants — participating Suntec City tenants (for spend/visit missions and
-- merchant vouchers). merchant_code is the id used by the transaction system.
-- -----------------------------------------------------------------------------
create table if not exists public.merchants (
  id              uuid primary key default gen_random_uuid(),
  merchant_code   text not null,
  name            text not null,
  category        text not null default 'retail',
  unit_no         text,
  logo_path       text,
  is_participating boolean not null default true,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint merchants_code_key unique (merchant_code)
);
comment on table public.merchants is 'Suntec City tenants. Participating merchants count towards spend/visit missions and can fund merchant vouchers.';
create index if not exists merchants_participating_idx on public.merchants (is_participating) where status = 'active';

-- -----------------------------------------------------------------------------
-- campaigns — container for games, missions, check-in programmes, rewards and
-- leaderboards, with schedule, audience, priority and participation limits.
-- limits: {"per_day":5,"per_week":20,"per_campaign":100,"cooldown_seconds":30}
-- -----------------------------------------------------------------------------
create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null,
  name                text not null,
  description         text not null default '',
  banner_path         text,                               -- Supabase Storage path (bucket: public-assets)
  theme               jsonb not null default '{}',        -- optional colour/imagery overrides
  priority            int  not null default 100,          -- lower = shown first
  status              public.lifecycle_status not null default 'draft',
  starts_at           timestamptz,
  ends_at             timestamptz,
  eligibility_rule_id uuid references public.eligibility_rules (id) on delete set null,
  limits              jsonb not null default '{}',
  terms               text not null default '',
  preview_token_hash  text,                               -- signed preview link (hash only)
  published_at        timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint campaigns_slug_key unique (slug),
  constraint campaigns_dates_chk check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint campaigns_limits_is_object check (jsonb_typeof(limits) = 'object')
);
comment on table public.campaigns is 'Marketing campaign: schedule (SGT), target segments, eligibility, priority, participation limits. Groups games, missions, rewards and leaderboards.';
create index if not exists campaigns_live_idx on public.campaigns (status, starts_at, ends_at);
create index if not exists campaigns_priority_idx on public.campaigns (priority) where status = 'active';

create table if not exists public.campaign_segments (
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  segment_id   uuid not null references public.segments (id) on delete cascade,
  primary key (campaign_id, segment_id)
);
comment on table public.campaign_segments is 'Target segments for a campaign (empty = all members).';
create index if not exists campaign_segments_segment_idx on public.campaign_segments (segment_id);
