-- =============================================================================
-- 0010 · MOCK Capillary loyalty & voucher system (DEV / SIT only)
--
-- Simulates the EXISTING Suntec+ loyalty platform (Capillary) and Voucher
-- Management System so the full flow can be developed and tested before API
-- access is granted. The gamification engine NEVER reads these tables directly —
-- it goes through the LoyaltyAdapter / VoucherAdapter (packages/core), whose
-- "mock" implementation calls server-only functions added in Phase 2.
--
-- Do NOT deploy to PROD (set LOYALTY_ADAPTER=capillary there).
-- =============================================================================

create schema if not exists mock_capillary;
comment on schema mock_capillary is 'Mock of the external Capillary loyalty platform + voucher system. Not used in production.';

create table if not exists mock_capillary.members (
  member_id    text primary key,              -- e.g. SUN-00012345
  card_no      text not null unique,
  first_name   text not null,
  last_name    text not null,
  email        extensions.citext unique,
  mobile       text,
  tier         text not null default 'member',  -- member | silver | gold | platinum
  tags         text[] not null default '{}',
  dob          date,
  joined_at    timestamptz not null default now(),
  status       text not null default 'active' check (status in ('active', 'suspended', 'closed'))
);
comment on table mock_capillary.members is 'Mock Capillary member master.';

create table if not exists mock_capillary.points_accounts (
  member_id    text primary key references mock_capillary.members (member_id) on delete cascade,
  balance      bigint not null default 0 check (balance >= 0),
  updated_at   timestamptz not null default now()
);
comment on table mock_capillary.points_accounts is 'Mock Suntec+ loyalty points balance (the real one lives in Capillary).';

create table if not exists mock_capillary.points_transactions (
  id               uuid primary key default gen_random_uuid(),
  external_ref     text not null unique default ('CAP-TX-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10))),
  member_id        text not null references mock_capillary.members (member_id) on delete cascade,
  delta            bigint not null check (delta <> 0),
  reason           text not null,
  idempotency_key  text not null unique,     -- Capillary-style dedupe: same key → same transaction
  reversed_by      uuid,
  created_at       timestamptz not null default now()
);
comment on table mock_capillary.points_transactions is 'Mock loyalty points transactions with idempotency.';
create index if not exists mock_points_tx_member_idx on mock_capillary.points_transactions (member_id, created_at desc);

create table if not exists mock_capillary.coupon_series (
  series_id         text primary key,          -- e.g. DIN5
  name              text not null,
  face_value_cents  int  not null default 0,
  validity_days     int  not null default 30,
  merchant_code     text,
  active            boolean not null default true
);
comment on table mock_capillary.coupon_series is 'Mock voucher/coupon series in the Voucher Management System.';

create table if not exists mock_capillary.coupons (
  id               uuid primary key default gen_random_uuid(),
  external_ref     text not null unique default ('VMS-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10))),
  series_id        text not null references mock_capillary.coupon_series (series_id),
  member_id        text not null references mock_capillary.members (member_id) on delete cascade,
  code             text not null unique,
  status           text not null default 'issued' check (status in ('issued', 'redeemed', 'expired', 'cancelled')),
  idempotency_key  text not null unique,
  issued_at        timestamptz not null default now(),
  redeemed_at      timestamptz,
  expires_at       timestamptz
);
comment on table mock_capillary.coupons is 'Mock vouchers issued to members.';
create index if not exists mock_coupons_member_idx on mock_capillary.coupons (member_id, issued_at desc);

-- Lock the mock schema down: no access for API roles except the service role.
do $$ begin
  revoke all on schema mock_capillary from public;
  revoke all on all tables in schema mock_capillary from anon, authenticated;
  grant usage on schema mock_capillary to service_role;
  grant all on all tables in schema mock_capillary to service_role;
exception when undefined_object then null; end $$;

alter table mock_capillary.members             enable row level security;
alter table mock_capillary.points_accounts     enable row level security;
alter table mock_capillary.points_transactions enable row level security;
alter table mock_capillary.coupon_series       enable row level security;
alter table mock_capillary.coupons             enable row level security;
