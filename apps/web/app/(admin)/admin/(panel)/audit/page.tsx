import { Alert, Button, Field, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DataTable, PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Audit log' };

type Entry = { id: number; created_at: string; actor_type: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; reason: string | null; before: unknown; after: unknown };

function diff(before: unknown, after: unknown): string {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return '';
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => k !== 'updated_at' && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .slice(0, 6)
    .map((k) => `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`)
    .join('; ');
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string }> }) {
  // Administration pages are for Super Administrators only (only they hold audit.read).
  const staff = await requireStaff('audit.read');
  const { entity, action } = await searchParams;
  const supabase = await createSupabaseServerClient();
  let q = supabase.from('audit_log').select('id, created_at, actor_type, actor_id, action, entity, entity_id, reason, before, after').order('id', { ascending: false }).limit(200);
  if (entity) q = q.eq('entity', entity);
  if (action) q = q.ilike('action', `%${action.replace(/[%_]/g, '')}%`);
  const [{ data, error }, { data: people }] = await Promise.all([q, supabase.from('staff_users').select('id, display_name')]);
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  return (
    <>
      <PageHeader title="Audit log" description={staff.can('audit.read') ? 'Every configuration change and manual customer action — append-only.' : 'Your own actions (append-only).'} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field id="entity" label="Table" className="w-48">
          <Input id="entity" name="entity" defaultValue={entity ?? ''} placeholder="games" />
        </Field>
        <Field id="action" label="Action contains" className="w-48">
          <Input id="action" name="action" defaultValue={action ?? ''} placeholder="update" />
        </Field>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : (
        <DataTable<Entry>
          rows={(data as Entry[]) ?? []}
          columns={[
            { key: 'created_at', label: 'When', format: 'datetime' },
            { key: 'actor', label: 'Who', render: (e) => (e.actor_id ? (names.get(e.actor_id) ?? `${e.actor_type}`) : e.actor_type) },
            { key: 'action', label: 'Action' },
            { key: 'entity_id', label: 'Record', render: (e) => <code className="text-xs">{e.entity_id?.slice(0, 13)}</code> },
            { key: 'change', label: 'Change', render: (e) => <span className="text-xs text-text-muted">{e.reason ?? diff(e.before, e.after)}</span> },
          ]}
          empty={{ title: 'No audit entries' }}
        />
      )}
    </>
  );
}
