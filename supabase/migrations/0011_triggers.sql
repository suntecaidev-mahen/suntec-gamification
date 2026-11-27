-- =============================================================================
-- 0011 · Triggers: updated_at maintenance and automatic audit logging
-- =============================================================================

-- updated_at on every table that has the column
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','members','member_profiles','staff_users','segments','eligibility_rules','merchants',
    'campaigns','reward_categories','rewards','reward_inventory','games','game_outcomes','quiz_questions',
    'attempt_balances','checkin_programs','member_streaks','missions','mission_progress','badges',
    'leaderboards','qr_codes','reward_transactions','outbox','notification_templates','api_clients'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Audit: every change to configuration / access-control tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','staff_users','staff_user_roles','role_permissions','segments','eligibility_rules',
    'merchants','campaigns','campaign_segments','reward_categories','rewards','games','game_outcomes',
    'quiz_questions','quiz_options','checkin_programs','checkin_streak_rules','badges','leaderboards',
    'leaderboard_exclusions','notification_templates','api_clients'
  ] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change()', t);
  end loop;

  -- Tables the engine also updates at high frequency: audit staff changes only.
  foreach t in array array['reward_inventory','missions','qr_codes'] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change(%L)', t, 'staff_only');
  end loop;
end $$;
