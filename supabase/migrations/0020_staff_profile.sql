-- =============================================================================
-- 0020 · Admin users: department and invitation tracking
-- Staff are created from Admin → Users & roles. Supabase Auth emails them an
-- invitation; they set their own password on first sign-in.
-- Safe to re-run.
-- =============================================================================
alter table public.staff_users add column if not exists department text;
alter table public.staff_users add column if not exists invited_at timestamptz;
alter table public.staff_users add column if not exists invited_by uuid references public.staff_users (id) on delete set null;

comment on column public.staff_users.department is 'Department of the staff user (e.g. Marketing, Customer Service).';
comment on column public.staff_users.invited_at is 'When the latest invitation / set-password email was sent.';

-- Friendlier role names for the access-level picker (keys unchanged).
update public.roles set name = 'Super Administrator (full access)' where key = 'super_admin' and name = 'Super Administrator';
update public.roles set name = 'Read-only' where key = 'read_only' and name = 'Read-Only User';
