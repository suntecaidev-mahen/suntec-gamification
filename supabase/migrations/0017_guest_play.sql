-- =============================================================================
-- 0017 · One Play & Win experience: guest play, held winnings, claim to Suntec+
--
--   * Anyone can play from the public link as a GUEST (no sign-up). A guest is a
--     `members` row with is_guest = true, identified by a hashed browser token.
--   * A guest's winnings are HELD (reward_transactions.status = 'held', nothing sent
--     to Capillary/VMS) for 30 days under a claim code.
--   * When the guest becomes / signs in as a Suntec+ member, guest_claim() moves the
--     held winnings to the member and delivers them (Capillary points, vouchers…).
--   * Suntec+ points only: the separate "Play Points" currency and the Play Points
--     catalogue are retired (existing Play Points rewards become Suntec+ points).
--
-- Note: the new enum value 'held' is only referenced at run time (plpgsql) or as
-- text (status::text = 'held'), so this file also works inside one transaction.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
alter type public.reward_txn_status add value if not exists 'held' before 'pending';

alter table public.members add column if not exists is_guest boolean not null default false;
alter table public.members add column if not exists guest_token_hash text;
alter table public.members add column if not exists claim_code text;
alter table public.members add column if not exists claim_expires_at timestamptz;
alter table public.members add column if not exists claimed_by uuid references public.members (id) on delete set null;
alter table public.members add column if not exists claimed_at timestamptz;
create unique index if not exists members_guest_token_key on public.members (guest_token_hash) where guest_token_hash is not null;
create unique index if not exists members_claim_code_key on public.members (claim_code) where claim_code is not null;
create index if not exists members_guests_idx on public.members (claim_expires_at) where is_guest;
comment on column public.members.is_guest is 'Guest player from the public link (not a Suntec+ member yet). Winnings are held until claimed.';
comment on column public.members.claim_code is 'Code a guest uses to move held winnings to their Suntec+ account (valid until claim_expires_at).';

-- -----------------------------------------------------------------------------
-- Guests
-- -----------------------------------------------------------------------------
create or replace function public._claim_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';   -- no 0/O, 1/I/L, U
  b bytea := extensions.gen_random_bytes(8);
  r text := '';
  i int;
begin
  for i in 0..7 loop
    r := r || substr(alphabet, (get_byte(b, i) % 30) + 1, 1);
  end loop;
  return r;
end;
$$;

