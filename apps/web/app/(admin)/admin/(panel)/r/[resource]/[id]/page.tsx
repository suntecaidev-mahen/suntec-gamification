import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { Alert, Button, Card, Field, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { clientFields, getResource, type Option } from '@/lib/admin/resources';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { saveInventory, uploadCodes } from '@/lib/admin/actions';
import { ResourceForm } from '@/components/admin/ResourceForm';
import { ActionForm } from '@/components/admin/ActionForm';
import { PageHeader, Section } from '@/components/admin/ui';
import { publicEnv } from '@/lib/env';

export default async function ResourceEdit({ params, searchParams }: { params: Promise<{ resource: string; id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { resource, id } = await params;
  const { saved } = await searchParams;
  const res = getResource(resource);
  if (!res) notFound();
  const staff = await requireStaff(res.readPerm);
  const canWrite = res.writePerm.some((p) => staff.can(p));
  const isNew = id === 'new';
  const supabase = await createSupabaseServerClient();

  let row: Record<string, unknown> | null = null;
  if (!isNew) {
    const { data } = await supabase.from(res.table).select('*').eq(res.idColumn ?? 'id', id).maybeSingle();
    if (!data) notFound();
    row = data as Record<string, unknown>;
  }

  // Options for reference / m2m / rewards fields
  const options: Record<string, Option[]> = {};
  const m2mSelected: Record<string, string[]> = {};
  await Promise.all(
    res.fields
      .filter((f) => (f.type === 'ref' || f.type === 'm2m') && f.ref)
      .map(async (f) => {
        const { data } = await supabase.from(f.ref!.table).select(`id, ${f.ref!.label}`).order(f.ref!.label).limit(500);
        options[f.name] = ((data ?? []) as unknown as Record<string, string>[]).map((r) => ({ value: r.id!, label: r[f.ref!.label] ?? r.id! }));
        if (f.type === 'm2m' && f.m2m && row) {
          const { data: sel } = await supabase.from(f.m2m.table).select(f.m2m.other).eq(f.m2m.self, id);
          m2mSelected[f.name] = ((sel ?? []) as unknown as Record<string, string>[]).map((s) => s[f.m2m!.other]!);
        }
      }),
  );
  if (res.fields.some((f) => f.type === 'rewards')) {
    const { data } = await supabase.from('rewards').select('id, name, type').eq('status', 'active').order('sort');
    options.__rewards = (data ?? []).map((r) => ({ value: r.id as string, label: `${r.name} (${String(r.type).replace(/_/g, ' ')})` }));
  }

  const title = isNew ? `New ${res.singular.toLowerCase()}` : String(row?.name ?? row?.title ?? row?.label ?? res.singular);
  const links = row && res.links ? res.links(row) : [];

  return (
    <>
      <PageHeader
        title={title}
        back={{ href: `/admin/r/${res.key}`, label: res.title }}
        actions={links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Button variant="secondary">{l.label}</Button>
          </Link>
        ))}
      />
      {saved && <Alert tone="success" className="mb-4">{res.singular} created.</Alert>}
      <div className="max-w-4xl">
        <ResourceForm resource={res.key} singular={res.singular} fields={clientFields(res.fields)} row={row} options={options} m2mSelected={m2mSelected} canWrite={canWrite} deletable={res.deletable} />
        {res.key === 'rewards' && row && <RewardStock rewardId={id} canWrite={staff.can('rewards.write')} codePool={isCodePool(row)} />}
        {res.key === 'qr_codes' && row && <QrPanel token={String(row.token)} label={String(row.label)} />}
      </div>
    </>
  );
}

function isCodePool(row: Record<string, unknown>) {
  const v = (row.value ?? {}) as Record<string, unknown>;
  return v.source === 'code_pool' || (row.type === 'exclusive_reward' && v.fulfilment === 'code_pool');
}

async function RewardStock({ rewardId, canWrite, codePool }: { rewardId: string; canWrite: boolean; codePool: boolean }) {
  const supabase = await createSupabaseServerClient();
  const [{ data: inv }, { count: available }, { count: assigned }] = await Promise.all([
    supabase.from('reward_inventory').select('*').eq('reward_id', rewardId).maybeSingle(),
    supabase.from('voucher_code_pool').select('id', { count: 'exact', head: true }).eq('reward_id', rewardId).eq('status', 'available'),
    supabase.from('voucher_code_pool').select('id', { count: 'exact', head: true }).eq('reward_id', rewardId).eq('status', 'assigned'),
  ]);
  return (
    <>
      <Section title="Inventory" description="Leave total empty for unlimited stock. Remaining is decremented atomically on every allocation.">
        <Card>
          <ActionForm action={saveInventory} submitLabel="Save inventory">
            <input type="hidden" name="reward_id" value={rewardId} />
            <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-4">
              <Field id="inv-total" label="Total quantity">
                <Input id="inv-total" name="total_qty" type="number" min={0} defaultValue={inv?.total_qty ?? ''} />
              </Field>
              <Field id="inv-rem" label="Remaining">
                <Input id="inv-rem" name="remaining_qty" type="number" min={0} defaultValue={inv?.remaining_qty ?? ''} />
              </Field>
              <Field id="inv-cap" label="Daily cap">
                <Input id="inv-cap" name="daily_cap" type="number" min={0} defaultValue={inv?.daily_cap ?? ''} />
              </Field>
              <Field id="inv-low" label="Low-stock alert at">
                <Input id="inv-low" name="low_stock_threshold" type="number" min={0} defaultValue={inv?.low_stock_threshold ?? 0} />
              </Field>
            </fieldset>
          </ActionForm>
        </Card>
      </Section>
      {codePool && (
        <Section title="Voucher code pool" description={`${available ?? 0} available · ${assigned ?? 0} assigned. Codes are handed out one per winner, never twice.`}>
          <Card>
            <ActionForm action={uploadCodes} submitLabel="Add codes">
              <input type="hidden" name="reward_id" value={rewardId} />
              <Field id="codes" label="Codes (one per line, or comma separated)">
                <textarea id="codes" name="codes" rows={5} className="block w-full rounded-md border border-input-border px-3 py-2 font-mono text-xs" disabled={!canWrite} />
              </Field>
              <Field id="codes-exp" label="Codes expire (optional, SGT)">
                <Input id="codes-exp" name="expires_at" type="datetime-local" disabled={!canWrite} />
              </Field>
            </ActionForm>
          </Card>
        </Section>
      )}
    </>
  );
}

async function QrPanel({ token, label }: { token: string; label: string }) {
  const url = `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/q/${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1F2937', light: '#FFFFFF' } });
  const png = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 });
  return (
    <Section title="Printable QR code" description="Customers scan this with their phone camera or the Play & Win scanner.">
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="w-56 shrink-0" role="img" aria-label={`QR code for ${label}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Link:</span> <code className="break-all text-xs">{url}</code>
          </p>
          <p className="text-text-muted">Print at least 3 × 3 cm. Regenerate (create a new code and deactivate this one) if a code is leaked.</p>
          <a href={png} download={`qr-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}>
            <Button variant="secondary">Download PNG</Button>
          </a>
        </div>
      </Card>
    </Section>
  );
}
