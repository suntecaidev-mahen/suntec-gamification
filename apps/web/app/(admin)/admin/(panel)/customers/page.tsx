import { Alert, Button, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DataTable, PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Customers' };

type Row = { id: string; suntec_member_id: string; card_no: string | null; name: string; email: string | null; tier: string; status: string; pp_balance: number; last_active_at: string | null };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff('customers.read');
  const { q } = await searchParams;
  const { data, error } = await (await createSupabaseServerClient()).rpc('admin_customer_search', { p_q: q ?? '', p_limit: 50 });
  const pii = staff.can('customers.pii');
  return (
    <>
      <PageHeader
        title="Customers"
        description={pii ? 'Search by Suntec+ member ID, card number, email or name.' : 'Search by Suntec+ member ID or card number. Personal data is masked for your role.'}
      />
      <form className="mb-4 flex max-w-lg gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search customers
        </label>
        <Input id="q" name="q" defaultValue={q ?? ''} placeholder={pii ? 'SUN-00010001, 6012…, tan@…, Tan' : 'SUN-00010001 or card number'} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : (
        <DataTable<Row>
          caption="Customers"
          rows={(data as Row[]) ?? []}
          rowHref={(r) => `/admin/customers/${r.id}`}
          columns={[
            { key: 'suntec_member_id', label: 'Member ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'card_no', label: 'Card' },
            { key: 'tier', label: 'Tier' },
            { key: 'pp_balance', label: 'Play Points' },
            { key: 'status', label: 'Status', format: 'status' },
            { key: 'last_active_at', label: 'Last active', format: 'datetime' },
          ]}
          empty={{ title: 'No customers found', description: 'Customers appear after they first open Play & Win or after an event is received for them.' }}
        />
      )}
    </>
  );
}
