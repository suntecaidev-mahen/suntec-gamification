import { Badge, Card } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { lastSignIns } from '@/lib/admin/invite';
import { inviteStaff } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { DataTable, PageHeader, Section } from '@/components/admin/ui';
import { StaffFields, staffStatus, STATUS_TONE } from '@/components/admin/StaffFields';

export const metadata = { title: 'Users & roles' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  display_name: string;
  email: string;
  department: string;
  access: string;
  status: 'Invited' | 'Active' | 'Deactivated';
  last_sign_in: string | null;
  you: boolean;
};

export default async function StaffPage() {
  const me = await requireStaff('staff.manage');
  const supabase = await createSupabaseServerClient();
  const [{ data: staff }, { data: roles }, { data: perms }, { data: matrix }, signIns] = await Promise.all([
    supabase.from('staff_users').select('id, email, display_name, department, active, staff_user_roles!staff_user_roles_user_id_fkey(role_key)').order('display_name'),
    supabase.from('roles').select('key, name, description').order('sort'),
    supabase.from('permissions').select('key, description').order('key'),
    supabase.from('role_permissions').select('role_key, permission_key'),
    lastSignIns(),
  ]);
  const roleName = new Map((roles ?? []).map((r) => [r.key, r.name]));
  const rows: Row[] = (staff ?? []).map((s) => {
    const keys = ((s.staff_user_roles ?? []) as { role_key: string }[]).map((r) => r.role_key);
    const last = signIns.get(s.id) ?? null;
    return {
      id: s.id,
      display_name: s.display_name,
      email: String(s.email),
      department: s.department ?? '',
      access: keys.map((k) => roleName.get(k) ?? k).join(', ') || 'No access',
      status: staffStatus(s.active, last),
      last_sign_in: last,
      you: s.id === me.userId,
    };
  });
  const has = (r: string, p: string) => (matrix ?? []).some((m) => m.role_key === r && m.permission_key === p);

  return (
    <>
      <PageHeader title="Users & roles" description="Add admin users and choose what each person can access. New users receive an email to create their own password." />
      <div className="grid gap-6 2xl:grid-cols-[1fr_380px]">
        <DataTable<Row>
          rows={rows}
          rowHref={(r) => `/admin/staff/${r.id}`}
          caption="Admin users"
          columns={[
            { key: 'display_name', label: 'Name', render: (r) => <>{r.display_name}{r.you && <span className="ml-1 text-xs font-normal text-text-muted">(you)</span>}</> },
            { key: 'email', label: 'Email' },
            { key: 'department', label: 'Department' },
            { key: 'access', label: 'Access level' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
            { key: 'last_sign_in', label: 'Last sign-in', format: 'datetime' },
          ]}
          empty={{ title: 'No admin users yet' }}
        />
        <Card className="h-fit max-w-2xl">
          <h2 className="mb-1 text-base font-semibold">Add user</h2>
          <p className="mb-4 text-sm text-text-muted">They’ll get an email with a link to create their password.</p>
          <ActionForm action={inviteStaff} submitLabel="Add user and send invitation" result="invite-link">
            <StaffFields roles={roles ?? []} />
          </ActionForm>
        </Card>
      </div>

      <Section title="What each access level can do">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs font-medium text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  Permission
                </th>
                {(roles ?? []).map((r) => (
                  <th key={r.key} scope="col" className="px-2 py-3 text-center font-semibold">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(perms ?? []).map((p) => (
                <tr key={p.key}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {p.description}
                  </th>
                  {(roles ?? []).map((r) => (
                    <td key={r.key} className="text-center">
                      {has(r.key, p.key) ? (
                        <span aria-label="allowed" className="font-bold text-success">
                          ✓
                        </span>
                      ) : (
                        <span aria-label="not allowed" className="text-text-subtle">
                          –
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}
