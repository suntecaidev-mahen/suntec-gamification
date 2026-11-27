-- =============================================================================
-- 0014 · Gamification ENGINE (Phase 2)
--
-- All business rules that move value live here, in single database transactions:
-- outcome draws (secure RNG), reward allocation with inventory locks, Play Points
-- and attempt ledgers, check-in streaks, mission progress, badges, leaderboards,
-- notifications, outbox, idempotency, rate limits, inbound events, QR scans.
--
-- Security model
--   * Engine functions are SECURITY DEFINER with search_path = '' and are executable
--     by service_role ONLY (the Next.js API resolves the caller first, then calls them).
--   * admin_* functions are executable by `authenticated` and check has_permission()
--     themselves; they write audit_log entries.
--   * Errors are raised as P0001 with a machine-readable code in HINT
--     (e.g. LIMIT_REACHED, NO_ATTEMPTS) that the API maps to HTTP status codes.
-- Safe to re-run (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Errors & small helpers
-- -----------------------------------------------------------------------------
create or replace function public.app_error(p_code text, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using message = p_message, hint = p_code, errcode = 'P0001';
end;
$$;

create or replace function public._mask_name(p_first text, p_last text)
returns text language sql immutable set search_path = '' as $$
  select upper(coalesce(left(nullif(trim(p_first), ''), 1), '?')) || '***'
         || coalesce(' ' || upper(left(nullif(trim(p_last), ''), 1)) || '.', '');
$$;

create or replace function public._mask_email(p_email text)
returns text language sql immutable set search_path = '' as $$
  select case when p_email is null or position('@' in p_email) = 0 then null
              else left(p_email, 2) || '***' || substr(p_email, position('@' in p_email)) end;
$$;

create or replace function public._mask_tail(p_value text, p_keep int default 4)
returns text language sql immutable set search_path = '' as $$
  select case when p_value is null then null
              when length(p_value) <= p_keep then repeat('*', length(p_value))
              else repeat('*', length(p_value) - p_keep) || right(p_value, p_keep) end;
$$;

create or replace function public._assert_member_active(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.member_status;
begin
  select m.status into v_status from public.members m where m.id = p_member;
  if not found or v_status = 'anonymised' then
    perform public.app_error('NOT_FOUND', 'Member not found');
  end if;
  if v_status = 'blocked' then
    perform public.app_error('MEMBER_BLOCKED', 'Your Play & Win access is suspended. Please contact Suntec+ Customer Service.');
  end if;
  insert into public.member_profiles (member_id) values (p_member) on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Members: create/refresh the gamification record from Suntec+/Capillary data
-- p_profile: {"card_no","first_name","last_name","email","mobile","tier","tags":[…],"joined_at"}
-- -----------------------------------------------------------------------------
create or replace function public.ensure_member(p_suntec_member_id text, p_profile jsonb default '{}', p_auth_user_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_p jsonb := coalesce(p_profile, '{}'::jsonb);
begin
  if coalesce(trim(p_suntec_member_id), '') = '' then
    perform public.app_error('INVALID', 'suntec_member_id is required');
  end if;
  insert into public.members as m (suntec_member_id, card_no, first_name, last_name, email, mobile, tier, tags,
                                   joined_at, auth_user_id, profile_synced_at)
  values (p_suntec_member_id, nullif(v_p->>'card_no', ''), nullif(v_p->>'first_name', ''), nullif(v_p->>'last_name', ''),
          nullif(v_p->>'email', ''), nullif(v_p->>'mobile', ''), coalesce(nullif(v_p->>'tier', ''), 'member'),
          coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_p->'tags') = 'array' then v_p->'tags' else '[]'::jsonb end)), '{}'),
          nullif(v_p->>'joined_at', '')::timestamptz, p_auth_user_id, case when v_p = '{}'::jsonb then null else now() end)
  on conflict (suntec_member_id) do update set
    card_no      = coalesce(excluded.card_no, m.card_no),
    first_name   = coalesce(excluded.first_name, m.first_name),
    last_name    = coalesce(excluded.last_name, m.last_name),
    email        = coalesce(excluded.email, m.email),
    mobile       = coalesce(excluded.mobile, m.mobile),
    tier         = case when v_p ? 'tier' then excluded.tier else m.tier end,
    tags         = case when v_p ? 'tags' then excluded.tags else m.tags end,
    joined_at    = coalesce(excluded.joined_at, m.joined_at),
    auth_user_id = coalesce(m.auth_user_id, excluded.auth_user_id),
    profile_synced_at = coalesce(excluded.profile_synced_at, m.profile_synced_at)
  returning m.id into v_id;
  insert into public.member_profiles (member_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rules engine (segments & eligibility). Grammar (validated by Zod in packages/core):
--   {"all":[cond…], "any":[cond…], "segments_any":["<segment uuid>"]}
--   cond = {"field":"tier","op":"in","value":["gold","platinum"]}
--   ops: eq neq in nin gt gte lt lte contains exists
-- -----------------------------------------------------------------------------
create or replace function public.member_attrs(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(to_jsonb(p), '{}'::jsonb) - 'member_id' - 'lb_nickname'
         || jsonb_build_object(
              'tier', m.tier,
              'tags', to_jsonb(m.tags),
              'status', m.status::text,
              'joined_days', case when m.joined_at is null then null
                                  else floor(extract(epoch from now() - m.joined_at) / 86400)::int end,
              'checkin_streak', coalesce((select max(s.current) from public.member_streaks s where s.member_id = m.id), 0),
              'best_streak', coalesce((select max(s.best) from public.member_streaks s where s.member_id = m.id), 0))
  from public.members m
  left join public.member_profiles p on p.member_id = m.id
  where m.id = p_member;
$$;

create or replace function public.rule_cond(p_attrs jsonb, p_cond jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := p_attrs -> (p_cond ->> 'field');
  v_op text := coalesce(p_cond ->> 'op', 'eq');
  v_val jsonb := p_cond -> 'value';
  n numeric;
  t numeric;
  hit boolean;
begin
  if v_op in ('gte', 'lte', 'gt', 'lt') then
    if v is null or jsonb_typeof(v) = 'null' or v_val is null then return false; end if;
    begin
      n := (v #>> '{}')::numeric;
      t := (v_val #>> '{}')::numeric;
    exception when others then
      return false;
    end;
    return case v_op when 'gte' then n >= t when 'lte' then n <= t when 'gt' then n > t else n < t end;
  elsif v_op = 'eq' then
    return v is not null and v = v_val;
  elsif v_op = 'neq' then
    return v is null or v <> v_val;
  elsif v_op in ('in', 'nin') then
    if v is null or v_val is null or jsonb_typeof(v_val) <> 'array' then
      hit := false;
    elsif jsonb_typeof(v) = 'array' then
      hit := exists (select 1 from jsonb_array_elements(v) e where v_val @> jsonb_build_array(e));
    else
      hit := v_val @> jsonb_build_array(v);
    end if;
    return case when v_op = 'in' then hit else not hit end;
  elsif v_op = 'contains' then
    return v is not null and jsonb_typeof(v) = 'array' and v @> jsonb_build_array(v_val);
  elsif v_op = 'exists' then
    return v is not null and jsonb_typeof(v) <> 'null';
  end if;
  return false;
end;
$$;

create or replace function public.rules_match(p_attrs jsonb, p_rules jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c jsonb;
  any_ok boolean;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return true; end if;
  for c in select value from jsonb_array_elements(case when jsonb_typeof(p_rules->'all') = 'array' then p_rules->'all' else '[]'::jsonb end) loop
    if not public.rule_cond(p_attrs, c) then return false; end if;
  end loop;
  if jsonb_typeof(p_rules->'any') = 'array' and jsonb_array_length(p_rules->'any') > 0 then
    select bool_or(public.rule_cond(p_attrs, value)) into any_ok from jsonb_array_elements(p_rules->'any');
    if not coalesce(any_ok, false) then return false; end if;
  end if;
  return true;
end;
$$;

create or replace function public.member_eligible(p_member uuid, p_rule uuid, p_campaign uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  a jsonb;
  r jsonb;
begin
  a := public.member_attrs(p_member);
  if a is null then return false; end if;
  if p_rule is not null then
    select er.rules into r from public.eligibility_rules er where er.id = p_rule;
    if r is not null then
      if not public.rules_match(a, r) then return false; end if;
      if jsonb_typeof(r->'segments_any') = 'array' and jsonb_array_length(r->'segments_any') > 0 and not exists (
           select 1 from public.segments s
           where s.id::text in (select jsonb_array_elements_text(r->'segments_any'))
             and s.status = 'active' and public.rules_match(a, s.rules)) then
        return false;
      end if;
    end if;
  end if;
  if p_campaign is not null
     and exists (select 1 from public.campaign_segments cs where cs.campaign_id = p_campaign)
     and not exists (select 1 from public.campaign_segments cs join public.segments s on s.id = cs.segment_id
                     where cs.campaign_id = p_campaign and s.status = 'active' and public.rules_match(a, s.rules)) then
    return false;
  end if;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform: rate limiting, idempotency, fraud signals
-- -----------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits as rl (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'remaining', greatest(p_limit - v_count, 0),
                            'reset_at', v_start + make_interval(secs => p_window_seconds), 'limit', p_limit);
end;
$$;

-- Begin an idempotent request. Returns {"state":"new"|"replay"|"mismatch"|"in_progress", …}.
create or replace function public.idem_begin(p_scope text, p_key text, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.idempotency_keys;
  v_n int;
begin
  insert into public.idempotency_keys (scope, key, request_hash) values (p_scope, p_key, p_hash) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then return jsonb_build_object('state', 'new'); end if;
  select * into k from public.idempotency_keys where scope = p_scope and key = p_key for update;
  if k.request_hash <> p_hash then return jsonb_build_object('state', 'mismatch'); end if;
  if k.state = 'completed' then
    return jsonb_build_object('state', 'replay', 'status', k.response_status, 'response', k.response);
  end if;
  if k.created_at < now() - interval '60 seconds' then   -- stale in-flight request (crashed): take over
    update public.idempotency_keys set created_at = now() where scope = p_scope and key = p_key;
    return jsonb_build_object('state', 'new');
  end if;
  return jsonb_build_object('state', 'in_progress');
end;
$$;

create or replace function public.idem_complete(p_scope text, p_key text, p_status int, p_response jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.idempotency_keys set state = 'completed', response_status = p_status, response = p_response
  where scope = p_scope and key = p_key;
$$;

create or replace function public.idem_abort(p_scope text, p_key text)
returns void language sql security definer set search_path = '' as $$
  delete from public.idempotency_keys where scope = p_scope and key = p_key and state = 'in_progress';
$$;

create or replace function public.fraud_record(p_member uuid, p_kind text, p_severity public.fraud_severity,
  p_details jsonb default '{}', p_device text default null, p_ip text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_auto boolean;
begin
  -- one open signal per member and kind per hour
  if exists (select 1 from public.fraud_signals f where f.member_id is not distinct from p_member and f.kind = p_kind
             and f.resolved_at is null and f.created_at > now() - interval '1 hour') then
    return null;
  end if;
  insert into public.fraud_signals (member_id, kind, severity, details, device_hash, ip_hash)
  values (p_member, p_kind, p_severity, coalesce(p_details, '{}'), p_device, p_ip) returning id into v_id;
  if p_severity = 'high' and p_member is not null then
    select s.auto_flag_on_high_severity into v_auto from public.app_settings s where s.id;
    if coalesce(v_auto, true) then
      update public.members set status = 'flagged', status_reason = 'Auto-flagged: ' || p_kind
      where id = p_member and status = 'active';
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications: render template, write inbox, queue push (quiet hours, daily cap)
-- -----------------------------------------------------------------------------
create or replace function public.notify(p_member uuid, p_key text, p_vars jsonb default '{}', p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.notification_templates;
  v_vars jsonb;
  v_title text;
  v_body text;
  v_link text;
  kv record;
  v_id uuid;
  v_push boolean;
  v_tz text := public.app_tz();
  v_day date := public.business_day();
  v_local time;
  v_next timestamptz := now();
  v_cap int;
  v_sent int;
  v_suntec text;
begin
  select * into t from public.notification_templates nt
  where nt.key = p_key and nt.status = 'active' order by (nt.locale = 'en') desc limit 1;
  if not found then return null; end if;

  select jsonb_build_object('first_name', coalesce(m.first_name, 'there')), m.suntec_member_id
    into v_vars, v_suntec from public.members m where m.id = p_member;
  v_vars := coalesce(v_vars, '{}'::jsonb) || coalesce(p_vars, '{}'::jsonb);
  v_title := t.title; v_body := t.body; v_link := t.deep_link;
  for kv in select key, value from jsonb_each_text(v_vars) loop
    v_title := replace(v_title, '{{' || kv.key || '}}', coalesce(kv.value, ''));
    v_body  := replace(v_body,  '{{' || kv.key || '}}', coalesce(kv.value, ''));
    v_link  := replace(v_link,  '{{' || kv.key || '}}', coalesce(kv.value, ''));
  end loop;

  insert into public.notifications (member_id, template_key, title, body, deep_link, data, dedupe_key)
  values (p_member, p_key, v_title, v_body, v_link, coalesce(p_vars, '{}'), p_dedupe)
  on conflict (member_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  if 'push' = any (t.channels) then
    select p.notify_push into v_push from public.member_profiles p where p.member_id = p_member;
    if coalesce(v_push, true) then
      select s.push_daily_cap into v_cap from public.app_settings s where s.id;
      select count(*) into v_sent from public.notification_dispatches d join public.notifications n on n.id = d.notification_id
      where n.member_id = p_member and d.channel = 'push' and d.status in ('pending', 'sent')
        and d.created_at >= (v_day::timestamp at time zone v_tz);
      if v_sent >= coalesce(v_cap, 3) then
        insert into public.notification_dispatches (notification_id, channel, status, last_error)
        values (v_id, 'push', 'skipped', 'daily push cap reached');
      else
        if t.quiet_hours_start is not null and t.quiet_hours_end is not null then
          v_local := (now() at time zone v_tz)::time;
          if t.quiet_hours_start > t.quiet_hours_end then          -- overnight window, e.g. 22:00–08:00
            if v_local >= t.quiet_hours_start then
              v_next := ((v_day + 1)::timestamp + t.quiet_hours_end) at time zone v_tz;
            elsif v_local < t.quiet_hours_end then
              v_next := (v_day::timestamp + t.quiet_hours_end) at time zone v_tz;
            end if;
          elsif v_local >= t.quiet_hours_start and v_local < t.quiet_hours_end then
            v_next := (v_day::timestamp + t.quiet_hours_end) at time zone v_tz;
          end if;
        end if;
        insert into public.notification_dispatches (notification_id, channel) values (v_id, 'push');
        insert into public.outbox (kind, aggregate_type, aggregate_id, payload, next_attempt_at)
        values ('push.send', 'notification', v_id,
                jsonb_build_object('suntec_member_id', v_suntec, 'title', v_title, 'body', v_body, 'deep_link', v_link), v_next);
      end if;
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ledgers: Play Points and earned attempts (row-locked running balances)
-- -----------------------------------------------------------------------------
create or replace function public.lb_add(p_member uuid, p_metric public.leaderboard_metric, p_amount bigint, p_game uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b record;
  per text;
begin
  if p_amount is null or p_amount = 0 then return; end if;
  for b in select l.id, l.periods from public.leaderboards l
           where l.status = 'active' and l.metric = p_metric and (l.game_id is null or l.game_id = p_game)
             and (l.starts_at is null or l.starts_at <= now()) and (l.ends_at is null or l.ends_at > now()) loop
    foreach per in array b.periods::text[] loop
      insert into public.leaderboard_scores as s (board_id, period_key, member_id, score, reached_at)
      values (b.id, public.period_key(per, now()), p_member, p_amount, now())
      on conflict (board_id, period_key, member_id) do update set score = s.score + excluded.score, reached_at = now();
    end loop;
  end loop;
end;
$$;

create or replace function public.pp_post(p_member uuid, p_delta int, p_reason public.points_reason, p_ref_type text,
  p_ref_id text, p_idem text, p_note text default null, p_actor uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_bal bigint;
  v_prev bigint;
  v_exp timestamptz;
  v_days int;
  v_counts boolean := p_delta > 0 and p_reason not in ('redeem_refund', 'reversal', 'admin_adjust');
begin
  if coalesce(p_delta, 0) = 0 then
    select pp_balance into v_bal from public.member_profiles where member_id = p_member;
    return coalesce(v_bal, 0);
  end if;
  select l.balance_after into v_prev from public.points_ledger l where l.member_id = p_member and l.idempotency_key = p_idem;
  if found then return v_prev; end if;

  insert into public.member_profiles (member_id) values (p_member) on conflict do nothing;
  select p.pp_balance into v_bal from public.member_profiles p where p.member_id = p_member for update;
  if v_bal + p_delta < 0 then
    perform public.app_error('INSUFFICIENT_PP', 'Not enough Play Points (you have ' || v_bal || ', need ' || (-p_delta) || ')');
  end if;
  v_bal := v_bal + p_delta;
  if p_delta > 0 then
    select s.pp_expiry_days into v_days from public.app_settings s where s.id;
    if v_days is not null then v_exp := now() + make_interval(days => v_days); end if;
  end if;
  insert into public.points_ledger (member_id, delta, balance_after, reason, ref_type, ref_id, expires_at, idempotency_key, note, created_by)
  values (p_member, p_delta, v_bal, p_reason, p_ref_type, p_ref_id, v_exp, p_idem, p_note, p_actor);
  update public.member_profiles
     set pp_balance = v_bal,
         pp_lifetime_earned = pp_lifetime_earned + case when v_counts then p_delta else 0 end
   where member_id = p_member;
  if v_counts then
    perform public.lb_add(p_member, 'play_points_earned', p_delta, null);
  end if;
  return v_bal;
end;
$$;

create or replace function public.attempt_post(p_member uuid, p_game uuid, p_delta int, p_reason public.attempt_reason,
  p_ref_type text, p_ref_id text, p_idem text, p_actor uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_bal int;
  v_prev int;
begin
  select l.balance_after into v_prev from public.attempt_ledger l where l.member_id = p_member and l.idempotency_key = p_idem;
  if found then return v_prev; end if;
  insert into public.attempt_balances (member_id, game_id, balance) values (p_member, p_game, 0) on conflict do nothing;
  select a.balance into v_bal from public.attempt_balances a where a.member_id = p_member and a.game_id = p_game for update;
  if v_bal + p_delta < 0 then
    perform public.app_error('NO_ATTEMPTS', 'No bonus attempts left for this game');
  end if;
  v_bal := v_bal + p_delta;
  insert into public.attempt_ledger (member_id, game_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key, created_by)
  values (p_member, p_game, p_delta, v_bal, p_reason, p_ref_type, p_ref_id, p_idem, p_actor);
  update public.attempt_balances set balance = v_bal where member_id = p_member and game_id = p_game;
  return v_bal;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rewards: availability and allocation (inventory row locks, daily caps, code pools)
-- -----------------------------------------------------------------------------
create or replace function public.reward_txn_view(p_txn uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'ref', t.ref, 'reward_id', t.reward_id, 'name', t.reward_snapshot->>'name',
    'description', t.reward_snapshot->>'description', 'image_path', t.reward_snapshot->>'image_path',
    'terms', t.reward_snapshot->>'terms', 'type', t.reward_type, 'status', t.status, 'quantity', t.quantity,
    'amount', case t.reward_type
                when 'play_points' then (t.reward_snapshot->'value'->>'amount')::bigint * t.quantity
                when 'capillary_points' then (t.reward_snapshot->'value'->>'points')::bigint * t.quantity
                when 'bonus_attempt' then coalesce((t.reward_snapshot->'value'->>'count')::bigint, 1) * t.quantity
              end,
    'source', t.source, 'voucher_code', t.voucher_code, 'claim_token', t.claim_token,
    'pp_cost', t.pp_cost, 'issued_at', t.issued_at, 'expires_at', t.expires_at, 'redeemed_at', t.redeemed_at,
    'created_at', t.created_at)
  from public.reward_transactions t where t.id = p_txn;
$$;

create or replace function public.reward_available(p_reward uuid, p_member uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rewards;
  inv public.reward_inventory;
  v_issued int;
  v_count int;
begin
  select * into r from public.rewards where id = p_reward;
  if not found or r.status <> 'active' or (r.valid_until is not null and r.valid_until < now()) then return false; end if;
  if r.type = 'none' then return true; end if;
  select * into inv from public.reward_inventory where reward_id = p_reward;
  if found then
    if inv.remaining_qty is not null and inv.remaining_qty <= 0 then return false; end if;
    if inv.daily_cap is not null then
      select d.issued into v_issued from public.reward_inventory_daily d where d.reward_id = p_reward and d.day = public.business_day();
      if coalesce(v_issued, 0) >= inv.daily_cap then return false; end if;
    end if;
  end if;
  if (coalesce((r.value->>'source') = 'code_pool', false) or (r.type = 'exclusive_reward' and coalesce(r.value->>'fulfilment', '') = 'code_pool'))
     and not exists (select 1 from public.voucher_code_pool c where c.reward_id = p_reward and c.status = 'available'
                     and (c.expires_at is null or c.expires_at > now())) then
    return false;
  end if;
  if p_member is not null and r.per_member_cap is not null then
    select count(*) into v_count from public.reward_transactions t
    where t.member_id = p_member and t.reward_id = p_reward and t.status not in ('cancelled', 'failed')
      and (r.per_member_period = 'once'
           or public.period_key(r.per_member_period::text, t.created_at) = public.period_key(r.per_member_period::text, now()));
    if v_count >= r.per_member_cap then return false; end if;
  end if;
  return true;
end;
$$;

-- Allocates a reward to a member. Idempotent per (source, source_id, reward).
-- Returns {"ok":true, …transaction} | {"ok":true,"none":true} | {"ok":false,"reason":"out_of_stock"|"member_cap"|"unavailable"}
create or replace function public.allocate_reward(
  p_member uuid, p_reward uuid, p_qty int, p_source public.reward_source, p_source_id text,
  p_campaign uuid default null, p_pp_cost int default 0, p_actor uuid default null, p_game uuid default null,
  p_check_cap boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.rewards;
  inv public.reward_inventory;
  v_existing uuid;
  v_qty int := greatest(coalesce(p_qty, 1), 1);
  v_units int;
  v_day date := public.business_day();
  v_count int;
  v_txn uuid := gen_random_uuid();
  v_ref text;
  v_status public.reward_txn_status := 'issued';
  v_code_id uuid;
  v_code text;
  v_claim text;
  v_expires timestamptz;
  v_amount bigint;
  v_game uuid;
  v_pool boolean;
  v_suntec text;
begin
  select t.id into v_existing from public.reward_transactions t
  where t.source = p_source and t.source_id = p_source_id and t.reward_id = p_reward;
  if v_existing is not null then
    return public.reward_txn_view(v_existing) || jsonb_build_object('ok', true, 'replay', true);
  end if;

  select * into r from public.rewards where id = p_reward;
  if not found or r.status <> 'active' or (r.valid_until is not null and r.valid_until < now()) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  if r.type = 'none' then
    return jsonb_build_object('ok', true, 'none', true, 'name', r.name);
  end if;
  if r.type = 'bonus_attempt' then
    v_game := coalesce(nullif(r.value->>'game_id', '')::uuid, p_game);
    if v_game is null then return jsonb_build_object('ok', false, 'reason', 'unavailable'); end if;
  end if;

  if p_check_cap and r.per_member_cap is not null then
    select count(*) into v_count from public.reward_transactions t
    where t.member_id = p_member and t.reward_id = p_reward and t.status not in ('cancelled', 'failed')
      and (r.per_member_period = 'once'
           or public.period_key(r.per_member_period::text, t.created_at) = public.period_key(r.per_member_period::text, now()));
    if v_count >= r.per_member_cap then
      return jsonb_build_object('ok', false, 'reason', 'member_cap');
    end if;
  end if;

  -- points-like rewards scale their amount by qty and consume one stock unit
  v_units := case when r.type in ('play_points', 'capillary_points', 'bonus_attempt') then 1 else v_qty end;

  v_pool := coalesce((r.value->>'source') = 'code_pool', false)
            or (r.type = 'exclusive_reward' and coalesce(r.value->>'fulfilment', '') = 'code_pool');
  if v_pool then
    select c.id, c.code into v_code_id, v_code from public.voucher_code_pool c
    where c.reward_id = p_reward and c.status = 'available' and (c.expires_at is null or c.expires_at > now())
    order by c.created_at, c.id limit 1
    for update skip locked;
    if v_code_id is null then return jsonb_build_object('ok', false, 'reason', 'out_of_stock'); end if;
  end if;

  select * into inv from public.reward_inventory where reward_id = p_reward for update;
  if found then
    if inv.remaining_qty is not null and inv.remaining_qty < v_units then
      return jsonb_build_object('ok', false, 'reason', 'out_of_stock');
    end if;
    insert into public.reward_inventory_daily (reward_id, day, issued) values (p_reward, v_day, 0) on conflict do nothing;
    select d.issued into v_count from public.reward_inventory_daily d where d.reward_id = p_reward and d.day = v_day for update;
    if inv.daily_cap is not null and v_count + v_units > inv.daily_cap then
      return jsonb_build_object('ok', false, 'reason', 'out_of_stock');
    end if;
    update public.reward_inventory_daily set issued = issued + v_units where reward_id = p_reward and day = v_day;
    if inv.remaining_qty is not null then
      update public.reward_inventory set remaining_qty = remaining_qty - v_units where reward_id = p_reward;
    end if;
  end if;

  if r.validity_days is not null then v_expires := now() + make_interval(days => r.validity_days); end if;
  if r.valid_until is not null then v_expires := least(coalesce(v_expires, r.valid_until), r.valid_until); end if;

  if r.type = 'capillary_points' or (r.type in ('digital_voucher', 'merchant_voucher') and not v_pool) then
    v_status := 'pending';                    -- delivered to Capillary / VMS through the outbox
  end if;
  if r.type in ('promo_gift', 'privilege') or (r.type = 'exclusive_reward' and not v_pool) then
    v_claim := upper(encode(extensions.gen_random_bytes(5), 'hex'));   -- shown as a QR at the concierge
  end if;

  insert into public.reward_transactions (id, member_id, reward_id, reward_type, reward_snapshot, quantity, source, source_id,
    campaign_id, pp_cost, unit_cost_cents, status, voucher_code, claim_token, issued_at, expires_at, created_by)
  values (v_txn, p_member, p_reward, r.type,
          jsonb_build_object('name', r.name, 'description', r.description, 'value', r.value, 'image_path', r.image_path,
                             'terms', r.terms, 'category_id', r.category_id, 'key', r.key),
          v_qty, p_source, p_source_id, coalesce(p_campaign, r.campaign_id), coalesce(p_pp_cost, 0), r.unit_cost_cents * v_units,
          v_status, v_code, v_claim, case when v_status = 'issued' then now() end, v_expires, p_actor)
  returning ref into v_ref;

  if v_pool then
    update public.voucher_code_pool set status = 'assigned', assigned_txn_id = v_txn, assigned_at = now() where id = v_code_id;
  end if;

  if r.type = 'play_points' then
    v_amount := coalesce((r.value->>'amount')::bigint, 0) * v_qty;
    if v_amount > 0 then
      perform public.pp_post(p_member, v_amount::int,
        (case p_source when 'game' then 'game_reward' when 'mission' then 'mission_reward' when 'checkin' then 'checkin'
                       when 'badge' then 'badge_reward' when 'leaderboard' then 'leaderboard_reward' else 'admin_adjust' end)::public.points_reason,
        'reward_transaction', v_txn::text, 'rt:' || v_txn, r.name, p_actor);
    end if;
  elsif r.type = 'bonus_attempt' then
    perform public.attempt_post(p_member, v_game, coalesce((r.value->>'count')::int, 1) * v_qty,
      (case p_source when 'game' then 'game_reward' when 'mission' then 'mission_reward' when 'checkin' then 'checkin_reward'
                     when 'badge' then 'badge_reward' when 'admin' then 'admin_grant' else 'event_grant' end)::public.attempt_reason,
      'reward_transaction', v_txn::text, 'rt:' || v_txn, p_actor);
  elsif v_status = 'pending' then
    select m.suntec_member_id into v_suntec from public.members m where m.id = p_member;
    insert into public.outbox (kind, aggregate_type, aggregate_id, payload)
    values (case when r.type = 'capillary_points' then 'loyalty.award_points' else 'voucher.issue' end,
            'reward_transaction', v_txn,
            jsonb_build_object('suntec_member_id', v_suntec, 'reward_type', r.type,
                               'points', coalesce((r.value->>'points')::bigint, 0) * v_qty,
                               'series_id', r.value->>'series_id', 'reason', p_source::text || ':' || r.key,
                               'transaction_ref', v_ref));
  end if;

  insert into public.domain_events (type, member_id, payload)
  values ('reward.allocated', p_member, jsonb_build_object('transaction_id', v_txn, 'reward_id', p_reward,
                                                           'source', p_source, 'type', r.type));
  if r.type not in ('play_points', 'bonus_attempt') and p_source <> 'game' then
    perform public.notify(p_member, 'reward_allocated', jsonb_build_object('reward_name', r.name, 'transaction_ref', v_ref), 'rt:' || v_txn);
  end if;
  return public.reward_txn_view(v_txn) || jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Leaderboards
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard_rank(p_board uuid, p_key text)
returns table (member_id uuid, score bigint, rnk bigint, display_name text)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.score,
         row_number() over (order by s.score desc, s.reached_at asc) as rnk,
         case when p.lb_display_mode = 'nickname' and p.lb_nickname is not null then p.lb_nickname
              else public._mask_name(m.first_name, m.last_name) end as display_name
  from public.leaderboard_scores s
  join public.members m on m.id = s.member_id
  join public.member_profiles p on p.member_id = s.member_id
  where s.board_id = p_board and s.period_key = p_key
    and m.status = 'active' and not p.lb_opt_out and p.lb_display_mode <> 'hidden'
    and not exists (select 1 from public.leaderboard_exclusions x where x.board_id = p_board and x.member_id = s.member_id);
$$;

create or replace function public.leaderboard_view(p_board uuid, p_period text default null, p_member uuid default null, p_limit int default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.leaderboards;
  v_period text;
  v_key text;
  v_lim int;
  v_entries jsonb;
  v_me jsonb;
begin
  select * into b from public.leaderboards where id = p_board;
  if not found then perform public.app_error('NOT_FOUND', 'Leaderboard not found'); end if;
  v_period := coalesce(p_period, case when 'weekly' = any (b.periods::text[]) then 'weekly' else (b.periods::text[])[1] end);
  if not (v_period = any (b.periods::text[])) then
    perform public.app_error('INVALID', 'Period ' || v_period || ' is not offered by this leaderboard');
  end if;
  v_key := public.period_key(v_period, now());
  v_lim := least(coalesce(p_limit, b.top_n), b.top_n);
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rnk, 'name', x.display_name, 'score', x.score,
                                               'is_me', x.member_id = p_member) order by x.rnk)
                    filter (where x.rnk <= v_lim), '[]'::jsonb),
         (jsonb_agg(jsonb_build_object('rank', x.rnk, 'name', x.display_name, 'score', x.score))
            filter (where x.member_id = p_member)) -> 0
    into v_entries, v_me
  from public.leaderboard_rank(p_board, v_key) x;
  return jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'description', b.description, 'metric', b.metric,
                                'periods', to_jsonb(b.periods), 'prize_rules', b.prize_rules),
    'period', v_period, 'period_key', v_key, 'entries', v_entries, 'me', v_me);
end;
$$;

-- -----------------------------------------------------------------------------
-- Badges
-- -----------------------------------------------------------------------------
create or replace function public.award_badge(p_member uuid, p_badge uuid, p_source text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  b public.badges;
  v_n int;
  e record;
begin
  select * into b from public.badges where id = p_badge;
  if not found then return false; end if;
  insert into public.member_badges (member_id, badge_id, source_event) values (p_member, p_badge, p_source) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  update public.member_profiles set badges_count = badges_count + 1 where member_id = p_member;
  for e in select * from jsonb_array_elements(b.rewards) with ordinality as t(spec, i) loop
    perform public.allocate_reward(p_member, (e.spec->>'reward_id')::uuid, coalesce((e.spec->>'qty')::int, 1), 'badge',
                                   p_member || ':' || p_badge || ':' || e.i, null, 0, null, null, false);
  end loop;
  insert into public.domain_events (type, member_id, payload)
  values ('badge.awarded', p_member, jsonb_build_object('badge_id', p_badge, 'key', b.key));
  perform public.notify(p_member, 'badge_unlocked',
                        jsonb_build_object('badge_name', b.name, 'badge_description', b.description), 'badge:' || p_badge);
  return true;
end;
$$;

create or replace function public.badges_evaluate(p_member uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  a jsonb;
  b record;
  v_n int := 0;
begin
  a := public.member_attrs(p_member);
  if a is null then return 0; end if;
  for b in select bb.id, bb.criteria from public.badges bb
           where bb.status = 'active' and bb.criteria ? 'metric' and bb.criteria->>'metric' <> 'monthly_rank'
             and not exists (select 1 from public.member_badges mb where mb.member_id = p_member and mb.badge_id = bb.id) loop
    if public.rule_cond(a, jsonb_build_object('field', b.criteria->>'metric', 'op', coalesce(b.criteria->>'op', 'gte'),
                                              'value', b.criteria->'value')) then
      if public.award_badge(p_member, b.id, 'auto') then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Missions: progress application (idempotent per source event), enrolment, listing
-- -----------------------------------------------------------------------------
create or replace function public.mission_apply(p_member uuid, p_type public.mission_objective, p_amount numeric,
  p_event text, p_ctx jsonb default '{}', p_only uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.missions;
  p public.mission_progress;
  v_key text;
  v_n int;
  v_prog numeric;
  v_vals text[];
  v_done jsonb := '[]'::jsonb;
  e record;
  v_alloc jsonb;
  v_names text;
  v_ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
begin
  if p_amount is null or p_amount <= 0 then return v_done; end if;
  for m in select * from public.missions mm
           where mm.status = 'active' and (mm.starts_at is null or mm.starts_at <= now()) and (mm.ends_at is null or mm.ends_at > now())
             and ((p_only is not null and mm.id = p_only) or (p_only is null and mm.objective_type = p_type))
           order by mm.priority loop
    if m.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id = m.campaign_id and c.status = 'active') then continue; end if;
    if m.objective ? 'campaign_id' and (v_ctx->>'campaign_id') is distinct from (m.objective->>'campaign_id') then continue; end if;
    if m.objective ? 'game_id' and (v_ctx->>'game_id') is distinct from (m.objective->>'game_id') then continue; end if;
    if coalesce((m.objective->>'participating_only')::boolean, false) and m.objective_type in ('spend_amount', 'distinct_stores')
       and not coalesce((v_ctx->>'participating')::boolean, false) then continue; end if;
    if jsonb_typeof(m.objective->'merchant_ids') = 'array' and jsonb_array_length(m.objective->'merchant_ids') > 0
       and not ((m.objective->'merchant_ids') ? coalesce(v_ctx->>'merchant_id', '')) then continue; end if;
    if m.enrolment_mode = 'opt_in' and not exists (select 1 from public.mission_enrolments en where en.mission_id = m.id and en.member_id = p_member) then continue; end if;
    if m.max_participants is not null and m.completions_count >= m.max_participants then continue; end if;
    if not public.member_eligible(p_member, m.eligibility_rule_id, m.campaign_id) then continue; end if;

    v_key := public.period_key(m.recurrence::text, now());
    insert into public.mission_progress_events (mission_id, source_event_id, member_id, period_key, amount)
    values (m.id, p_event, p_member, v_key, p_amount) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then continue; end if;                       -- this event was already counted

    insert into public.mission_progress (mission_id, member_id, period_key, target)
    values (m.id, p_member, v_key, m.target) on conflict (mission_id, member_id, period_key) do nothing;
    select * into p from public.mission_progress mp where mp.mission_id = m.id and mp.member_id = p_member and mp.period_key = v_key for update;
    if p.completed_at is not null then continue; end if;
    insert into public.mission_enrolments (mission_id, member_id) values (m.id, p_member) on conflict do nothing;

    if m.objective_type = 'distinct_stores' then
      if coalesce(v_ctx->>'merchant_id', '') = '' or (v_ctx->>'merchant_id') = any (p.distinct_values) then continue; end if;
      v_vals := p.distinct_values || (v_ctx->>'merchant_id');
      v_prog := cardinality(v_vals);
    else
      v_vals := p.distinct_values;
      v_prog := p.progress + p_amount;
    end if;

    update public.mission_progress set progress = v_prog, distinct_values = v_vals,
           completed_at = case when v_prog >= m.target then now() end
     where id = p.id;

    if v_prog >= m.target then
      v_names := '';
      for e in select * from jsonb_array_elements(m.rewards) with ordinality as t(spec, i) loop
        v_alloc := public.allocate_reward(p_member, (e.spec->>'reward_id')::uuid, coalesce((e.spec->>'qty')::int, 1), 'mission',
                                          p.id || ':' || e.i, m.campaign_id, 0, null, null, false);
        if coalesce((v_alloc->>'ok')::boolean, false) and not coalesce((v_alloc->>'none')::boolean, false) then
          v_names := v_names || case when v_names = '' then '' else ' + ' end || (v_alloc->>'name');
        end if;
      end loop;
      update public.mission_progress set rewarded_at = now() where id = p.id;
      update public.missions set completions_count = completions_count + 1 where id = m.id;
      update public.member_profiles set missions_completed = missions_completed + 1, last_active_at = now() where member_id = p_member;
      insert into public.domain_events (type, member_id, payload)
      values ('mission.completed', p_member, jsonb_build_object('mission_id', m.id, 'progress_id', p.id, 'period_key', v_key));
      perform public.notify(p_member, 'mission_completed',
        jsonb_build_object('mission_title', m.title, 'mission_id', m.id, 'reward_name', coalesce(nullif(v_names, ''), 'a reward')),
        'mp:' || p.id);
      perform public.lb_add(p_member, 'missions_completed', 1, null);
      v_done := v_done || jsonb_build_array(jsonb_build_object('mission_id', m.id, 'title', m.title, 'rewards', v_names));
      if m.objective_type <> 'activity_count' then
        v_done := v_done || public.mission_apply(p_member, 'activity_count', 1, 'mp:' || p.id, '{}'::jsonb, null);
      end if;
    end if;
  end loop;
  return v_done;
end;
$$;

-- Records a mall visit once per member per day and applies visit/activity missions.
create or replace function public._visit(p_member uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event text := 'visit:' || p_member || ':' || p_day;
begin
  if not exists (select 1 from public.domain_events d where d.member_id = p_member and d.type = 'visit.recorded'
                 and d.payload->>'day' = p_day::text) then
    insert into public.domain_events (type, member_id, payload) values ('visit.recorded', p_member, jsonb_build_object('day', p_day));
    update public.member_profiles set visits_count = visits_count + 1, last_active_at = now() where member_id = p_member;
  end if;
  return public.mission_apply(p_member, 'visit_count', 1, v_event, '{}'::jsonb, null)
      || public.mission_apply(p_member, 'activity_count', 1, v_event, '{}'::jsonb, null);
end;
$$;

create or replace function public.missions_for_member(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.item order by (x.item->>'completed')::boolean, (x.item->>'priority')::int), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', m.id, 'title', m.title, 'description', m.description, 'how_to', m.how_to, 'category', m.category,
      'icon', m.icon, 'banner_path', m.banner_path, 'objective_type', m.objective_type, 'target', m.target,
      'recurrence', m.recurrence, 'enrolment_mode', m.enrolment_mode, 'priority', m.priority,
      'enrolled', m.enrolment_mode = 'auto'
                  or exists (select 1 from public.mission_enrolments en where en.mission_id = m.id and en.member_id = p_member),
      'progress', coalesce(p.progress, 0), 'completed', p.completed_at is not null, 'completed_at', p.completed_at,
      'period_key', public.period_key(m.recurrence::text, now()), 'ends_at', coalesce(m.ends_at, c.ends_at),
      'campaign_name', c.name,
      'rewards', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'type', r.type, 'qty', coalesce((e->>'qty')::int, 1))), '[]'::jsonb)
                  from jsonb_array_elements(m.rewards) e join public.rewards r on r.id = (e->>'reward_id')::uuid)) as item
    from public.missions m
    left join public.campaigns c on c.id = m.campaign_id
    left join public.mission_progress p on p.mission_id = m.id and p.member_id = p_member
                                        and p.period_key = public.period_key(m.recurrence::text, now())
    where m.status = 'active' and (m.starts_at is null or m.starts_at <= now()) and (m.ends_at is null or m.ends_at > now())
      and (m.campaign_id is null or c.status = 'active')
      and public.member_eligible(p_member, m.eligibility_rule_id, m.campaign_id)
  ) x;
$$;

create or replace function public.mission_enrol(p_member uuid, p_mission uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.missions;
begin
  perform public._assert_member_active(p_member);
  select * into m from public.missions where id = p_mission;
  if not found or m.status <> 'active' or (m.ends_at is not null and m.ends_at <= now()) then
    perform public.app_error('NOT_FOUND', 'Mission not found or not running');
  end if;
  if not public.member_eligible(p_member, m.eligibility_rule_id, m.campaign_id) then
    perform public.app_error('NOT_ELIGIBLE', 'You are not eligible for this mission');
  end if;
  if m.max_participants is not null and m.completions_count >= m.max_participants then
    perform public.app_error('LIMIT_REACHED', 'This mission is full');
  end if;
  insert into public.mission_enrolments (mission_id, member_id) values (p_mission, p_member) on conflict do nothing;
  return jsonb_build_object('mission_id', p_mission, 'enrolled', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Games: draw, start, quiz submit, views
-- -----------------------------------------------------------------------------
create or replace function public._outcome_available(p_outcome uuid, p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select o.reward_id is null or public.reward_available(o.reward_id, p_member)
                   from public.game_outcomes o where o.id = p_outcome), false);
$$;

-- Weighted draw with pgcrypto rejection-sampled RNG, then the out-of-stock fallback strategy.
create or replace function public.draw_outcome(p_game uuid, p_member uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_roll int;
  v_drawn uuid;
  v_final uuid;
  v_strategy public.fallback_strategy;
  v_fb uuid;
  v_total int;
  v_roll2 int;
  v_note text;
  v_no_reward boolean := false;
begin
  v_roll := public.secure_random_int(10000);
  select x.id into v_drawn from (
    select o.id, o.position, sum(o.weight_bp) over (order by o.position) as cum
    from public.game_outcomes o where o.game_id = p_game and o.weight_bp > 0) x
  where x.cum > v_roll order by x.position limit 1;
  if v_drawn is null then perform public.app_error('NOT_ACTIVE', 'This game has no prizes configured'); end if;

  if public._outcome_available(v_drawn, p_member) then
    return jsonb_build_object('roll', v_roll, 'drawn_id', v_drawn, 'outcome_id', v_drawn, 'fallback', null, 'no_reward', false);
  end if;

  select o.fallback_strategy, o.fallback_outcome_id into v_strategy, v_fb from public.game_outcomes o where o.id = v_drawn;
  if v_strategy = 'outcome' and v_fb is not null and public._outcome_available(v_fb, p_member) then
    v_final := v_fb; v_note := 'outcome';
  elsif v_strategy = 'renormalize' then
    select coalesce(sum(o.weight_bp), 0) into v_total from public.game_outcomes o
    where o.game_id = p_game and o.weight_bp > 0 and public._outcome_available(o.id, p_member);
    if v_total > 0 then
      v_roll2 := public.secure_random_int(v_total);
      select x.id into v_final from (
        select o.id, o.position, sum(o.weight_bp) over (order by o.position) as cum
        from public.game_outcomes o where o.game_id = p_game and o.weight_bp > 0 and public._outcome_available(o.id, p_member)) x
      where x.cum > v_roll2 order by x.position limit 1;
      v_note := 'renormalize';
    end if;
  end if;
  if v_final is null then
    select o.id into v_final from public.game_outcomes o where o.game_id = p_game and o.reward_id is null order by o.position limit 1;
    v_note := 'none';
    if v_final is null then v_final := v_drawn; v_no_reward := true; end if;
  end if;
  return jsonb_build_object('roll', v_roll, 'drawn_id', v_drawn, 'outcome_id', v_final, 'fallback', v_note, 'no_reward', v_no_reward);
end;
$$;

create or replace function public.game_session_view(p_session uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'ref', s.ref, 'game_id', s.game_id, 'game_type', s.game_type, 'game_name', g.name, 'status', s.status,
    'payment_source', s.payment_source, 'pp_cost', s.pp_cost, 'outcome', s.outcome, 'score', s.score,
    'correct_count', s.correct_count, 'question_count', s.question_count,
    'started_at', s.started_at, 'expires_at', s.expires_at, 'completed_at', s.completed_at,
    'pp_balance', (select p.pp_balance from public.member_profiles p where p.member_id = s.member_id),
    'questions', case when s.status = 'in_progress' and s.question_ids is not null then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', q.id, 'text', q.text, 'image_path', q.image_path, 'category', q.category,
                 'time_limit_s', coalesce(q.time_limit_s, (g.config->>'time_limit_s')::int, 20),
                 'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by o.position)
                             from public.quiz_options o where o.question_id = q.id))
               order by array_position(s.question_ids, q.id)), '[]'::jsonb)
        from public.quiz_questions q where q.id = any (s.question_ids)) end,
    'results', case when s.game_type = 'quiz' and s.status = 'completed' then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'question_id', q.id, 'text', q.text, 'selected_option_id', a.option_id, 'correct', coalesce(a.is_correct, false),
                 'correct_option_id', (select o.id from public.quiz_options o where o.question_id = q.id and o.is_correct limit 1),
                 'correct_option_text', (select o.text from public.quiz_options o where o.question_id = q.id and o.is_correct limit 1),
                 'explanation', q.explanation)
               order by array_position(s.question_ids, q.id)), '[]'::jsonb)
        from public.quiz_questions q
        left join public.game_session_answers a on a.session_id = s.id and a.question_id = q.id
        where q.id = any (s.question_ids)) end)
  from public.game_sessions s join public.games g on g.id = s.game_id
  where s.id = p_session;
$$;

create or replace function public.game_availability(p_member uuid, p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.games;
  ar jsonb;
  v_today date := public.business_day();
  v_plays int;
  v_free int;
  v_last timestamptz;
  v_att int;
  v_pp bigint;
  v_free_left int;
  v_cd int := 0;
  v_reason text;
begin
  select * into g from public.games where id = p_game;
  if not found then return null; end if;
  ar := g.attempt_rules;
  select count(*) filter (where public.business_day(s.started_at) = v_today),
         count(*) filter (where public.business_day(s.started_at) = v_today and s.payment_source = 'free'),
         max(s.started_at)
    into v_plays, v_free, v_last
  from public.game_sessions s where s.member_id = p_member and s.game_id = p_game and s.status <> 'voided';
  select a.balance into v_att from public.attempt_balances a where a.member_id = p_member and a.game_id = p_game;
  select p.pp_balance into v_pp from public.member_profiles p where p.member_id = p_member;
  v_att := coalesce(v_att, 0);
  v_free_left := greatest(coalesce((ar->>'free_per_day')::int, 0) - v_free, 0);
  if v_last is not null and coalesce((ar->>'cooldown_seconds')::int, 0) > 0 then
    v_cd := greatest(0, ceil(extract(epoch from (v_last + make_interval(secs => (ar->>'cooldown_seconds')::int)) - now())))::int;
  end if;
  if (ar->>'max_per_day') is not null and v_plays >= (ar->>'max_per_day')::int then
    v_reason := 'daily_limit';
  elsif v_free_left = 0 and v_att = 0 and ((ar->>'pp_cost') is null or coalesce(v_pp, 0) < (ar->>'pp_cost')::int) then
    v_reason := 'no_attempts';
  elsif v_cd > 0 then
    v_reason := 'cooldown';
  end if;
  return jsonb_build_object('free_left', v_free_left, 'attempts', v_att, 'pp_cost', (ar->>'pp_cost')::int,
    'pp_balance', coalesce(v_pp, 0), 'plays_today', v_plays, 'max_per_day', (ar->>'max_per_day')::int,
    'cooldown_s', v_cd, 'can_play', v_reason is null, 'reason', v_reason);
end;
$$;

-- Customer-safe game definition: display data only, NEVER weights or quiz answers.
create or replace function public.game_public(p_member uuid, p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if not found or g.status not in ('active', 'scheduled') then
    perform public.app_error('NOT_FOUND', 'Game not found');
  end if;
  return jsonb_build_object(
    'id', g.id, 'type', g.type, 'slug', g.slug, 'name', g.name, 'description', g.description, 'banner_path', g.banner_path,
    'rules_text', g.rules_text, 'status', g.status, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
    'campaign', (select jsonb_build_object('id', c.id, 'name', c.name, 'terms', c.terms, 'ends_at', c.ends_at)
                 from public.campaigns c where c.id = g.campaign_id),
    'config', case g.type
      when 'spin_wheel' then jsonb_build_object('spin_duration_ms', coalesce((g.config->>'spin_duration_ms')::int, 4500))
      when 'scratch_card' then jsonb_build_object('reveal_threshold', coalesce((g.config->>'reveal_threshold')::numeric, 0.6))
      else jsonb_build_object(
        'questions_per_session', coalesce((g.config->>'questions_per_session')::int, 5),
        'time_limit_s', coalesce((g.config->>'time_limit_s')::int, 20),
        'pass_percent', coalesce((g.config->>'pass_percent')::int, 60),
        'reward_tiers', (select coalesce(jsonb_agg(jsonb_build_object('min_correct', (t->>'min_correct')::int, 'reward', r.name)
                                                   order by (t->>'min_correct')::int desc), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(g.config->'reward_tiers', '[]'::jsonb)) t
                         join public.rewards r on r.id = (t->>'reward_id')::uuid))
      end,
    'outcomes', (select coalesce(jsonb_agg(jsonb_build_object('position', o.position, 'label', o.label, 'display', o.display)
                                           order by o.position), '[]'::jsonb)
                 from public.game_outcomes o where o.game_id = g.id),
    'availability', case when p_member is not null then public.game_availability(p_member, g.id) end);
end;
$$;

create or replace function public._after_game(p_member uuid, p_game uuid, p_session uuid, p_won boolean, p_score int, p_passed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  v_event text := 'gs:' || p_session;
begin
  select * into g from public.games where id = p_game;
  update public.member_profiles
     set games_played = games_played + 1,
         quiz_wins = quiz_wins + case when coalesce(p_passed, false) then 1 else 0 end,
         last_active_at = now()
   where member_id = p_member;
  insert into public.domain_events (type, member_id, payload)
  values ('game.completed', p_member, jsonb_build_object('session_id', p_session, 'game_id', p_game, 'won', p_won, 'score', p_score));
  perform public.mission_apply(p_member, 'game_plays', 1, v_event, jsonb_build_object('game_id', p_game, 'campaign_id', g.campaign_id), null);
  if g.campaign_id is not null then
    perform public.mission_apply(p_member, 'campaign_participation', 1, v_event, jsonb_build_object('campaign_id', g.campaign_id), null);
  end if;
  perform public.mission_apply(p_member, 'activity_count', 1, v_event, '{}'::jsonb, null);
  if p_score is not null and p_score > 0 then
    perform public.mission_apply(p_member, 'quiz_score', p_score, v_event, jsonb_build_object('game_id', p_game), null);
    perform public.lb_add(p_member, 'quiz_score', p_score, p_game);
  end if;
  perform public.lb_add(p_member, 'activities', 1, null);
  if p_won then
    perform public.notify(p_member, 'game_result',
      jsonb_build_object('reward_name', (select s.outcome->'reward'->>'name' from public.game_sessions s where s.id = p_session),
                         'game_name', g.name), v_event);
  end if;
  perform public.badges_evaluate(p_member);
end;
$$;

-- Starts a play. Weighted games (spin, scratch) are decided and rewarded immediately;
-- quizzes return the questions and are scored by quiz_submit().
-- p_payment: auto | free | attempt | play_points
create or replace function public.game_start(p_member uuid, p_game uuid, p_idem text, p_payment text default 'auto',
  p_device text default null, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  v_type public.game_types;
  c public.campaigns;
  ar jsonb;
  cl jsonb;
  v_sid uuid;
  v_today date := public.business_day();
  v_plays_today int; v_free_today int; v_week int; v_total int; v_last timestamptz;
  v_c_today int; v_c_week int; v_c_total int; v_c_last timestamptz;
  v_recent int;
  v_max_pm int;
  v_max_dev int;
  v_dev_members int;
  v_pay public.payment_source;
  v_cost int := 0;
  v_att int;
  v_ttl int;
  v_draw jsonb;
  o public.game_outcomes;
  v_alloc jsonb;
  v_won boolean := false;
  v_reward jsonb;
  v_qids uuid[];
  v_n int;
  v_tl int;
  v_wait int;
begin
  if p_idem is null or length(p_idem) < 8 or length(p_idem) > 200 then
    perform public.app_error('INVALID', 'Idempotency-Key header must be 8-200 characters');
  end if;
  perform public._assert_member_active(p_member);
  perform 1 from public.member_profiles where member_id = p_member for update;   -- serialise this member's plays

  select s.id into v_sid from public.game_sessions s where s.member_id = p_member and s.idempotency_key = p_idem;
  if v_sid is not null then
    return public.game_session_view(v_sid) || jsonb_build_object('replay', true);
  end if;

  select * into g from public.games where id = p_game;
  if not found then perform public.app_error('NOT_FOUND', 'Game not found'); end if;
  if g.status <> 'active' or (g.starts_at is not null and g.starts_at > now()) or (g.ends_at is not null and g.ends_at <= now()) then
    perform public.app_error('NOT_ACTIVE', 'This game is not available right now');
  end if;
  select * into v_type from public.game_types where key = g.type;
  if not v_type.enabled then perform public.app_error('NOT_ACTIVE', 'This game type is currently disabled'); end if;
  if g.campaign_id is not null then
    select * into c from public.campaigns where id = g.campaign_id;
    if c.status <> 'active' or (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now()) then
      perform public.app_error('NOT_ACTIVE', 'This campaign is not running');
    end if;
    if not public.member_eligible(p_member, c.eligibility_rule_id, c.id) then
      perform public.app_error('NOT_ELIGIBLE', 'This campaign is not available for your membership');
    end if;
  end if;
  if not public.member_eligible(p_member, g.eligibility_rule_id, null) then
    perform public.app_error('NOT_ELIGIBLE', 'This game is not available for your membership');
  end if;

  ar := g.attempt_rules;
  cl := coalesce(c.limits, '{}'::jsonb);

  select count(*) filter (where public.business_day(s.started_at) = v_today),
         count(*) filter (where public.business_day(s.started_at) = v_today and s.payment_source = 'free'),
         count(*) filter (where public.period_key('weekly', s.started_at) = public.period_key('weekly', now())),
         count(*), max(s.started_at)
    into v_plays_today, v_free_today, v_week, v_total, v_last
  from public.game_sessions s where s.member_id = p_member and s.game_id = p_game and s.status <> 'voided';

  if (ar->>'max_per_day') is not null and v_plays_today >= (ar->>'max_per_day')::int then
    perform public.app_error('LIMIT_REACHED', 'You have reached today''s limit for this game. Come back tomorrow!');
  end if;
  if (ar->>'max_per_week') is not null and v_week >= (ar->>'max_per_week')::int then
    perform public.app_error('LIMIT_REACHED', 'You have reached this week''s limit for this game');
  end if;
  if (ar->>'max_per_campaign') is not null and v_total >= (ar->>'max_per_campaign')::int then
    perform public.app_error('LIMIT_REACHED', 'You have reached the maximum number of plays for this game');
  end if;
  if coalesce((ar->>'cooldown_seconds')::int, 0) > 0 and v_last is not null
     and v_last + make_interval(secs => (ar->>'cooldown_seconds')::int) > now() then
    v_wait := ceil(extract(epoch from (v_last + make_interval(secs => (ar->>'cooldown_seconds')::int)) - now()))::int;
    perform public.app_error('COOLDOWN', 'Please wait ' || v_wait || ' seconds before playing again');
  end if;

  if g.campaign_id is not null and cl <> '{}'::jsonb then
    select count(*) filter (where public.business_day(s.started_at) = v_today),
           count(*) filter (where public.period_key('weekly', s.started_at) = public.period_key('weekly', now())),
           count(*), max(s.started_at)
      into v_c_today, v_c_week, v_c_total, v_c_last
    from public.game_sessions s where s.member_id = p_member and s.campaign_id = g.campaign_id and s.status <> 'voided';
    if (cl->>'per_day') is not null and v_c_today >= (cl->>'per_day')::int then
      perform public.app_error('LIMIT_REACHED', 'You have reached today''s limit for this campaign');
    end if;
    if (cl->>'per_week') is not null and v_c_week >= (cl->>'per_week')::int then
      perform public.app_error('LIMIT_REACHED', 'You have reached this week''s limit for this campaign');
    end if;
    if (cl->>'per_campaign') is not null and v_c_total >= (cl->>'per_campaign')::int then
      perform public.app_error('LIMIT_REACHED', 'You have reached the participation limit for this campaign');
    end if;
    if coalesce((cl->>'cooldown_seconds')::int, 0) > 0 and v_c_last is not null
       and v_c_last + make_interval(secs => (cl->>'cooldown_seconds')::int) > now() then
      v_wait := ceil(extract(epoch from (v_c_last + make_interval(secs => (cl->>'cooldown_seconds')::int)) - now()))::int;
      perform public.app_error('COOLDOWN', 'Please wait ' || v_wait || ' seconds before playing again');
    end if;
  end if;

  -- Velocity (anti-bot). The API records a fraud signal when it sees VELOCITY.
  select s.max_plays_per_minute, s.max_members_per_device into v_max_pm, v_max_dev from public.app_settings s where s.id;
  select count(*) into v_recent from public.game_sessions s where s.member_id = p_member and s.started_at > now() - interval '1 minute';
  if v_recent >= coalesce(v_max_pm, 10) then
    perform public.app_error('VELOCITY', 'You are playing too fast. Please slow down.');
  end if;

  -- Device-sharing signal (non-blocking)
  if p_device is not null then
    insert into public.member_devices as d (member_id, device_hash) values (p_member, p_device)
    on conflict (member_id, device_hash) do update set last_seen = now();
    select count(distinct d.member_id) into v_dev_members from public.member_devices d where d.device_hash = p_device;
    if v_dev_members > coalesce(v_max_dev, 3) then
      perform public.fraud_record(p_member, 'device_sharing', 'medium',
        jsonb_build_object('members_on_device', v_dev_members), p_device, p_ip);
    end if;
  end if;

  -- Payment: free daily attempt → earned attempt → Play Points
  if p_payment not in ('auto', 'free', 'attempt', 'play_points') then
    perform public.app_error('INVALID', 'payment must be auto, free, attempt or play_points');
  end if;
  select a.balance into v_att from public.attempt_balances a where a.member_id = p_member and a.game_id = p_game;
  v_att := coalesce(v_att, 0);
  if p_payment in ('auto', 'free') and v_free_today < coalesce((ar->>'free_per_day')::int, 0) then
    v_pay := 'free';
  elsif p_payment in ('auto', 'attempt') and v_att > 0 then
    v_pay := 'attempt';
  elsif p_payment in ('auto', 'play_points') and (ar->>'pp_cost') is not null then
    v_pay := 'play_points';
    v_cost := (ar->>'pp_cost')::int;
  else
    perform public.app_error('NO_ATTEMPTS', 'No plays left. Earn more from missions and daily check-ins!');
  end if;

  v_sid := gen_random_uuid();
  v_ttl := coalesce((ar->>'session_ttl_seconds')::int, 180);
  insert into public.game_sessions (id, member_id, game_id, campaign_id, game_type, status, payment_source, pp_cost,
                                    idempotency_key, device_hash, ip_hash, expires_at)
  values (v_sid, p_member, p_game, g.campaign_id, g.type, 'in_progress', v_pay, v_cost, p_idem, p_device, p_ip,
          now() + make_interval(secs => v_ttl));
  if v_pay = 'attempt' then
    perform public.attempt_post(p_member, p_game, -1, 'play', 'game_session', v_sid::text, 'gs:' || v_sid);
  elsif v_pay = 'play_points' then
    perform public.pp_post(p_member, -v_cost, 'game_cost', 'game_session', v_sid::text, 'gs:' || v_sid, g.name);
  end if;

  if v_type.weighted then
    v_draw := public.draw_outcome(p_game, p_member);
    select * into o from public.game_outcomes where id = (v_draw->>'outcome_id')::uuid;
    if o.reward_id is not null and not coalesce((v_draw->>'no_reward')::boolean, false) then
      v_alloc := public.allocate_reward(p_member, o.reward_id, o.reward_qty, 'game', v_sid::text, g.campaign_id, 0, null, p_game);
      if coalesce((v_alloc->>'ok')::boolean, false) then
        if not coalesce((v_alloc->>'none')::boolean, false) then
          v_won := true;
          v_reward := v_alloc - 'ok';
        end if;
      else
        -- lost a race for the last unit (or cap): show a "try again" outcome instead
        v_draw := v_draw || jsonb_build_object('race', v_alloc->>'reason');
        select * into o from public.game_outcomes x where x.game_id = p_game and x.reward_id is null order by x.position limit 1;
        if not found then
          select * into o from public.game_outcomes where id = (v_draw->>'outcome_id')::uuid;
        end if;
      end if;
    end if;
    update public.game_sessions
       set status = 'completed', completed_at = now(), outcome_id = o.id, draw = v_draw,
           reward_transaction_id = (v_reward->>'id')::uuid,
           outcome = jsonb_build_object('position', o.position, 'label', case when v_won or o.reward_id is null then o.label else 'Try again' end,
                                        'display', o.display, 'won', v_won, 'reward', v_reward)
     where id = v_sid;
    perform public._after_game(p_member, p_game, v_sid, v_won, null, null);
  else
    v_n := coalesce((g.config->>'questions_per_session')::int, 5);
    v_tl := coalesce((g.config->>'time_limit_s')::int, 20);
    select array_agg(x.id) into v_qids from (
      select q.id from public.quiz_questions q where q.game_id = p_game and q.status = 'active' order by random() limit v_n) x;
    if v_qids is null then perform public.app_error('NOT_ACTIVE', 'This quiz has no questions yet'); end if;
    update public.game_sessions
       set question_ids = v_qids, question_count = cardinality(v_qids),
           expires_at = now() + make_interval(secs => (select coalesce(sum(coalesce(q.time_limit_s, v_tl)), 0)::int
                                                       from public.quiz_questions q where q.id = any (v_qids)) + 30)
     where id = v_sid;
  end if;
  return public.game_session_view(v_sid);
end;
$$;

-- Scores a quiz session server-side (answers checked against quiz_options; timing from the server clock).
-- p_answers: [{"question_id":"…","option_id":"…"}]
create or replace function public.quiz_submit(p_member uuid, p_session uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
  g public.games;
  q record;
  v_opt uuid;
  v_ok boolean;
  v_correct int := 0;
  v_score int := 0;
  v_bonus int := 0;
  v_elapsed numeric;
  v_allowed numeric;
  v_pct numeric;
  v_passed boolean;
  v_tier jsonb;
  v_alloc jsonb;
  v_reward jsonb;
  v_tl int;
begin
  select * into s from public.game_sessions where id = p_session and member_id = p_member for update;
  if not found then perform public.app_error('NOT_FOUND', 'Session not found'); end if;
  if s.game_type <> 'quiz' then perform public.app_error('INVALID', 'Only quiz sessions accept answers'); end if;
  if s.status = 'completed' then return public.game_session_view(p_session) || jsonb_build_object('replay', true); end if;
  if s.status <> 'in_progress' then perform public.app_error('SESSION_EXPIRED', 'This quiz session has expired'); end if;
  if now() > s.expires_at then
    update public.game_sessions set status = 'expired' where id = p_session;
    return public.game_session_view(p_session);
  end if;

  select * into g from public.games where id = s.game_id;
  v_tl := coalesce((g.config->>'time_limit_s')::int, 20);
  for q in select qq.id, qq.points from public.quiz_questions qq where qq.id = any (s.question_ids) loop
    v_opt := null;
    select (a->>'option_id')::uuid into v_opt from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    where a->>'question_id' = q.id::text and coalesce(a->>'option_id', '') <> '' limit 1;
    if v_opt is not null and not exists (select 1 from public.quiz_options o where o.id = v_opt and o.question_id = q.id) then
      v_opt := null;
    end if;
    v_ok := v_opt is not null and exists (select 1 from public.quiz_options o where o.id = v_opt and o.is_correct);
    insert into public.game_session_answers (session_id, question_id, option_id, is_correct, points)
    values (p_session, q.id, v_opt, v_ok, case when v_ok then q.points else 0 end) on conflict do nothing;
    if v_ok then
      v_correct := v_correct + 1;
      v_score := v_score + q.points;
    end if;
  end loop;

  v_elapsed := extract(epoch from now() - s.started_at);
  v_allowed := greatest(extract(epoch from s.expires_at - s.started_at) - 30, 1);
  if coalesce((g.config->>'speed_bonus')::boolean, false) and v_correct > 0 then
    v_bonus := floor(v_correct * 20 * greatest(0, 1 - v_elapsed / v_allowed));
    v_score := v_score + v_bonus;
  end if;
  v_pct := case when coalesce(s.question_count, 0) > 0 then v_correct * 100.0 / s.question_count else 0 end;
  v_passed := v_pct >= coalesce((g.config->>'pass_percent')::numeric, 60);
  if v_correct = s.question_count and v_elapsed < s.question_count * 1.5 then
    perform public.fraud_record(p_member, 'quiz_timing', 'low',
      jsonb_build_object('session_id', p_session, 'elapsed_s', round(v_elapsed, 2), 'questions', s.question_count),
      s.device_hash, s.ip_hash);
  end if;

  select e.value into v_tier from jsonb_array_elements(coalesce(g.config->'reward_tiers', '[]'::jsonb)) e
  where (e.value->>'min_correct')::int <= v_correct order by (e.value->>'min_correct')::int desc limit 1;
  if v_tier is not null then
    v_alloc := public.allocate_reward(p_member, (v_tier->>'reward_id')::uuid, coalesce((v_tier->>'qty')::int, 1), 'game',
                                      p_session::text, g.campaign_id, 0, null, g.id);
    if coalesce((v_alloc->>'ok')::boolean, false) and not coalesce((v_alloc->>'none')::boolean, false) then
      v_reward := v_alloc - 'ok';
    end if;
  end if;

  update public.game_sessions
     set status = 'completed', completed_at = now(), score = v_score, correct_count = v_correct,
         reward_transaction_id = (v_reward->>'id')::uuid,
         outcome = jsonb_build_object('passed', v_passed, 'won', v_reward is not null, 'reward', v_reward,
                                      'speed_bonus', v_bonus, 'elapsed_s', round(v_elapsed, 1))
   where id = p_session;
  perform public._after_game(p_member, s.game_id, p_session, v_reward is not null, v_score, v_passed);
  return public.game_session_view(p_session);
end;
$$;

-- -----------------------------------------------------------------------------
-- Daily check-in
-- -----------------------------------------------------------------------------
create or replace function public._default_program()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.checkin_programs p left join public.campaigns c on c.id = p.campaign_id
  where p.status = 'active' and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
    and (p.campaign_id is null or c.status = 'active')
  order by p.campaign_id nulls first, p.created_at limit 1;
$$;

create or replace function public.checkin_status(p_member uuid, p_program uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_pid uuid;
  pr public.checkin_programs;
  st public.member_streaks;
  v_day date := public.business_day();
  v_eff int;
  v_next jsonb;
begin
  v_pid := coalesce(p_program, public._default_program());
  if v_pid is null then return null; end if;
  select * into pr from public.checkin_programs where id = v_pid;
  select * into st from public.member_streaks where member_id = p_member and program_id = v_pid;
  v_eff := case when st.last_day is null then 0
                when v_day - st.last_day <= case when pr.reset_rule = 'grace' then pr.grace_days + 1 else 1 end then st.current
                else 0 end;
  select jsonb_build_object('day', r.streak_day, 'label', r.label, 'days_to_go', r.streak_day - v_eff) into v_next
  from public.checkin_streak_rules r where r.program_id = v_pid and r.streak_day > v_eff order by r.streak_day limit 1;
  return jsonb_build_object(
    'program_id', pr.id, 'name', pr.name, 'description', pr.description,
    'checked_in_today', coalesce(st.last_day = v_day, false), 'streak', v_eff, 'best', coalesce(st.best, 0),
    'next_milestone', v_next, 'qr_multiplier', pr.qr_multiplier,
    'ladder', (select coalesce(jsonb_agg(jsonb_build_object('day', r.streak_day, 'label', r.label, 'repeat_every', r.repeat_every,
                                                            'reached', v_eff >= r.streak_day) order by r.streak_day), '[]'::jsonb)
               from public.checkin_streak_rules r where r.program_id = v_pid),
    'base_rewards', (select coalesce(jsonb_agg(rw.name), '[]'::jsonb) from jsonb_array_elements(pr.base_rewards) e
                     join public.rewards rw on rw.id = (e->>'reward_id')::uuid),
    'recent_days', (select coalesce(jsonb_agg(ci.day order by ci.day), '[]'::jsonb) from public.checkins ci
                    where ci.member_id = p_member and ci.program_id = v_pid and ci.day > v_day - 7));
end;
$$;

create or replace function public.checkin(p_member uuid, p_program uuid default null, p_source public.checkin_source default 'app',
  p_qr uuid default null, p_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pr public.checkin_programs;
  st public.member_streaks;
  v_pid uuid;
  v_day date := public.business_day();
  v_gap int;
  v_cont boolean;
  v_streak int;
  v_cid uuid;
  e record;
  ru record;
  v_rewards jsonb := '[]'::jsonb;
  v_alloc jsonb;
  v_qty int;
  v_rtype public.reward_type;
begin
  perform public._assert_member_active(p_member);
  perform 1 from public.member_profiles where member_id = p_member for update;
  v_pid := coalesce(p_program, public._default_program());
  if v_pid is null then perform public.app_error('NOT_FOUND', 'No check-in programme is running'); end if;
  select * into pr from public.checkin_programs where id = v_pid;
  if not found or pr.status <> 'active' or (pr.starts_at is not null and pr.starts_at > now()) or (pr.ends_at is not null and pr.ends_at <= now()) then
    perform public.app_error('NOT_ACTIVE', 'This check-in programme is not running');
  end if;
  if pr.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id = pr.campaign_id and c.status = 'active') then
    perform public.app_error('NOT_ACTIVE', 'This check-in programme is not running');
  end if;
  if not public.member_eligible(p_member, pr.eligibility_rule_id, pr.campaign_id) then
    perform public.app_error('NOT_ELIGIBLE', 'Check-in is not available for your membership');
  end if;
  if exists (select 1 from public.checkins ci where ci.member_id = p_member and ci.program_id = v_pid and ci.day = v_day) then
    return public.checkin_status(p_member, v_pid) || jsonb_build_object('already', true, 'checked_in', false, 'rewards', '[]'::jsonb);
  end if;

  select * into st from public.member_streaks where member_id = p_member and program_id = v_pid for update;
  v_gap := case when st.last_day is null then null else v_day - st.last_day end;
  v_cont := v_gap is not null and (v_gap = 1 or (pr.reset_rule = 'grace' and v_gap between 1 and pr.grace_days + 1));
  if v_cont and pr.reset_period = 'weekly' and to_char(st.last_day, 'IYYY-IW') <> to_char(v_day, 'IYYY-IW') then v_cont := false; end if;
  if v_cont and pr.reset_period = 'monthly' and to_char(st.last_day, 'YYYY-MM') <> to_char(v_day, 'YYYY-MM') then v_cont := false; end if;
  v_streak := case when v_cont then coalesce(st.current, 0) + 1 else 1 end;

  insert into public.checkins (member_id, program_id, day, streak_after, source, qr_code_id, device_hash)
  values (p_member, v_pid, v_day, v_streak, p_source, p_qr, p_device) returning id into v_cid;
  insert into public.member_streaks as ms (member_id, program_id, current, best, last_day)
  values (p_member, v_pid, v_streak, v_streak, v_day)
  on conflict (member_id, program_id) do update
    set current = excluded.current, best = greatest(ms.best, excluded.current), last_day = excluded.last_day;

  for e in select * from jsonb_array_elements(pr.base_rewards) with ordinality as t(spec, i) loop
    v_qty := coalesce((e.spec->>'qty')::int, 1);
    select r.type into v_rtype from public.rewards r where r.id = (e.spec->>'reward_id')::uuid;
    if p_source = 'qr' and v_rtype = 'play_points' then v_qty := ceil(v_qty * pr.qr_multiplier)::int; end if;
    v_alloc := public.allocate_reward(p_member, (e.spec->>'reward_id')::uuid, v_qty, 'checkin', v_cid || ':b' || e.i,
                                      pr.campaign_id, 0, null, null, false);
    if coalesce((v_alloc->>'ok')::boolean, false) and not coalesce((v_alloc->>'none')::boolean, false) then
      v_rewards := v_rewards || jsonb_build_array((v_alloc - 'ok') || jsonb_build_object('kind', 'daily'));
    end if;
  end loop;

  for ru in select * from public.checkin_streak_rules r
            where r.program_id = v_pid
              and (r.streak_day = v_streak
                   or (r.repeat_every is not null and v_streak > r.streak_day and (v_streak - r.streak_day) % r.repeat_every = 0)) loop
    for e in select * from jsonb_array_elements(ru.rewards) with ordinality as t(spec, i) loop
      v_alloc := public.allocate_reward(p_member, (e.spec->>'reward_id')::uuid, coalesce((e.spec->>'qty')::int, 1), 'checkin',
                                        v_cid || ':s' || ru.streak_day || ':' || e.i, pr.campaign_id, 0, null, null, false);
      if coalesce((v_alloc->>'ok')::boolean, false) and not coalesce((v_alloc->>'none')::boolean, false) then
        v_rewards := v_rewards || jsonb_build_array((v_alloc - 'ok') || jsonb_build_object('kind', 'streak', 'label', ru.label));
      end if;
    end loop;
  end loop;

  update public.member_profiles set checkins_total = checkins_total + 1, last_active_at = now() where member_id = p_member;
  insert into public.domain_events (type, member_id, payload)
  values ('checkin.completed', p_member, jsonb_build_object('checkin_id', v_cid, 'program_id', v_pid, 'streak', v_streak, 'source', p_source));
  perform public.mission_apply(p_member, 'checkin_count', 1, 'ci:' || v_cid, '{}'::jsonb, null);
  perform public.mission_apply(p_member, 'activity_count', 1, 'ci:' || v_cid, '{}'::jsonb, null);
  if p_source = 'qr' then perform public._visit(p_member, v_day); end if;
  perform public.lb_add(p_member, 'checkins', 1, null);
  perform public.lb_add(p_member, 'activities', 1, null);
  perform public.badges_evaluate(p_member);
  return public.checkin_status(p_member, v_pid) || jsonb_build_object('already', false, 'checked_in', true, 'rewards', v_rewards);
end;
$$;

-- -----------------------------------------------------------------------------
-- QR scans (location check-in, mall visit, mission, event)
-- -----------------------------------------------------------------------------
create or replace function public.qr_scan(p_member uuid, p_token text, p_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.qr_codes;
  v_day date := public.business_day();
  v_n int;
  v_recent int;
  v_res jsonb := '{}'::jsonb;
  v_event text;
  v_type public.mission_objective;
begin
  perform public._assert_member_active(p_member);
  perform 1 from public.member_profiles where member_id = p_member for update;
  select * into q from public.qr_codes where token = p_token;
  if not found or q.status <> 'active' or (q.valid_from is not null and q.valid_from > now()) or (q.valid_to is not null and q.valid_to < now()) then
    perform public.app_error('INVALID_QR', 'This QR code is not valid or has expired');
  end if;
  if q.max_scans is not null and q.scans_count >= q.max_scans then
    perform public.app_error('QR_EXHAUSTED', 'This QR code has reached its scan limit');
  end if;
  select count(*) into v_n from public.qr_scans s where s.member_id = p_member and s.qr_code_id = q.id and s.day = v_day;
  if v_n >= q.per_member_daily_limit then
    perform public.app_error('ALREADY_SCANNED', 'You have already scanned this code today. Come back tomorrow!');
  end if;
  select count(*) into v_recent from public.qr_scans s where s.member_id = p_member and s.scanned_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    perform public.fraud_record(p_member, 'qr_burst', 'medium', jsonb_build_object('scans_10m', v_recent), p_device, null);
  end if;

  insert into public.qr_scans (qr_code_id, member_id, day, device_hash) values (q.id, p_member, v_day, p_device);
  update public.qr_codes set scans_count = scans_count + 1 where id = q.id;
  v_event := 'qr:' || q.id || ':' || p_member || ':' || v_day;

  if q.purpose = 'checkin' then
    v_res := jsonb_build_object('checkin', public.checkin(p_member, q.program_id, 'qr', q.id, p_device));
  elsif q.purpose = 'visit' then
    v_res := jsonb_build_object('missions', public._visit(p_member, v_day));
  elsif q.purpose = 'mission' and q.mission_id is not null then
    select m.objective_type into v_type from public.missions m where m.id = q.mission_id;
    v_res := jsonb_build_object('missions', public.mission_apply(p_member, v_type, 1, v_event, '{}'::jsonb, q.mission_id));
  elsif q.purpose = 'event' then
    v_res := jsonb_build_object('missions',
      public._visit(p_member, v_day)
      || case when q.campaign_id is not null
              then public.mission_apply(p_member, 'campaign_participation', 1, v_event, jsonb_build_object('campaign_id', q.campaign_id), null)
              else '[]'::jsonb end
      || case when q.mission_id is not null
              then public.mission_apply(p_member, (select m.objective_type from public.missions m where m.id = q.mission_id), 1, v_event, '{}'::jsonb, q.mission_id)
              else '[]'::jsonb end);
  end if;
  update public.member_profiles set last_active_at = now() where member_id = p_member;
  perform public.badges_evaluate(p_member);
  return jsonb_build_object('purpose', q.purpose, 'label', q.label, 'location', q.location, 'result', v_res);
end;
$$;

-- -----------------------------------------------------------------------------
-- Rewards catalogue redemption with Play Points
-- -----------------------------------------------------------------------------
create or replace function public.reward_redeem(p_member uuid, p_reward uuid, p_idem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.rewards;
  v_alloc jsonb;
  v_existing uuid;
  v_txn uuid;
  v_bal bigint;
begin
  perform public._assert_member_active(p_member);
  perform 1 from public.member_profiles where member_id = p_member for update;
  select t.id into v_existing from public.reward_transactions t where t.member_id = p_member and t.idempotency_key = p_idem;
  if v_existing is not null then
    return public.reward_txn_view(v_existing) || jsonb_build_object('replay', true);
  end if;
  select * into r from public.rewards where id = p_reward;
  if not found or not r.in_catalogue or r.status <> 'active' then
    perform public.app_error('NOT_FOUND', 'Reward not found');
  end if;
  if r.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id = r.campaign_id and c.status = 'active') then
    perform public.app_error('NOT_ACTIVE', 'This reward is no longer available');
  end if;
  if not public.member_eligible(p_member, r.eligibility_rule_id, null) then
    perform public.app_error('NOT_ELIGIBLE', 'This reward is not available for your membership');
  end if;
  select p.pp_balance into v_bal from public.member_profiles p where p.member_id = p_member;
  if v_bal < r.pp_cost then
    perform public.app_error('INSUFFICIENT_PP', 'Not enough Play Points (you have ' || v_bal || ', need ' || r.pp_cost || ')');
  end if;
  v_alloc := public.allocate_reward(p_member, p_reward, 1, 'redeem', p_member || ':' || p_idem, r.campaign_id, r.pp_cost);
  if not coalesce((v_alloc->>'ok')::boolean, false) then
    if v_alloc->>'reason' = 'out_of_stock' then
      perform public.app_error('OUT_OF_STOCK', 'Sorry, this reward is out of stock');
    elsif v_alloc->>'reason' = 'member_cap' then
      perform public.app_error('CAP_REACHED', 'You have reached the redemption limit for this reward');
    else
      perform public.app_error('NOT_ACTIVE', 'This reward is no longer available');
    end if;
  end if;
  v_txn := (v_alloc->>'id')::uuid;
  v_bal := public.pp_post(p_member, -r.pp_cost, 'redeem', 'reward_transaction', v_txn::text, 'redeem:' || v_txn, r.name);
  update public.reward_transactions set idempotency_key = p_idem where id = v_txn;
  return public.reward_txn_view(v_txn) || jsonb_build_object('pp_balance', v_bal);
end;
$$;

-- -----------------------------------------------------------------------------
-- Inbound events from Suntec+ / Capillary / POS (idempotent per source + external id)
-- types: transaction {amount_cents, merchant_code} · mall_visit · voucher_redeemed {voucher_ref|voucher_code}
--        campaign_participation {campaign_id} · activity
-- -----------------------------------------------------------------------------
create or replace function public.ingest_event(p_source text, p_client uuid, p_type text, p_external_id text,
  p_suntec_member_id text, p_occurred_at timestamptz, p_payload jsonb default '{}', p_profile jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid;
  v_mid uuid;
  v_existing public.inbound_events;
  v_effects jsonb := '[]'::jsonb;
  v_amount bigint;
  mer public.merchants;
  v_part boolean := false;
  v_day date;
  v_status public.inbound_event_status := 'processed';
  v_error text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_n int;
begin
  insert into public.inbound_events (source, client_id, type, external_id, suntec_member_id, occurred_at, payload)
  values (p_source, p_client, p_type, p_external_id, p_suntec_member_id, coalesce(p_occurred_at, now()), v_payload)
  on conflict (source, external_id) do nothing
  returning id into v_eid;
  if v_eid is null then
    select * into v_existing from public.inbound_events where source = p_source and external_id = p_external_id;
    return jsonb_build_object('id', v_existing.id, 'duplicate', true, 'status', v_existing.status, 'effects', v_existing.effects);
  end if;

  select m.id into v_mid from public.members m where m.suntec_member_id = p_suntec_member_id;
  if v_mid is null then v_mid := public.ensure_member(p_suntec_member_id, coalesce(p_profile, '{}'::jsonb), null); end if;
  update public.inbound_events set member_id = v_mid where id = v_eid;
  if exists (select 1 from public.members m where m.id = v_mid and m.status in ('blocked', 'anonymised')) then
    update public.inbound_events set status = 'ignored', error = 'member blocked', processed_at = now() where id = v_eid;
    return jsonb_build_object('id', v_eid, 'duplicate', false, 'status', 'ignored', 'effects', '[]'::jsonb);
  end if;

  v_day := public.business_day(coalesce(p_occurred_at, now()));
  if p_type = 'transaction' then
    v_amount := coalesce((v_payload->>'amount_cents')::bigint, 0);
    select * into mer from public.merchants where merchant_code = v_payload->>'merchant_code';
    v_part := coalesce(found and mer.is_participating and mer.status = 'active', false);
    if v_amount > 0 then
      update public.member_profiles set lifetime_spend_cents = lifetime_spend_cents + v_amount, last_active_at = now() where member_id = v_mid;
      if v_part and not exists (select 1 from public.inbound_events ie where ie.member_id = v_mid and ie.type = 'transaction'
                                and ie.payload->>'merchant_code' = mer.merchant_code and ie.id <> v_eid) then
        update public.member_profiles set distinct_stores = distinct_stores + 1 where member_id = v_mid;
      end if;
      v_effects := v_effects
        || public.mission_apply(v_mid, 'spend_amount', v_amount, 'ev:' || v_eid, jsonb_build_object('merchant_id', mer.id, 'participating', v_part), null)
        || public.mission_apply(v_mid, 'distinct_stores', 1, 'ev:' || v_eid, jsonb_build_object('merchant_id', mer.id, 'participating', v_part), null);
    end if;
    v_effects := v_effects || public._visit(v_mid, v_day);
  elsif p_type = 'mall_visit' then
    v_effects := v_effects || public._visit(v_mid, v_day);
  elsif p_type = 'voucher_redeemed' then
    update public.reward_transactions set status = 'redeemed', redeemed_at = coalesce(p_occurred_at, now())
    where member_id = v_mid and status = 'issued'
      and ((v_payload->>'voucher_ref') is not null and external_ref = v_payload->>'voucher_ref'
           or (v_payload->>'voucher_code') is not null and voucher_code = v_payload->>'voucher_code');
    get diagnostics v_n = row_count;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('rewards_marked_redeemed', v_n))
      || public.mission_apply(v_mid, 'voucher_redeemed', 1, 'ev:' || v_eid, '{}'::jsonb, null)
      || public.mission_apply(v_mid, 'activity_count', 1, 'ev:' || v_eid, '{}'::jsonb, null);
  elsif p_type = 'campaign_participation' then
    v_effects := v_effects
      || public.mission_apply(v_mid, 'campaign_participation', 1, 'ev:' || v_eid, jsonb_build_object('campaign_id', v_payload->>'campaign_id'), null)
      || public.mission_apply(v_mid, 'activity_count', 1, 'ev:' || v_eid, '{}'::jsonb, null);
  elsif p_type = 'activity' then
    v_effects := v_effects || public.mission_apply(v_mid, 'activity_count', 1, 'ev:' || v_eid, '{}'::jsonb, null);
  else
    v_status := 'ignored';
    v_error := 'unknown event type ' || p_type;
  end if;

  perform public.badges_evaluate(v_mid);
  update public.inbound_events set status = v_status, error = v_error, effects = v_effects, processed_at = now() where id = v_eid;
  return jsonb_build_object('id', v_eid, 'duplicate', false, 'status', v_status, 'effects', v_effects, 'member_id', v_mid);
end;
$$;

-- -----------------------------------------------------------------------------
-- Member read models (home, summary)
-- -----------------------------------------------------------------------------
create or replace function public.member_summary(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'member', jsonb_build_object('id', m.id, 'suntec_member_id', m.suntec_member_id, 'first_name', m.first_name,
                                 'last_name', m.last_name, 'tier', m.tier, 'status', m.status, 'email', m.email::text),
    'pp_name', (select s.pp_name from public.app_settings s where s.id),
    'pp_balance', p.pp_balance, 'pp_lifetime_earned', p.pp_lifetime_earned,
    'stats', jsonb_build_object('games_played', p.games_played, 'missions_completed', p.missions_completed,
                                'checkins_total', p.checkins_total, 'quiz_wins', p.quiz_wins, 'badges', p.badges_count),
    'unread_notifications', (select count(*) from public.notifications n where n.member_id = m.id and n.read_at is null),
    'active_rewards', (select count(*) from public.reward_transactions t where t.member_id = m.id
                       and t.status in ('issued', 'pending', 'retrying') and t.reward_type not in ('play_points', 'bonus_attempt')),
    'preferences', jsonb_build_object('lb_display_mode', p.lb_display_mode, 'lb_nickname', p.lb_nickname,
                                      'lb_opt_out', p.lb_opt_out, 'notify_push', p.notify_push, 'notify_email', p.notify_email))
  from public.members m join public.member_profiles p on p.member_id = m.id where m.id = p_member;
$$;

create or replace function public.member_home(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'summary', public.member_summary(p_member),
    'checkin', public.checkin_status(p_member, null),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description,
                                                               'banner_path', c.banner_path, 'ends_at', c.ends_at, 'terms', c.terms)
                                            order by c.priority), '[]'::jsonb)
                  from public.campaigns c
                  where c.status = 'active' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
                    and public.member_eligible(p_member, c.eligibility_rule_id, c.id)),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'type', g.type, 'slug', g.slug, 'name', g.name,
                                                           'description', g.description, 'banner_path', g.banner_path,
                                                           'campaign_id', g.campaign_id, 'campaign_name', c.name,
                                                           'ends_at', coalesce(g.ends_at, c.ends_at),
                                                           'availability', public.game_availability(p_member, g.id))
                                        order by g.priority), '[]'::jsonb)
              from public.games g left join public.campaigns c on c.id = g.campaign_id
              where g.status = 'active' and (g.starts_at is null or g.starts_at <= now()) and (g.ends_at is null or g.ends_at > now())
                and (g.campaign_id is null or (c.status = 'active' and (c.starts_at is null or c.starts_at <= now())
                                               and (c.ends_at is null or c.ends_at > now())
                                               and public.member_eligible(p_member, c.eligibility_rule_id, c.id)))
                and public.member_eligible(p_member, g.eligibility_rule_id, null)),
    'missions', public.missions_for_member(p_member));
$$;

-- -----------------------------------------------------------------------------
-- Outbox (Capillary points, VMS vouchers, push) — claimed by the API worker
-- -----------------------------------------------------------------------------
create or replace function public.outbox_claim(p_limit int default 20, p_ids uuid[] default null)
returns setof public.outbox language sql security definer set search_path = '' as $$
  update public.outbox o
     set status = 'processing', attempts = o.attempts + 1, locked_until = now() + interval '2 minutes', updated_at = now()
   where o.id in (select x.id from public.outbox x
                  where ((x.status in ('pending', 'retry') and x.next_attempt_at <= now())
                         or (x.status = 'processing' and x.locked_until < now()))
                    and (p_ids is null or x.id = any (p_ids))
                  order by x.next_attempt_at
                  limit greatest(coalesce(p_limit, 20), 1)
                  for update skip locked)
  returning o.*;
$$;

-- p_result: {"external_ref":"…","code":"…","expires_at":"…"}
create or replace function public.outbox_complete(p_id uuid, p_ok boolean, p_result jsonb default '{}', p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ob public.outbox;
  v_res jsonb := coalesce(p_result, '{}'::jsonb);
  v_backoff int;
begin
  select * into ob from public.outbox where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_ok then
    update public.outbox set status = 'done', last_error = null, locked_until = null where id = p_id;
    if ob.aggregate_type = 'reward_transaction' then
      update public.reward_transactions
         set status = 'issued', issued_at = coalesce(issued_at, now()), external_ref = coalesce(v_res->>'external_ref', external_ref),
             voucher_code = coalesce(v_res->>'code', voucher_code),
             expires_at = coalesce((v_res->>'expires_at')::timestamptz, expires_at),
             attempts = ob.attempts, last_error = null
       where id = ob.aggregate_id and status in ('pending', 'retrying', 'failed');
    elsif ob.aggregate_type = 'notification' then
      update public.notification_dispatches set status = 'sent', sent_at = now(), external_ref = v_res->>'external_ref'
       where notification_id = ob.aggregate_id and channel = 'push';
    end if;
    return jsonb_build_object('ok', true, 'status', 'done');
  end if;

  if ob.attempts >= ob.max_attempts then
    update public.outbox set status = 'dead', last_error = p_error, locked_until = null where id = p_id;
    if ob.aggregate_type = 'reward_transaction' then
      update public.reward_transactions set status = 'failed', last_error = p_error, attempts = ob.attempts where id = ob.aggregate_id;
    elsif ob.aggregate_type = 'notification' then
      update public.notification_dispatches set status = 'failed', last_error = p_error
       where notification_id = ob.aggregate_id and channel = 'push';
    end if;
    return jsonb_build_object('ok', false, 'status', 'dead');
  end if;
  v_backoff := least(power(2, ob.attempts)::int * 30, 21600);     -- 1 min, 2 min, 4 min … capped at 6 h
  update public.outbox set status = 'retry', last_error = p_error, locked_until = null,
         next_attempt_at = now() + make_interval(secs => v_backoff) where id = p_id;
  if ob.aggregate_type = 'reward_transaction' then
    update public.reward_transactions set status = 'retrying', last_error = p_error, attempts = ob.attempts
     where id = ob.aggregate_id and status in ('pending', 'retrying');
  end if;
  return jsonb_build_object('ok', false, 'status', 'retry', 'retry_in_s', v_backoff);
end;
$$;

-- -----------------------------------------------------------------------------
-- Leaderboard period close: snapshot + prizes + Monthly Champion badges
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard_close(p_board uuid, p_period text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.leaderboards;
  v_snap uuid;
  v_entries jsonb;
  pr jsonb;
  rk record;
  e record;
  bd record;
  v_awarded int := 0;
begin
  select * into b from public.leaderboards where id = p_board;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rnk, 'member_id', x.member_id, 'name', x.display_name, 'score', x.score)
                            order by x.rnk), '[]'::jsonb)
    into v_entries from public.leaderboard_rank(p_board, p_key) x where x.rnk <= b.top_n;
  insert into public.leaderboard_snapshots (board_id, period_key, entries) values (p_board, p_key, v_entries)
  on conflict (board_id, period_key) do nothing returning id into v_snap;
  if v_snap is null then return jsonb_build_object('closed', false, 'reason', 'already_closed'); end if;

  for pr in select value from jsonb_array_elements(b.prize_rules) where value->>'period' = p_period loop
    for rk in select x.* from public.leaderboard_rank(p_board, p_key) x
              where x.rnk between coalesce((pr->>'rank_from')::int, 1) and coalesce((pr->>'rank_to')::int, 1) loop
      for e in select * from jsonb_array_elements(coalesce(pr->'rewards', '[]'::jsonb)) with ordinality as t(spec, i) loop
        perform public.allocate_reward(rk.member_id, (e.spec->>'reward_id')::uuid, coalesce((e.spec->>'qty')::int, 1), 'leaderboard',
                                       p_board || ':' || p_key || ':' || rk.rnk || ':' || e.i, b.campaign_id, 0, null, null, false);
      end loop;
      perform public.notify(rk.member_id, 'leaderboard_update', jsonb_build_object('rank', rk.rnk, 'board_name', b.name),
                            'lb:' || p_board || ':' || p_key);
      v_awarded := v_awarded + 1;
    end loop;
  end loop;

  if p_period = 'monthly' then
    for bd in select bb.id, (bb.criteria->>'value')::int as max_rank from public.badges bb
              where bb.status = 'active' and bb.criteria->>'metric' = 'monthly_rank' loop
      for rk in select x.* from public.leaderboard_rank(p_board, p_key) x where x.rnk <= bd.max_rank loop
        perform public.award_badge(rk.member_id, bd.id, 'leaderboard:' || p_board || ':' || p_key);
      end loop;
    end loop;
  end if;
  update public.leaderboard_snapshots set prizes_awarded_at = now() where id = v_snap;
  return jsonb_build_object('closed', true, 'entries', jsonb_array_length(v_entries), 'prize_winners', v_awarded);
end;
$$;

-- -----------------------------------------------------------------------------
-- Scheduled maintenance (called every few minutes by /api/v1/jobs/tick)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := '{}'::jsonb;
  n int;
  b record;
  per text;
  v_key text;
  t record;
  v_closed int := 0;
begin
  update public.game_sessions set status = 'expired' where status = 'in_progress' and expires_at < now();
  get diagnostics n = row_count; v := v || jsonb_build_object('sessions_expired', n);

  update public.reward_transactions set status = 'expired'
   where status = 'issued' and expires_at < now() and reward_type not in ('play_points', 'bonus_attempt', 'capillary_points');
  get diagnostics n = row_count; v := v || jsonb_build_object('rewards_expired', n);

  for t in select rt.id, rt.member_id, rt.ref, rt.reward_snapshot->>'name' as name, rt.expires_at from public.reward_transactions rt
           where rt.status = 'issued' and rt.expires_at between now() and now() + interval '3 days'
             and rt.reward_type not in ('play_points', 'bonus_attempt', 'capillary_points') loop
    perform public.notify(t.member_id, 'reward_expiring',
      jsonb_build_object('reward_name', t.name, 'expires_on', to_char(t.expires_at at time zone public.app_tz(), 'DD Mon YYYY'),
                         'transaction_ref', t.ref), 'exp:' || t.id);
  end loop;

  -- schedule-driven lifecycle
  update public.campaigns set status = 'active', published_at = coalesce(published_at, now())
   where status = 'scheduled' and starts_at is not null and starts_at <= now() and (ends_at is null or ends_at > now());
  update public.campaigns set status = 'ended' where status in ('active', 'paused', 'scheduled') and ends_at is not null and ends_at <= now();
  update public.games g set status = 'active'
   where g.status = 'scheduled' and (g.starts_at is null or g.starts_at <= now()) and (g.ends_at is null or g.ends_at > now())
     and (g.campaign_id is null or exists (select 1 from public.campaigns c where c.id = g.campaign_id and c.status = 'active'));
  update public.games set status = 'ended' where status in ('active', 'paused', 'scheduled') and ends_at is not null and ends_at <= now();
  update public.missions set status = 'active'
   where status = 'scheduled' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now());
  update public.missions set status = 'ended' where status in ('active', 'paused', 'scheduled') and ends_at is not null and ends_at <= now();

  -- close finished leaderboard periods (snapshot + prizes)
  for b in select l.id, l.periods from public.leaderboards l where l.status = 'active' loop
    foreach per in array b.periods::text[] loop
      continue when per = 'overall';
      v_key := public.period_key(per, now() - case per when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end);
      if not exists (select 1 from public.leaderboard_snapshots s where s.board_id = b.id and s.period_key = v_key)
         and exists (select 1 from public.leaderboard_scores sc where sc.board_id = b.id and sc.period_key = v_key) then
        perform public.leaderboard_close(b.id, per, v_key);
        v_closed := v_closed + 1;
      end if;
    end loop;
  end loop;
  v := v || jsonb_build_object('leaderboard_periods_closed', v_closed);

  delete from public.idempotency_keys where expires_at < now();
  delete from public.rate_limits where window_start < now() - interval '2 hours';
  delete from public.session_handoffs where expires_at < now() - interval '1 day';
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- MOCK Capillary wrappers (DEV/SIT). Called by the "mock" LoyaltyAdapter through
-- the service role only. Mirror the idempotent behaviour of the real APIs.
-- -----------------------------------------------------------------------------
create or replace function public.mock_cap_get_member(p_member_id text default null, p_email text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(m) || jsonb_build_object('points_balance', coalesce(a.balance, 0))
  from mock_capillary.members m
  left join mock_capillary.points_accounts a on a.member_id = m.member_id
  where (p_member_id is not null and m.member_id = p_member_id)
     or (p_email is not null and lower(m.email::text) = lower(p_email))
  limit 1;
$$;

create or replace function public.mock_cap_award_points(p_member_id text, p_points bigint, p_idem text, p_reason text default 'gamification')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tx mock_capillary.points_transactions;
  v_bal bigint;
begin
  select * into v_tx from mock_capillary.points_transactions where idempotency_key = p_idem;
  if found then
    select a.balance into v_bal from mock_capillary.points_accounts a where a.member_id = v_tx.member_id;
    return jsonb_build_object('external_ref', v_tx.external_ref, 'balance', v_bal, 'replay', true);
  end if;
  if not exists (select 1 from mock_capillary.members m where m.member_id = p_member_id and m.status = 'active') then
    raise exception using message = 'Member ' || coalesce(p_member_id, 'null') || ' not found in loyalty system',
                          hint = 'UPSTREAM_MEMBER_NOT_FOUND', errcode = 'P0001';
  end if;
  insert into mock_capillary.points_accounts (member_id, balance) values (p_member_id, 0) on conflict do nothing;
  update mock_capillary.points_accounts set balance = balance + p_points, updated_at = now()
   where member_id = p_member_id returning balance into v_bal;
  insert into mock_capillary.points_transactions (member_id, delta, reason, idempotency_key)
  values (p_member_id, p_points, coalesce(p_reason, 'gamification'), p_idem) returning * into v_tx;
  return jsonb_build_object('external_ref', v_tx.external_ref, 'balance', v_bal);
end;
$$;

create or replace function public.mock_cap_issue_coupon(p_member_id text, p_series text, p_idem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c mock_capillary.coupons;
  v_s mock_capillary.coupon_series;
begin
  select * into v_c from mock_capillary.coupons where idempotency_key = p_idem;
  if found then
    return jsonb_build_object('external_ref', v_c.external_ref, 'code', v_c.code, 'expires_at', v_c.expires_at, 'replay', true);
  end if;
  select * into v_s from mock_capillary.coupon_series where series_id = p_series and active;
  if not found then
    raise exception using message = 'Voucher series ' || coalesce(p_series, 'null') || ' not found', hint = 'UPSTREAM_SERIES_NOT_FOUND', errcode = 'P0001';
  end if;
  if not exists (select 1 from mock_capillary.members m where m.member_id = p_member_id and m.status = 'active') then
    raise exception using message = 'Member ' || coalesce(p_member_id, 'null') || ' not found in loyalty system',
                          hint = 'UPSTREAM_MEMBER_NOT_FOUND', errcode = 'P0001';
  end if;
  insert into mock_capillary.coupons (series_id, member_id, code, idempotency_key, expires_at)
  values (p_series, p_member_id, p_series || '-' || upper(encode(extensions.gen_random_bytes(4), 'hex')), p_idem,
          now() + make_interval(days => v_s.validity_days))
  returning * into v_c;
  return jsonb_build_object('external_ref', v_c.external_ref, 'code', v_c.code, 'expires_at', v_c.expires_at);
end;
$$;

-- =============================================================================
-- ADMIN RPCs (role `authenticated`, permission-checked, audited)
-- =============================================================================
create or replace function public._require_perm(p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_perm) then
    perform public.app_error('FORBIDDEN', 'You do not have permission: ' || p_perm);
  end if;
end;
$$;

create or replace function public._audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_reason text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, before, after, reason, request_id)
  values (case when auth.uid() is null then 'system'::public.actor_type else 'staff'::public.actor_type end, auth.uid(),
          p_action, p_entity, p_entity_id, p_before, p_after, p_reason, nullif(current_setting('app.request_id', true), ''));
$$;

create or replace function public.admin_customer_search(p_q text default '', p_limit int default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_pii boolean;
  v_q text := trim(coalesce(p_q, ''));
begin
  perform public._require_perm('customers.read');
  v_pii := public.has_permission('customers.pii');
  return (select coalesce(jsonb_agg(x.item), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', m.id, 'suntec_member_id', m.suntec_member_id,
      'card_no', case when v_pii then m.card_no else public._mask_tail(m.card_no, 4) end,
      'name', case when v_pii then trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) else public._mask_name(m.first_name, m.last_name) end,
      'email', case when v_pii then m.email::text else public._mask_email(m.email::text) end,
      'tier', m.tier, 'status', m.status, 'pp_balance', p.pp_balance, 'last_active_at', p.last_active_at) as item
    from public.members m left join public.member_profiles p on p.member_id = m.id
    where v_q = ''
       or m.suntec_member_id ilike '%' || v_q || '%'
       or m.card_no = v_q
       or (v_pii and (m.email::text ilike v_q || '%'
                      or (coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) ilike '%' || v_q || '%'))
    order by p.last_active_at desc nulls last, m.created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)) x);
