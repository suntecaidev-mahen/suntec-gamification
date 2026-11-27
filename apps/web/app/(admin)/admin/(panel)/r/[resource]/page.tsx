import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Button, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { getResource } from '@/lib/admin/resources';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DataTable, PageHeader } from '@/components/admin/ui';

export default async function ResourceList({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<{ q?: string; deleted?: string }> }) {
  const { resource } = await params;
  const { q, deleted } = await searchParams;
  const res = getResource(resource);
  if (!res) notFound();
  const staff = await requireStaff(res.readPerm);
  const canWrite = res.writePerm.some((p) => staff.can(p));

  const supabase = await createSupabaseServerClient();
  let query = supabase.from(res.table).select(res.select).order(res.orderBy.column, { ascending: res.orderBy.ascending ?? true }).limit(500);
  const term = q?.trim().replace(/[%,()]/g, '');
  if (term && res.search?.length) query = query.or(res.search.map((c) => `${c}.ilike.%${term}%`).join(','));
  const { data, error } = await query;

  return (
    <>
      <PageHeader
        title={res.title}
        description={res.description}
        actions={
          canWrite && (
            <Link href={`/admin/r/${res.key}/new`}>
              <Button>+ New {res.singular.toLowerCase()}</Button>
            </Link>
          )
        }
      />
      {deleted && <Alert tone="success" className="mb-4">Deleted.</Alert>}
      {res.search && (
        <form className="mb-4 flex max-w-md gap-2" role="search">
          <label htmlFor="q" className="sr-only">
            Search {res.title}
          </label>
          <Input id="q" name="q" defaultValue={q ?? ''} placeholder={`Search ${res.title.toLowerCase()}…`} />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      )}
      {error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : (
        <DataTable
          caption={res.title}
          rows={(data ?? []) as unknown as Record<string, unknown>[]}
          columns={res.columns}
          rowHref={(row) => `/admin/r/${res.key}/${row[res.idColumn ?? 'id']}`}
          empty={{ title: `No ${res.title.toLowerCase()} yet`, description: canWrite ? `Create the first ${res.singular.toLowerCase()}.` : undefined }}
        />
      )}
    </>
  );
}
