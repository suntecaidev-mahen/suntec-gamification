import { Checkbox, Field, Input, Select, type BadgeTone } from '@suntec/ui';

export const DEPARTMENTS = ['Digital & Application', 'Digital Marketing', 'Customer Service'];

export type StaffStatus = 'Invited' | 'Active' | 'Deactivated';
export const STATUS_TONE: Record<StaffStatus, BadgeTone> = { Invited: 'warning', Active: 'success', Deactivated: 'neutral' };

/** Invited = has not signed in yet; Deactivated = access switched off. */
export function staffStatus(active: boolean, lastSignIn: string | null): StaffStatus {
  if (!active) return 'Deactivated';
  return lastSignIn ? 'Active' : 'Invited';
}

/** Name, email, department and access level, shared by "Add user" and "Edit user". */
export function StaffFields({
  roles,
  value,
  editing = false,
}: {
  roles: { key: string; name: string; description: string }[];
  value?: { display_name: string; email: string; department: string | null; role: string | null; active: boolean };
  editing?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Field id="display_name" label="Full name" required>
        <Input id="display_name" name="display_name" defaultValue={value?.display_name ?? ''} required minLength={2} autoComplete="off" />
      </Field>
      <Field id="email" label="Work email" required={!editing} help={editing ? 'The email cannot be changed. Add a new user instead.' : undefined}>
        <Input id="email" name="email" type="email" defaultValue={value?.email ?? ''} required={!editing} disabled={editing} autoComplete="off" />
      </Field>
      <Field id="department" label="Department">
        <Select id="department" name="department" defaultValue={value?.department ?? ''}>
          <option value="">Choose a department…</option>
          {/* keep a department saved earlier even if it is no longer in the list */}
          {value?.department && !DEPARTMENTS.includes(value.department) && <option value={value.department}>{value.department}</option>}
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="role" label="Access level" required help={roles.find((r) => r.key === (value?.role ?? 'read_only'))?.description}>
        <Select id="role" name="role" defaultValue={value?.role ?? 'read_only'} required>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      {editing && <Checkbox name="active" label="Active (can sign in)" defaultChecked={value?.active ?? true} />}
    </div>
  );
}

