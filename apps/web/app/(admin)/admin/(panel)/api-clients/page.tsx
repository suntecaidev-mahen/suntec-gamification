import { Alert, Card, Checkbox, Field, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createApiClient, revokeApiClient } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { DataTable, PageHeader, Section } from '@/components/admin/ui';

export const metadata = { title: 'API clients' };

type Client = { id: string; name: string; key_prefix: string; scopes: string[]; rate_limit_per_min: number; active: boolean; last_used_at: string | null; created_at: string };

const SCOPES = [
  { value: 'sessions:write', label: 'sessions:write — open Play & Win in the app (SSO handoff)' },
  { value: 'events:write', label: 'events:write — send transactions, visits, voucher redemptions' },
  { value: 'attempts:write', label: 'attempts:write — grant bonus game attempts' },
  { value: 'members:read', label: 'members:read — read Play & Win summaries' },
  { value: 'claims:write', label: 'claims:write — move a guest’s held winnings to a new member (claim code at sign-up)' },
];

export default async function ApiClientsPage() {
  await requireStaff('api_clients.manage');
  const { data, error } = await (await createSupabaseServerClient())
    .from('api_clients')
    .select('id, name, key_prefix, scopes, rate_limit_per_min, active, last_used_at, created_at')
    .order('created_at', { ascending: false });
  return (
    <>
      <PageHeader title="API clients" description="Server-to-server keys for the Suntec+ backend, Capillary webhooks and POS. Keys are shown once and stored only as a SHA-256 hash. Send them as the X-API-Key header." />
      <Card className="max-w-2xl">
        <h2 className="mb-3 text-base font-semibold">Create a key</h2>
        <ActionForm
          action={createApiClient}
          submitLabel="Create key"
          result="api-key"
        >
          <Field id="name" label="Name" required>
            <Input id="name" name="name" placeholder="Suntec+ app backend (PROD)" required />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            <div className="space-y-1">
              {SCOPES.map((s) => (
                <Checkbox key={s.value} name="scopes" value={s.value} label={s.label} />
              ))}
            </div>
          </fieldset>
          <Field id="rl" label="Rate limit (requests per minute)">
            <Input id="rl" name="rate_limit_per_min" type="number" min={1} defaultValue={1200} className="w-40" />
          </Field>
        </ActionForm>
      </Card>
      <Section title="Keys">
        {error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : (
          <DataTable<Client>
            rows={(data as Client[]) ?? []}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'key_prefix', label: 'Key', render: (c) => <code className="text-xs">{c.key_prefix}…</code> },
              { key: 'scopes', label: 'Scopes' },
              { key: 'rate_limit_per_min', label: 'Rate/min' },
              { key: 'last_used_at', label: 'Last used', format: 'datetime' },
              { key: 'active', label: 'Status', render: (c) => (c.active ? 'Active' : 'Revoked') },
              {
                key: 'revoke',
                label: '',
                render: (c) =>
                  c.active ? (
                    <ActionForm action={revokeApiClient} submitLabel="Revoke" inline variant="danger" confirm={`Revoke ${c.name}? Calls using this key will fail immediately.`}>
                      <input type="hidden" name="id" value={c.id} />
                    </ActionForm>
                  ) : null,
              },
            ]}
            empty={{ title: 'No API keys yet' }}
          />
        )}
      </Section>
    </>
  );
}
