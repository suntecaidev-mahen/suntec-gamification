-- =============================================================================
-- 0008 · Notifications: templates (admin-configurable), inbox, dispatches
-- =============================================================================

-- Template per event key. Variables use {{mustache}} syntax, rendered server-side.
-- Event keys: campaign_launched, mission_available, checkin_reminder, mission_completed,
-- game_result, reward_allocated, reward_expiring, badge_unlocked, leaderboard_update
create table if not exists public.notification_templates (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null,
  name               text not null,
  channels           public.notification_channel[] not null default '{inbox}',
  title              text not null,
  body               text not null,
  deep_link          text,
  quiet_hours_start  time,                 -- push suppressed inside quiet hours (business timezone)
  quiet_hours_end    time,
  locale             text not null default 'en',
  status             public.record_status not null default 'active',
  updated_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint notification_templates_key_locale_key unique (key, locale)
);
comment on table public.notification_templates is 'Admin-configurable notification templates per event (channels, title/body with {{variables}}, deep link, quiet hours).';

-- In-app inbox (always written). Realtime-enabled so the UI updates near-real-time.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  template_key  text not null,
  title         text not null,
  body          text not null,
  deep_link     text,
  data          jsonb not null default '{}',
  dedupe_key    text,                                 -- prevents duplicate notifications for one event
  read_at       timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint notifications_dedupe_key unique (member_id, dedupe_key)
);
comment on table public.notifications is 'Customer in-app inbox. Push/email delivery is tracked in notification_dispatches.';
create index if not exists notifications_member_idx on public.notifications (member_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (member_id) where read_at is null;

create table if not exists public.notification_dispatches (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  channel          public.notification_channel not null,
  status           public.dispatch_status not null default 'pending',
  external_ref     text,
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint notification_dispatches_channel_key unique (notification_id, channel)
);
comment on table public.notification_dispatches is 'Per-channel delivery status (push via existing Suntec+ push service, email).';
create index if not exists notification_dispatches_status_idx on public.notification_dispatches (status, created_at);