-- Creates (or returns) the guest for a hashed browser token.
create or replace function public.guest_create(p_token_hash text, p_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.members;
  v_code text;
begin
  if coalesce(length(p_token_hash), 0) < 32 then perform public.app_error('INVALID', 'Invalid guest token'); end if;
  select * into g from public.members where guest_token_hash = p_token_hash and is_guest;
  if not found then
    loop
      v_code := public._claim_code();
      exit when not exists (select 1 from public.members where claim_code = v_code);
    end loop;
    insert into public.members (suntec_member_id, is_guest, guest_token_hash, claim_code, claim_expires_at, tier)
    values ('GUEST-' || v_code, true, p_token_hash, v_code, now() + interval '30 days', 'guest')
    returning * into g;
    -- guests have no Suntec+ account → never push
    insert into public.member_profiles (member_id, notify_push, lb_opt_out) values (g.id, false, true) on conflict do nothing;
  end if;
  if p_device is not null then
    insert into public.member_devices as d (member_id, device_hash) values (g.id, p_device)
    on conflict (member_id, device_hash) do update set last_seen = now();
  end if;
  return jsonb_build_object('member_id', g.id, 'claim_code', g.claim_code, 'claim_expires_at', g.claim_expires_at,
                            'claimed', g.claimed_by is not null);
end;
$$;

-- Moves a guest's held winnings to a Suntec+ member and delivers them.
-- Identify the guest by claim code (typed by the customer / sent by the Suntec+ backend)
-- or by guest id (same browser: guest signs in as a member).
create or replace function public.guest_claim(p_member uuid, p_code text default null, p_guest uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.members;
  g public.members;
  t record;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_points bigint := 0;
  v_n int := 0;
  v_days int;
  v_amount bigint;
begin
  select * into m from public.members where id = p_member;
  if not found or m.is_guest then perform public.app_error('INVALID', 'Only Suntec+ members can claim winnings'); end if;
  if m.status = 'blocked' then
    perform public.app_error('MEMBER_BLOCKED', 'Your Play & Win access is suspended. Please contact Suntec+ Customer Service.');
  end if;

  if p_guest is not null then
    select * into g from public.members where id = p_guest and is_guest for update;
  else
    select * into g from public.members where claim_code = v_code and is_guest for update;
  end if;
  if not found then perform public.app_error('INVALID_CLAIM', 'This claim code is not valid. Please check and try again.'); end if;
  if g.claimed_by is not null then
    if g.claimed_by = p_member then
      return jsonb_build_object('claimed', true, 'already', true, 'rewards', 0, 'points', 0);
    end if;
    perform public.app_error('CLAIM_USED', 'This claim code has already been used.');
  end if;
  if g.claim_expires_at < now() then perform public.app_error('CLAIM_EXPIRED', 'This claim code has expired.'); end if;

  for t in select * from public.reward_transactions rt where rt.member_id = g.id and rt.status::text = 'held' for update loop
    select r.validity_days into v_days from public.rewards r where r.id = t.reward_id;
    if t.reward_type = 'capillary_points' or (t.reward_type in ('digital_voucher', 'merchant_voucher') and t.voucher_code is null) then
      v_amount := coalesce((t.reward_snapshot->'value'->>'points')::bigint, 0) * t.quantity;
      update public.reward_transactions
         set member_id = p_member, status = 'pending',
             expires_at = case when v_days is not null then now() + make_interval(days => v_days) end
       where id = t.id;
      insert into public.outbox (kind, aggregate_type, aggregate_id, payload)
      values (case when t.reward_type = 'capillary_points' then 'loyalty.award_points' else 'voucher.issue' end,
              'reward_transaction', t.id,
              jsonb_build_object('suntec_member_id', m.suntec_member_id, 'reward_type', t.reward_type, 'points', v_amount,
                                 'series_id', t.reward_snapshot->'value'->>'series_id',
                                 'reason', 'claim:' || coalesce(t.reward_snapshot->>'key', 'reward'), 'transaction_ref', t.ref))
      on conflict (aggregate_type, aggregate_id, kind) do nothing;
      if t.reward_type = 'capillary_points' then v_points := v_points + v_amount; end if;
    else
      -- gifts, privileges, manual exclusives: collect at the concierge with a claim QR
      update public.reward_transactions
         set member_id = p_member, status = 'issued', issued_at = now(),
             claim_token = coalesce(claim_token, upper(encode(extensions.gen_random_bytes(5), 'hex'))),
             expires_at = case when v_days is not null then now() + make_interval(days => v_days) end
       where id = t.id;
    end if;
    v_n := v_n + 1;
  end loop;

  update public.members set claimed_by = p_member, claimed_at = now(), guest_token_hash = null where id = g.id;
  insert into public.domain_events (type, member_id, payload)
  values ('guest.claimed', p_member, jsonb_build_object('guest_id', g.id, 'rewards', v_n, 'points', v_points));
  return jsonb_build_object('claimed', true, 'already', false, 'rewards', v_n, 'points', v_points);
end;
$$;

-- Expire held winnings that were never claimed and return their stock.
create or replace function public.guest_maintenance()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t record;
  v_n int := 0;
begin
  for t in select rt.id, rt.reward_id, rt.reward_type, rt.quantity from public.reward_transactions rt
           where rt.status::text = 'held' and rt.expires_at < now() for update skip locked loop
    update public.reward_transactions set status = 'expired' where id = t.id;
    update public.reward_inventory
       set remaining_qty = least(total_qty, remaining_qty + case when t.reward_type = 'capillary_points' then 1 else t.quantity end)
     where reward_id = t.reward_id and remaining_qty is not null;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('held_rewards_expired', v_n);
end;
$$;

-- -----------------------------------------------------------------------------
-- Engine changes for guests
-- -----------------------------------------------------------------------------

-- Code-pool rewards need a real account to receive a unique code → unavailable to guests
-- (the draw then falls back like an out-of-stock prize).
create or replace function public.reward_available(p_reward uuid, p_member uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rewards;
  inv public.reward_inventory;
  v_issued int;
  v_count int;
  v_pool boolean;
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
  v_pool := coalesce((r.value->>'source') = 'code_pool', false) or (r.type = 'exclusive_reward' and coalesce(r.value->>'fulfilment', '') = 'code_pool');
  if v_pool and p_member is not null and exists (select 1 from public.members m where m.id = p_member and m.is_guest) then
    return false;
  end if;
  if v_pool and not exists (select 1 from public.voucher_code_pool c where c.reward_id = p_reward and c.status = 'available'
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

-- Same as 0014 plus: guests' winnings are HELD (no Capillary/VMS delivery, no claim
-- token, expire with the guest's claim window) and code-pool rewards are refused.
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
  v_guest boolean;
  v_hold_until timestamptz;
begin
  select t.id into v_existing from public.reward_transactions t
  where t.source = p_source and t.source_id = p_source_id and t.reward_id = p_reward;
  if v_existing is not null then
    return public.reward_txn_view(v_existing) || jsonb_build_object('ok', true, 'replay', true);
  end if;

  select m.is_guest, m.suntec_member_id, m.claim_expires_at into v_guest, v_suntec, v_hold_until
  from public.members m where m.id = p_member;
  v_guest := coalesce(v_guest, false);

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

  v_units := case when r.type in ('play_points', 'capillary_points', 'bonus_attempt') then 1 else v_qty end;

  v_pool := coalesce((r.value->>'source') = 'code_pool', false)
            or (r.type = 'exclusive_reward' and coalesce(r.value->>'fulfilment', '') = 'code_pool');
  if v_pool and v_guest then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
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

  if v_guest and r.type not in ('play_points', 'bonus_attempt') then
    v_status := 'held';                       -- kept for the guest until claimed by a Suntec+ member
    v_expires := coalesce(v_hold_until, now() + interval '30 days');
  elsif r.type = 'capillary_points' or (r.type in ('digital_voucher', 'merchant_voucher') and not v_pool) then
    v_status := 'pending';                    -- delivered to Capillary / VMS through the outbox
  end if;
  if not v_guest and (r.type in ('promo_gift', 'privilege') or (r.type = 'exclusive_reward' and not v_pool)) then
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
                                                           'source', p_source, 'type', r.type, 'held', v_guest));
  if not v_guest and r.type not in ('play_points', 'bonus_attempt') and p_source <> 'game' then
    perform public.notify(p_member, 'reward_allocated', jsonb_build_object('reward_name', r.name, 'transaction_ref', v_ref), 'rt:' || v_txn);
  end if;
  return public.reward_txn_view(v_txn) || jsonb_build_object('ok', true, 'held', v_status::text = 'held');
end;
$$;

-- Read model used by the Play & Win screens (adds guest state and Suntec+ points won).
create or replace function public.member_summary(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'member', jsonb_build_object('id', m.id, 'suntec_member_id', case when m.is_guest then null else m.suntec_member_id end,
                                 'first_name', m.first_name, 'last_name', m.last_name, 'tier', m.tier, 'status', m.status,
                                 'email', m.email::text),
    'is_guest', m.is_guest,
    'claim', case when m.is_guest then jsonb_build_object('code', m.claim_code, 'expires_at', m.claim_expires_at) end,
    'held', (select jsonb_build_object('rewards', count(*),
                                       'points', coalesce(sum(case when t.reward_type = 'capillary_points'
                                                                   then (t.reward_snapshot->'value'->>'points')::bigint * t.quantity end), 0))
             from public.reward_transactions t where t.member_id = m.id and t.status::text = 'held'),
    'points_won', (select coalesce(sum((t.reward_snapshot->'value'->>'points')::bigint * t.quantity), 0)
                   from public.reward_transactions t
                   where t.member_id = m.id and t.reward_type = 'capillary_points'
                     and t.status::text in ('pending', 'retrying', 'issued', 'redeemed')),
    'pp_name', 'Suntec+ Points',
    'pp_balance', p.pp_balance, 'pp_lifetime_earned', p.pp_lifetime_earned,
    'stats', jsonb_build_object('games_played', p.games_played, 'missions_completed', p.missions_completed,
                                'checkins_total', p.checkins_total, 'quiz_wins', p.quiz_wins, 'badges', p.badges_count),
    'unread_notifications', (select count(*) from public.notifications n where n.member_id = m.id and n.read_at is null),
    'active_rewards', (select count(*) from public.reward_transactions t where t.member_id = m.id
                       and t.status::text in ('held', 'issued', 'pending', 'retrying') and t.reward_type not in ('play_points', 'bonus_attempt')),
    'preferences', jsonb_build_object('lb_display_mode', p.lb_display_mode, 'lb_nickname', p.lb_nickname,
                                      'lb_opt_out', p.lb_opt_out, 'notify_push', p.notify_push, 'notify_email', p.notify_email))
  from public.members m join public.member_profiles p on p.member_id = m.id where m.id = p_member;
$$;

-- -----------------------------------------------------------------------------
-- Suntec+ points only: retire Play Points and the Play Points catalogue
-- -----------------------------------------------------------------------------
update public.rewards
   set type = 'capillary_points',
       value = jsonb_build_object('points', coalesce((value->>'amount')::int, 0)),
       name = replace(name, 'Play Points', 'Suntec+ Points'),
       description = case when description = '' or description ilike '%play points%' then 'Credited to your Suntec+ account' else description end,
       category_id = coalesce((select c.id from public.reward_categories c where c.key = 'suntec_points'), category_id)
 where type = 'play_points';
update public.rewards set in_catalogue = false, pp_cost = null where in_catalogue or pp_cost is not null;
update public.reward_categories set status = 'inactive' where key = 'play_points' and status = 'active';
update public.games set attempt_rules = attempt_rules - 'pp_cost' where attempt_rules ? 'pp_cost';
update public.games set rules_text = replace(replace(rules_text,
         'Additional spins cost 200 Play Points or can be earned from missions and check-in streaks.',
         'Earn extra spins from missions and check-in streaks.'),
         'extra cards cost 100 Play Points.', 'earn extra cards from missions.')
 where rules_text ilike '%play points%';
update public.games set rules_text = replace(rules_text, 'to earn Play Points', 'to earn Suntec+ Points') where rules_text ilike '%to earn play points%';
update public.game_outcomes
   set label = regexp_replace(replace(label, 'Play Points', 'Suntec+ Points'), '^(\d+) PP$', '\1 Points')
 where label ilike '%play points%' or label ~ '^\d+ PP$';
update public.quiz_questions
   set explanation = replace(explanation, 'Play Points', 'Suntec+ Points')
 where explanation ilike '%play points%' and text <> 'What are Play Points used for?';
update public.quiz_options set text = replace(text, 'Play Points', 'Suntec+ Points') where text ilike '%play points%';
-- demo question about the retired catalogue (seed id) → reworded
update public.quiz_questions
   set text = 'Where do the points you win in Play & Win go?', explanation = 'Points you win are added to your Suntec+ account.'
 where id = '23000000-0000-4000-8000-000000000013' and text = 'What are Play Points used for?';
update public.quiz_options set text = 'Your Suntec+ account'
 where question_id = '23000000-0000-4000-8000-000000000013' and text = 'Redeeming rewards in the catalogue';
update public.quiz_options set text = 'A separate game wallet'
 where question_id = '23000000-0000-4000-8000-000000000013' and text = 'Paying for parking';

-- -----------------------------------------------------------------------------
-- Admin: Suntec+ Points awarded (dashboard today / one customer) and guest stats
-- -----------------------------------------------------------------------------
create or replace function public.admin_points_summary(p_member uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := public.business_day()::timestamp at time zone public.app_tz();
begin
  if not (public.has_permission('reports.read') or public.has_permission('campaigns.read') or public.has_permission('customers.read')) then
    perform public.app_error('FORBIDDEN', 'You do not have permission to view this');
  end if;
  return jsonb_build_object(
    'points_awarded_today', (select coalesce(sum((t.reward_snapshot->'value'->>'points')::bigint * t.quantity), 0)
                             from public.reward_transactions t
                             where t.reward_type = 'capillary_points' and t.created_at >= v_start
                               and t.status::text in ('pending', 'retrying', 'issued')),
    'points_held', (select coalesce(sum((t.reward_snapshot->'value'->>'points')::bigint * t.quantity), 0)
                    from public.reward_transactions t where t.reward_type = 'capillary_points' and t.status::text = 'held'),
    'guests_today', (select count(*) from public.members m where m.is_guest and m.created_at >= v_start),
    'guests_claimed_today', (select count(*) from public.members m where m.is_guest and m.claimed_at >= v_start),
    'member_points_won', case when p_member is null then null else
      (select coalesce(sum((t.reward_snapshot->'value'->>'points')::bigint * t.quantity), 0)
       from public.reward_transactions t
       where t.member_id = p_member and t.reward_type = 'capillary_points' and t.status::text in ('pending', 'retrying', 'issued', 'redeemed')) end);
end;
$$;

do $$
begin
  revoke execute on function public.admin_points_summary(uuid) from public;
  begin
    revoke execute on function public.admin_points_summary(uuid) from anon;
    grant execute on function public.admin_points_summary(uuid) to authenticated, service_role;
  exception when undefined_object then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges: engine functions are server-only (service role)
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public._claim_code()', 'public.guest_create(text, text)', 'public.guest_claim(uuid, text, uuid)',
                           'public.guest_maintenance()', 'public.reward_available(uuid, uuid)',
                           'public.allocate_reward(uuid, uuid, int, public.reward_source, text, uuid, int, uuid, uuid, boolean)',
                           'public.member_summary(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when undefined_object then null;
    end;
  end loop;
end $$;
