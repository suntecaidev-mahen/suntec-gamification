-- =============================================================================
-- 0016 · Portal support (Phase 4)
--   mock_cap_list_members — DEV/SIT demo picker for linking a portal login to a
--   mock Suntec+ member (service role only; mock schema is not used in PROD).
-- =============================================================================

create or replace function public.mock_cap_list_members()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', m.member_id,
           'name', m.first_name || ' ' || left(m.last_name, 1) || '.',
           'tier', m.tier,
           'linked', exists (select 1 from public.members pm where pm.suntec_member_id = m.member_id and pm.auth_user_id is not null))
         order by m.member_id), '[]'::jsonb)
  from mock_capillary.members m
  where m.status = 'active';
$$;

do $$
begin
  revoke execute on function public.mock_cap_list_members() from public;
  begin
    revoke execute on function public.mock_cap_list_members() from anon, authenticated;
    grant execute on function public.mock_cap_list_members() to service_role;
  exception when undefined_object then null;
  end;
end $$;
