-- =============================================================================
-- 0002 · Settings, members (customers), staff users & RBAC
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_settings — single-row platform configuration (timezone, currency, global caps).
-- Everything business-related is data-driven; nothing is hardcoded in code.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id              boolean primary key default true check (id),           -- enforces a single row
  timezone        text    not null default 'Asia/Singapore',
  currency        text    not null default 'SGD',
  locale          text    not null default 'en-SG',
  pp_name         text    not null default 'Play Points',                -- display name of the gamification currency
  pp_expiry_days  int              check (pp_expiry_days is null or pp_expiry_days > 0),
  max_plays_per_minute       int not null default 10,                    -- fraud velocity threshold (per member)
  max_members_per_device     int not null default 3,                     -- fraud: device sharing threshold
  auto_flag_on_high_severity boolean not null default true,
  push_daily_cap  int     not null default 3,
  retention       jsonb   not null default '{"raw_events_months":13,"game_sessions_months":24,"audit_years":7,"inactive_member_months":24}',
  updated_at      timestamptz not null default now()
);
comment on table public.app_settings is 'Single-row platform configuration: timezone for daily resets, currency, fraud thresholds, retention.';

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- Configured business timezone (falls back to Asia/Singapore).
create or replace function public.app_tz()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.app_settings where id), 'Asia/Singapore');
$$;

