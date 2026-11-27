-- =============================================================================
-- 0012 · Row Level Security — enabled on EVERY table
--
-- Model:
--   * Customers (role `authenticated`, linked via members.auth_user_id) can only
--     READ their own rows. They never write directly: every customer action goes
--     through the API → SECURITY DEFINER engine functions (Phase 2).
--   * Staff are checked by permission via has_permission() (RBAC, see 0002).
--   * Platform tables (idempotency, rate limits, handoffs, domain events) have NO
--     policies → reachable only by the service role on the server.
--   * Sensitive config (outcome weights, quiz answers, segments) is staff-only.
-- Policies call helpers through (select …) so Postgres evaluates them once per query.
-- Safe to re-run (drop policy if exists → create policy).
-- =============================================================================

-- 1) Enable RLS on all tables in public -----------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Helper used only while this migration runs: (re)create a policy idempotently.
create or replace function public._upsert_policy(
  p_table text, p_name text, p_cmd text, p_using text, p_check text default null
) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format(
    'create policy %I on public.%I as permissive for %s to authenticated %s %s',
    p_name, p_table, p_cmd,
    case when p_using is not null then 'using (' || p_using || ')' else '' end,
    case when p_check is not null then 'with check (' || p_check || ')' else '' end
  );
end;
$$;

-- 2) Customer-owned data: member reads own rows; staff read with a permission ----
do $$
declare
  r record;
begin
  for r in select * from (values
    ('member_profiles',      'customers.read'),
    ('game_sessions',        'customers.read'),
    ('attempt_balances',     'customers.read'),
    ('attempt_ledger',       'customers.read'),
    ('checkins',             'customers.read'),
    ('member_streaks',       'customers.read'),
    ('mission_enrolments',   'customers.read'),
    ('mission_progress',     'customers.read'),
    ('member_badges',        'customers.read'),
    ('points_ledger',        'customers.read'),
    ('reward_transactions',  'rewards.read'),
    ('notifications',        'customers.read'),
    ('leaderboard_scores',   'customers.read'),
    ('qr_scans',             'customers.read')
  ) as t(tbl, perm) loop
    perform public._upsert_policy(r.tbl, 'member_read_own', 'select',
      'member_id = (select public.current_member_id())');
    perform public._upsert_policy(r.tbl, 'staff_read', 'select',
      format('(select public.has_permission(%L))', r.perm));
  end loop;
end $$;

-- reward transactions are also visible to customer-service staff
select public._upsert_policy('reward_transactions', 'staff_read_cs', 'select',
  '(select public.has_permission(''customers.read''))');

-- members: own row; unmasked staff access requires customers.pii
-- (masked search for other roles is provided by an RPC in Phase 3)
select public._upsert_policy('members', 'member_read_own', 'select', 'id = (select public.current_member_id())');
select public._upsert_policy('members', 'staff_read_pii', 'select', '(select public.has_permission(''customers.pii''))');

select public._upsert_policy('member_devices', 'staff_read', 'select', '(select public.has_permission(''customers.read''))');

-- quiz answers: via the parent session
select public._upsert_policy('game_session_answers', 'member_read_own', 'select',
  'exists (select 1 from public.game_sessions s where s.id = session_id and s.member_id = (select public.current_member_id()))');
select public._upsert_policy('game_session_answers', 'staff_read', 'select', '(select public.has_permission(''customers.read''))');

-- notifications: a member may mark their own notifications as read (column-restricted below)
select public._upsert_policy('notifications', 'member_mark_read', 'update',
  'member_id = (select public.current_member_id())', 'member_id = (select public.current_member_id())');
do $$ begin
  revoke update on public.notifications from authenticated;
  grant update (read_at) on public.notifications to authenticated;
exception when undefined_object then null; end $$;

-- 3) Customer-visible configuration (published items only) ----------------------
select public._upsert_policy('campaigns', 'member_read_published', 'select',
  '(select public.current_member_id()) is not null and status in (''active'', ''scheduled'')');
