import { Alert, Card, Checkbox, Field, Input } from '@suntec/ui';
import { formatDateTime } from '@suntec/core';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { inviteStaff, updateStaff } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { PageHeader, Section } from '@/components/admin/ui';

export const metadata = { title: 'Staff & roles' };

export default async function StaffPage() {
  const me = await requireStaff('staff.manage');
  const supabase = await createSupabaseServerClient();
  const [{ data: staff, error }, { data: roles }, { data: matrix }] = await Promise.all([
    supabase.from('staff_users').select('id, email, display_name, active, last_login_at, created_at, staff_user_roles(role_key)').order('display_name'),
    supabase.from('roles').select('key, name, description').order('sort'),
    supabase.from('role_permissions').select('role_key, permission_key'),
  ]);
  const perms = [...new Set((matrix ?? []).map((m) => m.permission_key as string))].sort();
  const has = (r: string, p: string) => (matrix ?? []).some((m) => m.role_key === r && m.permission_key === p);

  return (
    <>
      <PageHeader title="Staff & roles" description="Role-based access control. Every change here is audited." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {error && <Alert tone="danger">{error.message}</Alert>}
          {(staff ?? []).map((s) => {
            const current = ((s.staff_user_roles ?? []) as { role_key: string }[]).map((r) => r.role_key);
            return (
              <Card key={s.id} className="p-4">
                <ActionForm action={updateStaff} submitLabel="Save" inline variant="secondary">
                  <input type="hidden" name="user_id" value={s.id} />
                  <div className="min-w-56 flex-1">
                    <p className="font-medium">
                      {s.display_name} {s.id === me.userId && <span className="text-xs text-text-muted">(you)</span>}
                    </p>
                    <p className="text-xs text-text-muted">
                      {s.email} · added {formatDateTime(s.created_at)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {(roles ?? []).map((r) => (
                        <Checkbox key={r.key} name="roles" value={r.key} label={r.name} defaultChecked={current.includes(r.key)} />
                      ))}
                    </div>
                  </div>
                  <Checkbox name="active" label="Active" defaultChecked={s.active} />
                </ActionForm>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit">
          <h2 className="mb-3 text-base font-semibold">Add staff user</h2>
          <ActionForm
            action={inviteStaff}
            submitLabel="Create staff user"
            render={(s) =>
              s.data?.tempPassword ? (
                <Alert tone="warning" title="Temporary password (shown once)">
                  <code className="block break-all font-mono text-xs text-text">{String(s.data.tempPassword)}</code>
                  Share it securely with {String(s.data.email)}.
                </Alert>
              ) : null
            }
          >
            <Field id="email" label="Work email" required>
              <Input id="email" name="email" type="email" required />
            </Field>
            <Field id="display_name" label="Name" required>
              <Input id="display_name" name="display_name" required />
            </Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Roles</legend>
              {(roles ?? []).map((r) => (
                <Checkbox key={r.key} name="roles" value={r.key} label={r.name} className="flex" />
              ))}
            </fieldset>
          </ActionForm>
        </Card>
      </div>

      <Section title="Permission matrix">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Permission</th>
                {(roles ?? []).map((r) => (
                  <th key={r.key} scope="col" className="px-2 py-2 text-center">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {perms.map((p) => (
                <tr key={p}>
                  <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal">
                    {p}
                  </th>
                  {(roles ?? []).map((r) => (
                    <td key={r.key} className="text-center">
                      {has(r.key, p) ? <span aria-label="allowed" className="text-success">●</span> : <span aria-label="not allowed" className="text-text-subtle">·</span>}
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
