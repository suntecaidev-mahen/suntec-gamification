-- =============================================================================
-- 0009 · Platform: API clients, session handoff, idempotency, rate limits,
--        inbound/domain events, fraud signals, audit log, analytics rollups
-- These tables are SERVER-ONLY (service role) unless a staff policy says otherwise.
-- =============================================================================

-- Integration clients (Suntec+ backend, Capillary webhooks, POS). Key stored as SHA-256 only.
create table if not exists public.api_clients (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  key_prefix         text not null,                        -- first chars shown in admin, e.g. "sk_live_ab12"
  key_hash           text not null,                        -- sha256(api key)
  scopes             text[] not null default '{}',         -- sessions:write events:write members:read attempts:write webhooks:write
  require_signature  boolean not null default false,       -- require X-Signature HMAC on requests
  rate_limit_per_min int not null default 1200 check (rate_limit_per_min > 0),
  active             boolean not null default true,
  expires_at         timestamptz,
  last_used_at       timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint api_clients_key_hash_key unique (key_hash)
);
comment on table public.api_clients is 'Server-to-server API clients with hashed keys, scopes, optional HMAC signing and per-client rate limits.';

-- Single-use, short-lived code that the Suntec+ backend exchanges for an in-app session (SSO handoff).
create table if not exists public.session_handoffs (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null,
  member_id    uuid not null references public.members (id) on delete cascade,
  client_id    uuid references public.api_clients (id) on delete set null,
  entry        text,                         -- deep-link target inside the module (spin, missions…)
  return_url   text,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  ip_hash      text,
  created_at   timestamptz not null default now(),
  constraint session_handoffs_code_hash_key unique (code_hash)
);
comment on table public.session_handoffs is 'SSO handoff codes (hash only, 60 s TTL, single use) for opening the module inside the Suntec+ app WebView.';
create index if not exists session_handoffs_expiry_idx on public.session_handoffs (expires_at) where used_at is null;

-- Idempotency store for value-moving API calls. Replays return the stored response.
create table if not exists public.idempotency_keys (
  scope            text not null,            -- e.g. member:<uuid>:POST /games/:id/sessions | client:<uuid>
  key              text not null,
  request_hash     text not null,            -- sha256 of method+path+body; mismatch → 409
  state            public.idempotency_state not null default 'in_progress',
  response_status  int,
  response         jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  primary key (scope, key)
);
comment on table public.idempotency_keys is 'Idempotency-Key records (24 h): duplicate requests replay the original response.';
create index if not exists idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);

-- Fixed-window rate limit counters. UNLOGGED: fast, and losing them on crash is acceptable.
create unlogged table if not exists public.rate_limits (
  key           text not null,                 -- member:<id>:play | ip:<hash> | client:<id>
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);
comment on table public.rate_limits is 'Fixed-window rate-limit counters (unlogged, purged continuously).';

-- Inbound integration events (transactions, visits, voucher redemptions…). Dedup per source.
create table if not exists public.inbound_events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                 -- api client name or webhook:<provider>
  client_id     uuid references public.api_clients (id) on delete set null,
  type          text not null,                 -- transaction | mall_visit | voucher_redeemed | campaign_participation | activity
  external_id   text not null,
  member_id     uuid references public.members (id) on delete set null,
  suntec_member_id text,
  occurred_at   timestamptz not null,
  payload       jsonb not null default '{}',
  status        public.inbound_event_status not null default 'received',
  effects       jsonb not null default '[]',
  error         text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  constraint inbound_events_dedupe_key unique (source, external_id)
);
comment on table public.inbound_events is 'Events received from Suntec+/Capillary/POS, deduplicated by (source, external_id), with resulting effects.';
create index if not exists inbound_events_member_idx on public.inbound_events (member_id, occurred_at desc);
create index if not exists inbound_events_status_idx on public.inbound_events (status, received_at);

