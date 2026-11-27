-- =============================================================================
-- 0013 · Storage bucket for banners/badge art/quiz images + Realtime inbox
-- Supabase-specific; each block is skipped gracefully if the feature is absent.
-- =============================================================================

-- Public-read bucket for marketing assets (banners, badge artwork, quiz images, merchant logos).
-- Uploads/changes are restricted to staff with content/campaign permissions.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('public-assets', 'public-assets', true, 5242880,
            array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])
    on conflict (id) do update set public = excluded.public,
      file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists "public-assets: staff upload" on storage.objects';
    execute $p$create policy "public-assets: staff upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'public-assets' and ((select public.has_permission('content.write'))
                  or (select public.has_permission('campaigns.write')) or (select public.has_permission('rewards.write'))))$p$;

    execute 'drop policy if exists "public-assets: staff update" on storage.objects';
    execute $p$create policy "public-assets: staff update" on storage.objects for update to authenticated
      using (bucket_id = 'public-assets' and ((select public.has_permission('content.write'))
             or (select public.has_permission('campaigns.write')) or (select public.has_permission('rewards.write'))))$p$;

    execute 'drop policy if exists "public-assets: staff delete" on storage.objects';
    execute $p$create policy "public-assets: staff delete" on storage.objects for delete to authenticated
      using (bucket_id = 'public-assets' and ((select public.has_permission('content.write'))
             or (select public.has_permission('campaigns.write'))))$p$;
  end if;
end $$;

-- Realtime: customers receive inbox inserts instantly (RLS still applies to the stream).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