-- Business day (in the configured timezone) for a timestamp.
create or replace function public.business_day(ts timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (ts at time zone public.app_tz())::date;
$$;

-- Period key used by recurring missions & leaderboards:
--   daily → 2026-11-27 · weekly → 2026-W48 (ISO week) · monthly → 2026-11 · once/overall → all
create or replace function public.period_key(period text, ts timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case period
    when 'daily'   then to_char(ts at time zone public.app_tz(), 'YYYY-MM-DD')
    when 'weekly'  then to_char(ts at time zone public.app_tz(), 'IYYY-"W"IW')
    when 'monthly' then to_char(ts at time zone public.app_tz(), 'YYYY-MM')
    else 'all'
  end;
$$;

-- Customer-facing reference, e.g. GS-20261127-8F3K2Q7M (prefix, business date, 8 chars Crockford base32).
-- 32^8 ≈ 1.1e12 combinations per prefix per day; uniqueness is also enforced by UNIQUE constraints.
create or replace function public.gen_public_ref(prefix text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
  i int;
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return prefix || '-' || to_char(now() at time zone public.app_tz(), 'YYYYMMDD') || '-' || result;
end;
$$;

-- -----------------------------------------------------------------------------
-- members — the gamification CUSTOMER record.
-- Holds only a reference to the Suntec+/Capillary member plus the minimum personal
-- data needed (PDPA data minimisation). Loyalty points/vouchers live in Capillary.
-- -----------------------------------------------------------------------------
create table if not exists public.members (
  id                uuid primary key default gen_random_uuid(),
  suntec_member_id  text not null,                        -- Suntec+/Capillary member id (external key)
  card_no           text,                                 -- loyalty card number (searchable by CS staff)
  auth_user_id      uuid references auth.users (id) on delete set null,  -- Supabase Auth user (portal / embed session)
  first_name        text,
  last_name         text,
  email             extensions.citext,
  mobile            text,
  tier              text not null default 'member',       -- mirrored from Capillary (cached)
  tags              text[] not null default '{}',         -- Capillary segment tags (cached)
  joined_at         timestamptz,                          -- Suntec+ membership start date
  status            public.member_status not null default 'active',
  status_reason     text,
  profile_synced_at timestamptz,                          -- last Capillary refresh
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint members_suntec_member_id_key unique (suntec_member_id),
  constraint members_card_no_key unique (card_no),
  constraint members_auth_user_id_key unique (auth_user_id)
);
comment on table public.members is 'Gamification customer: reference to the Suntec+/Capillary member + minimal PII. No loyalty balances are stored here.';
create index if not exists members_email_idx  on public.members (email);
create index if not exists members_status_idx on public.members (status) where status <> 'active';
create index if not exists members_tier_idx   on public.members (tier);

-- -----------------------------------------------------------------------------
-- member_profiles — CustomerGamificationProfile: Play Points balance, counters, privacy.
-- The row is locked FOR UPDATE by engine functions whenever balances change.
-- -----------------------------------------------------------------------------
create table if not exists public.member_profiles (
  member_id           uuid primary key references public.members (id) on delete cascade,
  pp_balance          bigint not null default 0 check (pp_balance >= 0),   -- Play Points (NOT Capillary points)
  pp_lifetime_earned  bigint not null default 0 check (pp_lifetime_earned >= 0),
  games_played        int    not null default 0,
  missions_completed  int    not null default 0,
  checkins_total      int    not null default 0,
  quiz_wins           int    not null default 0,
  badges_count        int    not null default 0,
  visits_count        int    not null default 0,
  lifetime_spend_cents bigint not null default 0,
  distinct_stores     int    not null default 0,
  last_active_at      timestamptz,
  lb_display_mode     public.display_mode not null default 'masked',
  lb_nickname         text check (lb_nickname is null or char_length(lb_nickname) between 2 and 24),
  lb_opt_out          boolean not null default false,
  notify_push         boolean not null default true,
  notify_email        boolean not null default false,
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.member_profiles is 'Gamification profile per member: Play Points balance (separate ledger from Capillary), engagement counters, leaderboard privacy and notification preferences.';

-- Devices seen per member (hashed) — fraud signal: many members on one device.
create table if not exists public.member_devices (
  member_id    uuid not null references public.members (id) on delete cascade,
  device_hash  text not null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (member_id, device_hash)
);
comment on table public.member_devices is 'Hashed device identifiers per member, used for device-sharing fraud detection.';
create index if not exists member_devices_device_idx on public.member_devices (device_hash);

-- -----------------------------------------------------------------------------
-- Staff (AdminUser) & RBAC (UserRole)
-- -----------------------------------------------------------------------------
create table if not exists public.staff_users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         extensions.citext not null,
  display_name  text not null,
  active        boolean not null default true,
  mfa_required  boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint staff_users_email_key unique (email)
);
comment on table public.staff_users is 'Admin panel users (mall staff / marketing). Linked 1:1 to Supabase Auth users.';

create table if not exists public.roles (
  key          text primary key,
  name         text not null,
  description  text not null default '',
  sort         int  not null default 0
);
comment on table public.roles is 'RBAC roles (Super Administrator, Campaign Administrator, Marketing, Customer Service, Reporting, Read-Only).';

create table if not exists public.permissions (
  key          text primary key,
  description  text not null default ''
);
comment on table public.permissions is 'Fine-grained permission keys checked by the API and by RLS via has_permission().';

create table if not exists public.role_permissions (
  role_key        text not null references public.roles (key) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table if not exists public.staff_user_roles (
  user_id     uuid not null references public.staff_users (id) on delete cascade,
  role_key    text not null references public.roles (key) on delete cascade,
  granted_by  uuid references public.staff_users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_key)
);
create index if not exists staff_user_roles_role_idx on public.staff_user_roles (role_key);

-- Reference data: roles & permissions (required in every environment, not demo data)
insert into public.roles (key, name, description, sort) values
  ('super_admin',      'Super Administrator',    'Full access including users, roles, API clients and settings', 1),
  ('campaign_admin',   'Campaign Administrator', 'Configure campaigns, games, missions, rewards; act on customers', 2),
  ('marketing',        'Marketing User',         'Content, banners, notification templates; reports; masked customer view', 3),
  ('customer_service', 'Customer Service User',  'Customer search & 360 view, grants within limits, retry failed rewards', 4),
  ('reporting',        'Reporting User',         'Dashboards, reports and exports', 5),
  ('read_only',        'Read-Only User',         'View-only access (masked personal data)', 6)
on conflict (key) do update set name = excluded.name, description = excluded.description, sort = excluded.sort;

insert into public.permissions (key, description) values
  ('staff.manage',        'Manage staff users and role assignments'),
  ('settings.manage',     'Change platform settings'),
  ('api_clients.manage',  'Create, rotate and revoke integration API keys'),
  ('campaigns.read',      'View campaigns, games, missions and configuration'),
  ('campaigns.write',     'Create and edit campaigns and their configuration'),
  ('campaigns.publish',   'Publish, pause and end campaigns and games'),
  ('games.write',         'Configure games, outcomes, probabilities and quiz banks'),
  ('missions.write',      'Configure missions, check-in programmes, badges and leaderboards'),
  ('content.write',       'Edit content: banners, copy, quiz questions, images'),
  ('rewards.read',        'View rewards, inventory and reward transactions'),
  ('rewards.write',       'Manage reward catalogue and inventory'),
  ('notifications.write', 'Manage notification templates'),
  ('customers.read',      'Search customers and view gamification profiles'),
  ('customers.pii',       'View unmasked personal data (name, email, mobile)'),
  ('customers.act',       'Grant attempts/rewards, flag/block customers, retry failed rewards'),
  ('reports.read',        'View dashboards and reports'),
  ('reports.export',      'Export reports (CSV/Excel)'),
  ('audit.read',          'View the full audit log'),
  ('audit.read_own',      'View own audit entries')
on conflict (key) do update set description = excluded.description;

-- Role → permission matrix (see docs/solution/02-modules.md §M-11)
insert into public.role_permissions (role_key, permission_key)
select r.role_key, r.permission_key
from (values
  -- super_admin: everything
  ('super_admin','staff.manage'),('super_admin','settings.manage'),('super_admin','api_clients.manage'),
  ('super_admin','campaigns.read'),('super_admin','campaigns.write'),('super_admin','campaigns.publish'),
  ('super_admin','games.write'),('super_admin','missions.write'),('super_admin','content.write'),
  ('super_admin','rewards.read'),('super_admin','rewards.write'),('super_admin','notifications.write'),
  ('super_admin','customers.read'),('super_admin','customers.pii'),('super_admin','customers.act'),
  ('super_admin','reports.read'),('super_admin','reports.export'),('super_admin','audit.read'),('super_admin','audit.read_own'),
  -- campaign_admin
  ('campaign_admin','campaigns.read'),('campaign_admin','campaigns.write'),('campaign_admin','campaigns.publish'),
  ('campaign_admin','games.write'),('campaign_admin','missions.write'),('campaign_admin','content.write'),
  ('campaign_admin','rewards.read'),('campaign_admin','rewards.write'),('campaign_admin','notifications.write'),
  ('campaign_admin','customers.read'),('campaign_admin','customers.pii'),('campaign_admin','customers.act'),
  ('campaign_admin','reports.read'),('campaign_admin','reports.export'),('campaign_admin','audit.read_own'),
  -- marketing
  ('marketing','campaigns.read'),('marketing','content.write'),('marketing','notifications.write'),
  ('marketing','rewards.read'),('marketing','customers.read'),('marketing','reports.read'),('marketing','reports.export'),
  ('marketing','audit.read_own'),
  -- customer_service
  ('customer_service','campaigns.read'),('customer_service','rewards.read'),('customer_service','customers.read'),
  ('customer_service','customers.pii'),('customer_service','customers.act'),('customer_service','audit.read_own'),
  -- reporting
  ('reporting','campaigns.read'),('reporting','rewards.read'),('reporting','reports.read'),('reporting','reports.export'),
  -- read_only
  ('read_only','campaigns.read'),('read_only','rewards.read'),('read_only','customers.read'),('read_only','reports.read')
) as r(role_key, permission_key)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Auth / RBAC helper functions (SECURITY DEFINER so RLS policies can call them
-- without recursive policy evaluation). search_path is pinned for safety.
-- -----------------------------------------------------------------------------

-- members.id of the signed-in customer (null for staff / anonymous).
create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m
  where m.auth_user_id = auth.uid() and m.status <> 'anonymised'
  limit 1;
$$;

-- True when the signed-in user is an active staff user.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_users s where s.id = auth.uid() and s.active);
$$;

-- True when the signed-in staff user holds a role granting the permission.
create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_users s
    join public.staff_user_roles ur on ur.user_id = s.id
    join public.role_permissions rp on rp.role_key = ur.role_key
    where s.id = auth.uid() and s.active and rp.permission_key = perm
  );
$$;

-- All permission keys of the signed-in staff user (used by the admin UI to render menus).
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission_key
  from public.staff_users s
  join public.staff_user_roles ur on ur.user_id = s.id
  join public.role_permissions rp on rp.role_key = ur.role_key
  where s.id = auth.uid() and s.active;
$$;

-- One-time bootstrap: promote an existing Supabase Auth user (by email) to Super Administrator.
-- Only works while NO active super admin exists. Run it from the Supabase SQL Editor:
--   select public.bootstrap_super_admin('you@company.com', 'Your Name');
create or replace function public.bootstrap_super_admin(admin_email text, admin_name text default 'Super Admin')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  if exists (
    select 1 from public.staff_user_roles ur
    join public.staff_users s on s.id = ur.user_id
    where ur.role_key = 'super_admin' and s.active
  ) then
    raise exception 'A super admin already exists. Use the admin panel (Users & roles) to add staff.';
  end if;

  select u.id into uid from auth.users u where lower(u.email) = lower(admin_email);
  if uid is null then
    raise exception 'No Supabase Auth user with email %. Create the user first (Authentication → Users → Add user).', admin_email;
  end if;

  insert into public.staff_users (id, email, display_name)
  values (uid, admin_email, admin_name)
  on conflict (id) do update set active = true, display_name = excluded.display_name;

  insert into public.staff_user_roles (user_id, role_key) values (uid, 'super_admin')
  on conflict do nothing;

  return 'OK: ' || admin_email || ' is now Super Administrator';
end;
$$;

-- bootstrap is for the SQL Editor (postgres role) only — never callable through the API.
revoke all on function public.bootstrap_super_admin(text, text) from public;
do $$ begin
  revoke all on function public.bootstrap_super_admin(text, text) from anon, authenticated;
exception when undefined_object then null; end $$;
