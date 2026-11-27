-- =============================================================================
-- 0019 · QR check-in bonus applies to Suntec+ Points
-- The location-verified check-in (scan the Play & Win QR at the mall) multiplies the
-- daily check-in points by checkin_programs.qr_multiplier (e.g. 2×). It was written for
-- the retired Play Points; since 0017 all points are Suntec+ Points, so the multiplier
-- now applies to capillary_points rewards too. Same function as 0014 otherwise.
-- Safe to re-run.
-- =============================================================================
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
    if p_source = 'qr' and v_rtype in ('play_points', 'capillary_points') then v_qty := ceil(v_qty * pr.qr_multiplier)::int; end if;
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

do $$
begin
  revoke execute on function public.checkin(uuid, uuid, public.checkin_source, uuid, text) from public;
  begin
    revoke execute on function public.checkin(uuid, uuid, public.checkin_source, uuid, text) from anon, authenticated;
    grant execute on function public.checkin(uuid, uuid, public.checkin_source, uuid, text) to service_role;
  exception when undefined_object then null;
  end;
end $$;