select public._upsert_policy('games', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('missions', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('checkin_programs', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('checkin_streak_rules', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and exists (select 1 from public.checkin_programs p where p.id = program_id and p.status = ''active'')');
select public._upsert_policy('badges', 'member_read_visible', 'select',
  '(select public.current_member_id()) is not null and status = ''active'' and (not hidden or exists (select 1 from public.member_badges mb where mb.badge_id = badges.id and mb.member_id = (select public.current_member_id())))');
select public._upsert_policy('rewards', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('reward_categories', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('merchants', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('leaderboards', 'member_read_active', 'select',
  '(select public.current_member_id()) is not null and status = ''active''');
select public._upsert_policy('game_types', 'authenticated_read', 'select', 'true');
-- NOT customer-visible: game_outcomes (weights), quiz_questions/quiz_options (answers),
-- segments, eligibility_rules, reward_inventory, voucher_code_pool, qr_codes, templates.

-- 4) Staff configuration: read with campaigns.read / rewards.read, write with the module permission
do $$
declare
  r record;
begin
  for r in select * from (values
    -- table,                   read expression,                                                         write expression
    ('campaigns',             'campaigns.read', '(select public.has_permission(''campaigns.write''))'),
    ('campaign_segments',     'campaigns.read', '(select public.has_permission(''campaigns.write''))'),
    ('segments',              'campaigns.read', '(select public.has_permission(''campaigns.write''))'),
    ('eligibility_rules',     'campaigns.read', '(select public.has_permission(''campaigns.write''))'),
    ('games',                 'campaigns.read', '(select public.has_permission(''games.write''))'),
    ('game_outcomes',         'campaigns.read', '(select public.has_permission(''games.write''))'),
    ('quiz_questions',        'campaigns.read', '((select public.has_permission(''games.write'')) or (select public.has_permission(''content.write'')))'),
    ('quiz_options',          'campaigns.read', '((select public.has_permission(''games.write'')) or (select public.has_permission(''content.write'')))'),
    ('missions',              'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('checkin_programs',      'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('checkin_streak_rules',  'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('badges',                'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('leaderboards',          'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('leaderboard_exclusions','campaigns.read', '((select public.has_permission(''missions.write'')) or (select public.has_permission(''customers.act'')))'),
    ('leaderboard_snapshots', 'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('qr_codes',              'campaigns.read', '(select public.has_permission(''missions.write''))'),
    ('merchants',             'campaigns.read', '((select public.has_permission(''rewards.write'')) or (select public.has_permission(''campaigns.write'')))'),
    ('rewards',               'rewards.read',   '(select public.has_permission(''rewards.write''))'),
    ('reward_categories',     'rewards.read',   '(select public.has_permission(''rewards.write''))'),
    ('reward_inventory',      'rewards.read',   '(select public.has_permission(''rewards.write''))'),
    ('reward_inventory_daily','rewards.read',   'false'),
    ('voucher_code_pool',     'rewards.write',  '(select public.has_permission(''rewards.write''))'),
    ('notification_templates','campaigns.read', '(select public.has_permission(''notifications.write''))')
  ) as t(tbl, read_perm, write_expr) loop
    perform public._upsert_policy(r.tbl, 'staff_read', 'select', format('(select public.has_permission(%L))', r.read_perm));
    if r.write_expr <> 'false' then
      perform public._upsert_policy(r.tbl, 'staff_insert', 'insert', null, r.write_expr);
      perform public._upsert_policy(r.tbl, 'staff_update', 'update', r.write_expr, r.write_expr);
      perform public._upsert_policy(r.tbl, 'staff_delete', 'delete', r.write_expr);
    end if;
  end loop;
end $$;

-- 5) Access control, settings, integration & operations ------------------------
select public._upsert_policy('app_settings', 'staff_read', 'select', '(select public.is_staff())');
select public._upsert_policy('app_settings', 'staff_update', 'update',
  '(select public.has_permission(''settings.manage''))', '(select public.has_permission(''settings.manage''))');

select public._upsert_policy('roles', 'staff_read', 'select', '(select public.is_staff())');
select public._upsert_policy('permissions', 'staff_read', 'select', '(select public.is_staff())');
select public._upsert_policy('role_permissions', 'staff_read', 'select', '(select public.is_staff())');
select public._upsert_policy('role_permissions', 'staff_write', 'all',
  '(select public.has_permission(''staff.manage''))', '(select public.has_permission(''staff.manage''))');

select public._upsert_policy('staff_users', 'staff_read_self', 'select', 'id = (select auth.uid())');
select public._upsert_policy('staff_users', 'staff_read_all', 'select', '(select public.has_permission(''staff.manage''))');
select public._upsert_policy('staff_users', 'staff_write', 'all',
  '(select public.has_permission(''staff.manage''))', '(select public.has_permission(''staff.manage''))');
select public._upsert_policy('staff_user_roles', 'staff_read_self', 'select', 'user_id = (select auth.uid())');
select public._upsert_policy('staff_user_roles', 'staff_read_all', 'select', '(select public.has_permission(''staff.manage''))');
select public._upsert_policy('staff_user_roles', 'staff_write', 'all',
  '(select public.has_permission(''staff.manage''))', '(select public.has_permission(''staff.manage''))');

select public._upsert_policy('api_clients', 'staff_manage', 'all',
  '(select public.has_permission(''api_clients.manage''))', '(select public.has_permission(''api_clients.manage''))');

select public._upsert_policy('audit_log', 'staff_read_all', 'select', '(select public.has_permission(''audit.read''))');
select public._upsert_policy('audit_log', 'staff_read_own', 'select',
  'actor_id = (select auth.uid()) and (select public.has_permission(''audit.read_own''))');

select public._upsert_policy('fraud_signals', 'staff_read', 'select', '(select public.has_permission(''customers.read''))');
select public._upsert_policy('fraud_signals', 'staff_resolve', 'update',
  '(select public.has_permission(''customers.act''))', '(select public.has_permission(''customers.act''))');

select public._upsert_policy('outbox', 'staff_read', 'select', '(select public.has_permission(''rewards.read''))');
select public._upsert_policy('inbound_events', 'staff_read', 'select', '(select public.has_permission(''customers.read''))');
select public._upsert_policy('notification_dispatches', 'staff_read', 'select', '(select public.has_permission(''customers.read''))');
select public._upsert_policy('analytics_daily', 'staff_read', 'select', '(select public.has_permission(''reports.read''))');

-- Server-only tables (no policies on purpose): idempotency_keys, rate_limits,
-- session_handoffs, domain_events, mission_progress_events. Belt and braces:
do $$ begin
  revoke all on public.idempotency_keys, public.rate_limits, public.session_handoffs,
                public.domain_events, public.mission_progress_events from anon, authenticated;
exception when undefined_object then null; end $$;

-- Anonymous visitors get nothing from any table.
do $$ begin
  revoke all on all tables in schema public from anon;
exception when undefined_object then null; end $$;

drop function if exists public._upsert_policy(text, text, text, text, text);

-- 6) Publish guard: changing status of campaigns/games/missions needs campaigns.publish
create or replace function public.enforce_publish_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and public.is_staff()
     and (tg_op = 'INSERT' and new.status not in ('draft')
          or tg_op = 'UPDATE' and new.status is distinct from old.status)
     and not public.has_permission('campaigns.publish') then
    raise exception 'Permission campaigns.publish is required to change the status of %', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['campaigns','games','missions','checkin_programs','leaderboards'] loop
    execute format('drop trigger if exists enforce_publish_permission on public.%I', t);
    execute format('create trigger enforce_publish_permission before insert or update of status on public.%I
                    for each row execute function public.enforce_publish_permission()', t);
  end loop;
end $$;

-- 7) Lock down internal functions (Postgres grants EXECUTE to PUBLIC by default) --
do $$ begin
  revoke execute on function public.secure_random_int(int) from public, anon, authenticated;
  revoke execute on function public.assert_game_weights(uuid) from public, anon, authenticated;
  revoke execute on function public.gen_public_ref(text) from anon, authenticated;
exception when undefined_object then null; end $$;