end;
$$;

create or replace function public.admin_customer_detail(p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_pii boolean;
begin
  perform public._require_perm('customers.read');
  v_pii := public.has_permission('customers.pii');
  if not exists (select 1 from public.members where id = p_member) then
    perform public.app_error('NOT_FOUND', 'Customer not found');
  end if;
  return jsonb_build_object(
    'pii', v_pii, 'can_act', public.has_permission('customers.act'),
    'member', (select jsonb_build_object('id', m.id, 'suntec_member_id', m.suntec_member_id,
                 'card_no', case when v_pii then m.card_no else public._mask_tail(m.card_no, 4) end,
                 'name', case when v_pii then trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) else public._mask_name(m.first_name, m.last_name) end,
                 'email', case when v_pii then m.email::text else public._mask_email(m.email::text) end,
                 'mobile', case when v_pii then m.mobile else public._mask_tail(m.mobile, 4) end,
                 'tier', m.tier, 'tags', to_jsonb(m.tags), 'status', m.status, 'status_reason', m.status_reason,
                 'joined_at', m.joined_at, 'created_at', m.created_at, 'linked', m.auth_user_id is not null)
               from public.members m where m.id = p_member),
    'profile', (select to_jsonb(p) - 'member_id' from public.member_profiles p where p.member_id = p_member),
    'streaks', (select coalesce(jsonb_agg(jsonb_build_object('program', cp.name, 'current', s.current, 'best', s.best, 'last_day', s.last_day)), '[]'::jsonb)
                from public.member_streaks s join public.checkin_programs cp on cp.id = s.program_id where s.member_id = p_member),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('game_id', a.game_id, 'game', g.name, 'balance', a.balance)), '[]'::jsonb)
                 from public.attempt_balances a join public.games g on g.id = a.game_id where a.member_id = p_member),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ref', s.ref, 'game', g.name, 'type', s.game_type, 'status', s.status,
                   'payment', s.payment_source, 'outcome', s.outcome->>'label', 'won', s.outcome->'won', 'reward', s.outcome->'reward'->>'name',
                   'score', s.score, 'started_at', s.started_at) order by s.started_at desc), '[]'::jsonb)
                 from (select * from public.game_sessions gs where gs.member_id = p_member order by gs.started_at desc limit 30) s
                 join public.games g on g.id = s.game_id),
    'rewards', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'name', t.reward_snapshot->>'name', 'type', t.reward_type,
                  'status', t.status, 'source', t.source, 'external_ref', t.external_ref, 'last_error', t.last_error,
                  'voucher_code', case when v_pii then t.voucher_code else public._mask_tail(t.voucher_code, 3) end,
                  'claim_token', case when v_pii then t.claim_token else null end,
                  'created_at', t.created_at, 'expires_at', t.expires_at) order by t.created_at desc), '[]'::jsonb)
                from (select * from public.reward_transactions rt where rt.member_id = p_member order by rt.created_at desc limit 40) t),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('delta', l.delta, 'balance_after', l.balance_after, 'reason', l.reason,
                 'note', l.note, 'created_at', l.created_at) order by l.created_at desc), '[]'::jsonb)
               from (select * from public.points_ledger pl where pl.member_id = p_member order by pl.created_at desc limit 40) l),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'tier', b.tier, 'awarded_at', mb.awarded_at) order by mb.awarded_at desc), '[]'::jsonb)
               from public.member_badges mb join public.badges b on b.id = mb.badge_id where mb.member_id = p_member),
    'fraud', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'severity', f.severity, 'details', f.details,
                'created_at', f.created_at, 'resolved_at', f.resolved_at) order by f.created_at desc), '[]'::jsonb)
              from public.fraud_signals f where f.member_id = p_member),
    'devices', (select count(*) from public.member_devices d where d.member_id = p_member),
    'checkins', (select coalesce(jsonb_agg(ci.day order by ci.day desc), '[]'::jsonb)
                 from (select c.day from public.checkins c where c.member_id = p_member order by c.day desc limit 30) ci));
