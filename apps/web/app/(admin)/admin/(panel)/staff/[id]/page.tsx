import { notFound } from 'next/navigation';
import { Badge, Card } from '@suntec/ui';
import { formatDateTime } from '@suntec/core';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { lastSignIns } from '@/lib/admin/invite';
import { resendStaffInvite, updateStaff } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { PageHeader } from '@/components/admin/ui';
import { StaffFields, STATUS_TONE, staffStatus } from '@/components/admin/StaffFields';

export const metadata = { title: 'Edit user' };
export const dynamic = 'force-dynamic';

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff('staff.manage');
  const supabase = await createSupabaseServerClient();
  const [{ data: s }, { data: roles }, signIns] = await Promise.all([
    supabase
      .from('staff_users')
      .select('id, email, display_name, department, active, created_at, invited_at, staff_user_roles!staff_user_roles_user_id_fkey(role_key)')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('roles').select('key, name, description').order('sort'),
    lastSignIns(),
  ]);
  if (!s) notFound();
  const role = ((s.staff_user_roles ?? []) as { role_key: string }[])[0]?.role_key ?? null;
  const last = signIns.get(s.id) ?? null;
  const status = staffStatus(s.active, last);

  return (
    <>
      <PageHeader
        title={s.display_name}
        description={`${s.email}${s.id === me.userId ? ' · this is you' : ''}`}
        back={{ href: '/admin/staff', label: 'Users & roles' }}
        actions={<Badge tone={STATUS_TONE[status]}>{status}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <h2 className="mb-4 text-base font-semibold">Details and access</h2>
          <ActionForm action={updateStaff} submitLabel="Save changes">
            <input type="hidden" name="user_id" value={s.id} />
            <StaffFields roles={roles ?? []} editing value={{ display_name: s.display_name, email: String(s.email), department: s.department, role, active: s.active }} />
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold">Sign-in</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Last sign-in</dt>
                <dd>{last ? formatDateTime(last) : 'Not yet'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Invitation sent</dt>
                <dd>{s.invited_at ? formatDateTime(s.invited_at) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">Added</dt>
                <dd>{formatDateTime(s.created_at)}</dd>
              </div>
            </dl>
          </Card>
          {s.active && (
            <Card>
              <h2 className="mb-1 text-base font-semibold">{status === 'Invited' ? 'Resend invitation' : 'Send password reset'}</h2>
              <p className="mb-3 text-sm text-text-muted">
                {status === 'Invited'
                  ? 'Emails a new link so they can create their password.'
                  : 'Emails a link so they can set a new password.'}
              </p>
              <ActionForm action={resendStaffInvite} submitLabel={status === 'Invited' ? 'Resend invitation' : 'Send reset email'} variant="secondary" result="invite-link">
                <input type="hidden" name="user_id" value={s.id} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
