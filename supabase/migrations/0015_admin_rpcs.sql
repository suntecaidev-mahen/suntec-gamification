-- =============================================================================
-- 0015 · Admin panel RPCs that must be atomic (Phase 3)
--   admin_save_outcomes  — replace a wheel/scratch outcome set in ONE transaction so the
--                          100% weight rule is checked once, on the final state.
--   admin_save_question  — upsert a quiz question with its options (exactly one correct).
-- Both check permissions themselves and are audited. Executable by `authenticated`.
-- =============================================================================

create or replace function public.admin_save_outcomes(p_game uuid, p_outcomes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o jsonb;
  v_id uuid;
  v_ids uuid[];
  v_before jsonb;
  v_n int;
begin
  perform public._require_perm('games.write');
  if not exists (select 1 from public.games where id = p_game) then
    perform public.app_error('NOT_FOUND', 'Game not found');
  end if;
  if jsonb_typeof(p_outcomes) <> 'array' or jsonb_array_length(p_outcomes) = 0 or jsonb_array_length(p_outcomes) > 24 then
    perform public.app_error('INVALID', 'Provide between 1 and 24 outcomes');
  end if;
  select count(distinct (x->>'position')) into v_n from jsonb_array_elements(p_outcomes) x;
  if v_n <> jsonb_array_length(p_outcomes) then
    perform public.app_error('INVALID', 'Outcome positions must be unique');
  end if;
  for o in select value from jsonb_array_elements(p_outcomes) loop
    if coalesce(trim(o->>'label'), '') = '' then perform public.app_error('INVALID', 'Every outcome needs a label'); end if;
    if (o->>'weight_bp')::int not between 0 and 10000 then perform public.app_error('INVALID', 'Weights must be between 0 and 10000 bp'); end if;
    if o->>'fallback_strategy' = 'outcome' and (o->>'fallback_position') is null then
      perform public.app_error('INVALID', '"' || (o->>'label') || '": choose which outcome to fall back to');
    end if;
    if o->>'fallback_strategy' = 'outcome' and (o->>'fallback_position') = (o->>'position') then
      perform public.app_error('INVALID', '"' || (o->>'label') || '": an outcome cannot fall back to itself');
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(go) order by go.position), '[]'::jsonb) into v_before
  from public.game_outcomes go where go.game_id = p_game;

  select array_agg((x->>'id')::uuid) into v_ids from jsonb_array_elements(p_outcomes) x where coalesce(x->>'id', '') <> '';
  delete from public.game_outcomes where game_id = p_game and (v_ids is null or id <> all (v_ids));
  update public.game_outcomes set position = position + 1000, fallback_strategy = 'none', fallback_outcome_id = null where game_id = p_game;

  for o in select value from jsonb_array_elements(p_outcomes) loop
    v_id := nullif(o->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.game_outcomes where id = v_id and game_id = p_game) then
      update public.game_outcomes set
        position = (o->>'position')::int,
        label = trim(o->>'label'),
        display = coalesce(o->'display', '{}'::jsonb),
        reward_id = nullif(o->>'reward_id', '')::uuid,
        reward_qty = coalesce((o->>'reward_qty')::int, 1),
        weight_bp = (o->>'weight_bp')::int,
        fallback_strategy = (case when o->>'fallback_strategy' = 'outcome' then 'none' else coalesce(o->>'fallback_strategy', 'renormalize') end)::public.fallback_strategy
      where id = v_id;
    else
      insert into public.game_outcomes (game_id, position, label, display, reward_id, reward_qty, weight_bp, fallback_strategy)
      values (p_game, (o->>'position')::int, trim(o->>'label'), coalesce(o->'display', '{}'::jsonb), nullif(o->>'reward_id', '')::uuid,
              coalesce((o->>'reward_qty')::int, 1), (o->>'weight_bp')::int,
              (case when o->>'fallback_strategy' = 'outcome' then 'none' else coalesce(o->>'fallback_strategy', 'renormalize') end)::public.fallback_strategy);
    end if;
  end loop;

  for o in select value from jsonb_array_elements(p_outcomes) where value->>'fallback_strategy' = 'outcome' loop
    update public.game_outcomes g
       set fallback_strategy = 'outcome',
           fallback_outcome_id = (select f.id from public.game_outcomes f where f.game_id = p_game and f.position = (o->>'fallback_position')::int)
     where g.game_id = p_game and g.position = (o->>'position')::int;
  end loop;
  if exists (select 1 from public.game_outcomes where game_id = p_game and fallback_strategy = 'outcome' and fallback_outcome_id is null) then
    perform public.app_error('INVALID', 'A fallback points to an outcome position that does not exist');
  end if;

  perform public.assert_game_weights(p_game);
  perform public._audit('game.outcomes_saved', 'games', p_game::text, v_before, p_outcomes, null);
  return (select jsonb_agg(to_jsonb(go) order by go.position) from public.game_outcomes go where go.game_id = p_game);