end;
$$;

create or replace function public.admin_adjust_pp(p_member uuid, p_delta int, p_reason text, p_idem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bal bigint;
begin
  perform public._require_perm('customers.act');
  if coalesce(p_delta, 0) = 0 or abs(p_delta) > 100000 then perform public.app_error('INVALID', 'Adjustment must be between -100000 and 100000 and not zero'); end if;
  if length(coalesce(trim(p_reason), '')) < 3 then perform public.app_error('INVALID', 'A reason is required'); end if;
  v_bal := public.pp_post(p_member, p_delta, 'admin_adjust', 'admin', auth.uid()::text, 'admin:' || p_idem, p_reason, auth.uid());
  perform public._audit('member.pp_adjust', 'members', p_member::text, null, jsonb_build_object('delta', p_delta, 'balance_after', v_bal), p_reason);
  return jsonb_build_object('pp_balance', v_bal);
end;
$$;

create or replace function public.admin_grant_attempts(p_member uuid, p_game uuid, p_count int, p_reason text, p_idem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bal int;
begin
  perform public._require_perm('customers.act');
  if coalesce(p_count, 0) = 0 or abs(p_count) > 100 then perform public.app_error('INVALID', 'Count must be between -100 and 100 and not zero'); end if;
  if length(coalesce(trim(p_reason), '')) < 3 then perform public.app_error('INVALID', 'A reason is required'); end if;
  v_bal := public.attempt_post(p_member, p_game, p_count, 'admin_grant', 'admin', auth.uid()::text, 'admin:' || p_idem, auth.uid());
  perform public._audit('member.attempts_grant', 'members', p_member::text, null,
                        jsonb_build_object('game_id', p_game, 'count', p_count, 'balance_after', v_bal), p_reason);
  return jsonb_build_object('attempts', v_bal);
end;
$$;

create or replace function public.admin_grant_reward(p_member uuid, p_reward uuid, p_reason text, p_idem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb;
begin
  perform public._require_perm('customers.act');
  if length(coalesce(trim(p_reason), '')) < 3 then perform public.app_error('INVALID', 'A reason is required'); end if;
  v_res := public.allocate_reward(p_member, p_reward, 1, 'admin', 'admin:' || p_idem, null, 0, auth.uid(), null, false);
  if not coalesce((v_res->>'ok')::boolean, false) then
    perform public.app_error('OUT_OF_STOCK', 'Reward could not be allocated: ' || coalesce(v_res->>'reason', 'unavailable'));
  end if;
  perform public._audit('member.reward_grant', 'members', p_member::text, null, v_res, p_reason);
  return v_res;
end;
$$;

create or replace function public.admin_set_member_status(p_member uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform public._require_perm('customers.act');
  if p_status not in ('active', 'flagged', 'blocked') then perform public.app_error('INVALID', 'Status must be active, flagged or blocked'); end if;
  if length(coalesce(trim(p_reason), '')) < 3 then perform public.app_error('INVALID', 'A reason is required'); end if;
  select status::text into v_before from public.members where id = p_member;
  if v_before is null then perform public.app_error('NOT_FOUND', 'Customer not found'); end if;
  update public.members set status = p_status::public.member_status, status_reason = p_reason where id = p_member;
  perform public._audit('member.status', 'members', p_member::text, jsonb_build_object('status', v_before),
                        jsonb_build_object('status', p_status), p_reason);
  return jsonb_build_object('status', p_status);
end;
$$;

create or replace function public.admin_retry_reward(p_txn uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status public.reward_txn_status;
begin
  perform public._require_perm('customers.act');
  select status into v_status from public.reward_transactions where id = p_txn;
  if v_status is null then perform public.app_error('NOT_FOUND', 'Reward transaction not found'); end if;
  if v_status not in ('failed', 'retrying', 'pending') then perform public.app_error('INVALID', 'Only pending or failed rewards can be retried'); end if;
  update public.outbox set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, locked_until = null
   where aggregate_type = 'reward_transaction' and aggregate_id = p_txn;
  update public.reward_transactions set status = 'retrying' where id = p_txn;
  perform public._audit('reward.retry', 'reward_transactions', p_txn::text, jsonb_build_object('status', v_status), jsonb_build_object('status', 'retrying'), null);
  return jsonb_build_object('status', 'retrying');
end;
$$;

create or replace function public.admin_cancel_reward(p_txn uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.reward_transactions;
begin
  perform public._require_perm('customers.act');
  select * into t from public.reward_transactions where id = p_txn for update;
  if not found then perform public.app_error('NOT_FOUND', 'Reward transaction not found'); end if;
  if t.reward_type in ('play_points', 'bonus_attempt') or t.status in ('cancelled', 'redeemed', 'expired') then
    perform public.app_error('INVALID', 'This reward cannot be cancelled (use a Play Points adjustment instead)');
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then perform public.app_error('INVALID', 'A reason is required'); end if;
  update public.reward_transactions set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_txn;
  update public.outbox set status = 'dead', last_error = 'cancelled by staff'
   where aggregate_type = 'reward_transaction' and aggregate_id = p_txn and status in ('pending', 'retry', 'processing');
  update public.voucher_code_pool set status = 'void' where assigned_txn_id = p_txn;
  perform public._audit('reward.cancel', 'reward_transactions', p_txn::text, jsonb_build_object('status', t.status),
                        jsonb_build_object('status', 'cancelled'), p_reason);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- Concierge: mark a gift/privilege as collected by claim token or reference.
create or replace function public.admin_mark_redeemed(p_lookup text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.reward_transactions;
begin
  perform public._require_perm('customers.act');
  select * into t from public.reward_transactions
  where (claim_token = upper(trim(p_lookup)) or ref = upper(trim(p_lookup))) for update;
  if not found then perform public.app_error('NOT_FOUND', 'No reward matches this claim code'); end if;
  if t.status <> 'issued' then perform public.app_error('INVALID', 'Reward is ' || t.status || ', not issued'); end if;
  update public.reward_transactions set status = 'redeemed', redeemed_at = now() where id = t.id;
  perform public._audit('reward.redeemed', 'reward_transactions', t.id::text, jsonb_build_object('status', t.status),
                        jsonb_build_object('status', 'redeemed'), null);
  return public.reward_txn_view(t.id);
end;
$$;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := public.business_day();
  v_start timestamptz;
begin
  if not (public.has_permission('reports.read') or public.has_permission('campaigns.read')) then
    perform public.app_error('FORBIDDEN', 'You do not have permission to view the dashboard');
  end if;
  v_start := v_day::timestamp at time zone public.app_tz();
  return jsonb_build_object(
    'day', v_day,
    'members_total', (select count(*) from public.members),
    'members_active_today', (select count(*) from public.member_profiles p where p.last_active_at >= v_start),
    'plays_today', (select count(*) from public.game_sessions s where s.started_at >= v_start),
    'wins_today', (select count(*) from public.game_sessions s where s.started_at >= v_start and (s.outcome->>'won')::boolean),
    'checkins_today', (select count(*) from public.checkins c where c.day = v_day),
    'missions_completed_today', (select count(*) from public.mission_progress mp where mp.completed_at >= v_start),
    'rewards_issued_today', (select count(*) from public.reward_transactions t where t.created_at >= v_start and t.reward_type not in ('play_points', 'bonus_attempt')),
    'pp_issued_today', (select coalesce(sum(l.delta), 0) from public.points_ledger l where l.created_at >= v_start and l.delta > 0),
    'reward_cost_today_cents', (select coalesce(sum(t.unit_cost_cents), 0) from public.reward_transactions t where t.created_at >= v_start and t.status <> 'cancelled'),
    'active_campaigns', (select count(*) from public.campaigns c where c.status = 'active'),
    'active_games', (select count(*) from public.games g where g.status = 'active'),
    'open_fraud_signals', (select count(*) from public.fraud_signals f where f.resolved_at is null),
    'failed_rewards', (select count(*) from public.reward_transactions t where t.status in ('failed', 'retrying')),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('reward_id', r.id, 'name', r.name, 'remaining', i.remaining_qty, 'threshold', i.low_stock_threshold)), '[]'::jsonb)
                  from public.reward_inventory i join public.rewards r on r.id = i.reward_id
                  where r.status = 'active' and i.remaining_qty is not null and i.remaining_qty <= i.low_stock_threshold),
    'plays_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'plays', d.plays, 'members', d.members) order by d.day), '[]'::jsonb)
                     from (select public.business_day(s.started_at) as day, count(*) as plays, count(distinct s.member_id) as members
                           from public.game_sessions s where s.started_at >= v_start - interval '13 days' group by 1) d),
    'top_rewards_7d', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n) order by x.n desc), '[]'::jsonb)
                       from (select t.reward_snapshot->>'name' as name, count(*) as n from public.reward_transactions t
                             where t.created_at >= v_start - interval '6 days' group by 1 order by 2 desc limit 8) x));
end;
$$;

create or replace function public.admin_leaderboard(p_board uuid, p_period text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('campaigns.read');
  return public.leaderboard_view(p_board, p_period, null, null);
end;
$$;

-- =============================================================================
-- Function privileges: engine = service_role only; admin_* = authenticated (self-checking);
-- RLS helpers stay callable by everyone (policies need them).
-- =============================================================================
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure::text as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    continue when f.proname in ('current_member_id', 'is_staff', 'has_permission', 'my_permissions');
    execute format('revoke execute on function %s from public', f.sig);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
      if f.proname like 'admin\_%' then
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
    exception when undefined_object then null;
    end;
  end loop;
end $$;