-- Internal domain events emitted inside engine transactions; consumed for badge
-- evaluation, notifications and analytics.
create table if not exists public.domain_events (
  id            bigint generated always as identity primary key,
  type          text not null,                 -- checkin.completed | game.completed | mission.completed | reward.allocated …
  member_id     uuid references public.members (id) on delete set null,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
comment on table public.domain_events is 'Domain events written in the same transaction as engine changes (event bus between modules).';
create index if not exists domain_events_unprocessed_idx on public.domain_events (id) where processed_at is null;
create index if not exists domain_events_member_idx on public.domain_events (member_id, created_at desc);
create index if not exists domain_events_type_idx on public.domain_events (type, created_at);

-- Fraud signals (velocity, device sharing, QR bursts, quiz timing anomalies…).
create table if not exists public.fraud_signals (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references public.members (id) on delete cascade,
  kind          text not null,                 -- velocity | device_sharing | qr_burst | quiz_timing | duplicate_attempt …
  severity      public.fraud_severity not null default 'low',
  details       jsonb not null default '{}',
  device_hash   text,
  ip_hash       text,
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  resolution    text,
  created_at    timestamptz not null default now()
);
comment on table public.fraud_signals is 'Anti-fraud signals for review; high severity may auto-flag the member.';
create index if not exists fraud_signals_member_idx on public.fraud_signals (member_id, created_at desc);
create index if not exists fraud_signals_open_idx on public.fraud_signals (severity, created_at) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- audit_log — append-only record of every administrative change.
-- Written automatically by trigger on configuration tables (actor = auth.uid()
-- or the app.actor_id setting when the API acts via the service role).
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  actor_type   public.actor_type not null,
  actor_id     uuid,
  actor_label  text,
  action       text not null,                  -- <table>.insert|update|delete or domain action e.g. reward.grant
  entity       text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip_hash      text,
  request_id   text,
  created_at   timestamptz not null default now()
);
comment on table public.audit_log is 'Append-only audit trail of admin actions and manual operations (who, what, before/after, when).';
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();

-- Generic row-change audit trigger.
-- Optional trigger argument 'staff_only': only log changes made by a staff user
-- (used on tables the engine also updates at high frequency, e.g. inventory counters).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_type public.actor_type;
  v_setting text;
  v_before jsonb;
  v_after jsonb;
  v_id text;
begin
  if v_actor is null then
    v_setting := nullif(current_setting('app.actor_id', true), '');
    if v_setting is not null then v_actor := v_setting::uuid; end if;
  end if;

  if v_actor is null then
    v_actor_type := 'system';
  elsif exists (select 1 from public.staff_users s where s.id = v_actor) then
    v_actor_type := 'staff';
  else
    v_actor_type := 'member';
  end if;

  if tg_nargs > 0 and tg_argv[0] = 'staff_only' and v_actor_type <> 'staff' then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;

  -- skip no-op updates (only updated_at changed)
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return new;
  end if;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key',
                   v_after ->> 'reward_id', v_before ->> 'reward_id');

  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, before, after, request_id)
  values (v_actor_type, v_actor, tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          v_before, v_after, nullif(current_setting('app.request_id', true), ''));

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- analytics_daily — pre-aggregated daily metrics for dashboards & reports.
-- Dimension columns use a zero UUID for "all" so they can be part of the PK.
-- -----------------------------------------------------------------------------
create table if not exists public.analytics_daily (
  day          date not null,
  metric       text not null,                 -- dau | plays | wins | pp_issued | rewards_issued | rewards_redeemed | missions_completed | checkins …
  campaign_id  uuid not null default '00000000-0000-0000-0000-000000000000',
  game_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  value        numeric(18,2) not null default 0,
  computed_at  timestamptz not null default now(),
  primary key (day, metric, campaign_id, game_id)
);
comment on table public.analytics_daily is 'Daily KPI rollups (refreshed by scheduled job) for dashboards, reports and BI.';
create index if not exists analytics_daily_metric_idx on public.analytics_daily (metric, day);