end;
$$;

-- p_question: {"id"?, "category", "text", "explanation", "time_limit_s", "points", "status", "sort", "image_path",
--              "options": [{"text":"…","is_correct":true}, …]}  (2-6 options, exactly one correct)
create or replace function public.admin_save_question(p_game uuid, p_question jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p_question->>'id', '')::uuid;
  v_opts jsonb := coalesce(p_question->'options', '[]'::jsonb);
  v_n int;
  v_correct int;
  o record;
begin
  if not (public.has_permission('games.write') or public.has_permission('content.write')) then
    perform public.app_error('FORBIDDEN', 'You do not have permission to edit quiz questions');
  end if;
  if not exists (select 1 from public.games g where g.id = p_game and g.type = 'quiz') then
    perform public.app_error('NOT_FOUND', 'Quiz not found');
  end if;
  v_n := jsonb_array_length(v_opts);
  select count(*) into v_correct from jsonb_array_elements(v_opts) x where coalesce((x->>'is_correct')::boolean, false);
  if v_n < 2 or v_n > 6 then perform public.app_error('INVALID', 'A question needs between 2 and 6 options'); end if;
  if v_correct <> 1 then perform public.app_error('INVALID', 'Mark exactly one option as correct'); end if;
  if coalesce(trim(p_question->>'text'), '') = '' then perform public.app_error('INVALID', 'Question text is required'); end if;
  if exists (select 1 from jsonb_array_elements(v_opts) x where coalesce(trim(x->>'text'), '') = '') then
    perform public.app_error('INVALID', 'Every option needs text');
  end if;

  if v_id is not null and exists (select 1 from public.quiz_questions where id = v_id and game_id = p_game) then
    update public.quiz_questions set
      category = coalesce(nullif(p_question->>'category', ''), 'general'),
      text = trim(p_question->>'text'),
      explanation = coalesce(p_question->>'explanation', ''),
      image_path = nullif(p_question->>'image_path', ''),
      time_limit_s = nullif(p_question->>'time_limit_s', '')::int,
      points = coalesce(nullif(p_question->>'points', '')::int, 100),
      status = coalesce(nullif(p_question->>'status', ''), 'active')::public.record_status,
      sort = coalesce(nullif(p_question->>'sort', '')::int, 100)
    where id = v_id;
  else
    insert into public.quiz_questions (game_id, category, text, explanation, image_path, time_limit_s, points, status, sort)
    values (p_game, coalesce(nullif(p_question->>'category', ''), 'general'), trim(p_question->>'text'), coalesce(p_question->>'explanation', ''),
            nullif(p_question->>'image_path', ''), nullif(p_question->>'time_limit_s', '')::int, coalesce(nullif(p_question->>'points', '')::int, 100),
            coalesce(nullif(p_question->>'status', ''), 'active')::public.record_status, coalesce(nullif(p_question->>'sort', '')::int, 100))
    returning id into v_id;
  end if;

  for o in select value as opt, (ordinality - 1)::int as pos from jsonb_array_elements(v_opts) with ordinality loop
    insert into public.quiz_options as qo (question_id, position, text, is_correct)
    values (v_id, o.pos, trim(o.opt->>'text'), coalesce((o.opt->>'is_correct')::boolean, false))
    on conflict (question_id, position) do update set text = excluded.text, is_correct = excluded.is_correct;
  end loop;
  if exists (select 1 from public.quiz_options qo join public.game_session_answers a on a.option_id = qo.id
             where qo.question_id = v_id and qo.position >= v_n) then
    perform public.app_error('INVALID', 'Options that customers have already answered cannot be removed — archive the question instead');
  end if;
  delete from public.quiz_options where question_id = v_id and position >= v_n;
  return v_id;
end;
$$;

do $$
begin
  revoke execute on function public.admin_save_outcomes(uuid, jsonb) from public;
  revoke execute on function public.admin_save_question(uuid, jsonb) from public;
  begin
    revoke execute on function public.admin_save_outcomes(uuid, jsonb) from anon;
    revoke execute on function public.admin_save_question(uuid, jsonb) from anon;
    grant execute on function public.admin_save_outcomes(uuid, jsonb) to authenticated, service_role;
    grant execute on function public.admin_save_question(uuid, jsonb) to authenticated, service_role;
  exception when undefined_object then null;
  end;
end $$;
