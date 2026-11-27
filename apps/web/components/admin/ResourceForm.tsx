'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from '@suntec/ui';
import { deleteResource, saveResource, type ActionState } from '@/lib/admin/actions';
import type { FieldDef, Option } from '@/lib/admin/resources';
import { toSgtInput } from '@/lib/admin/format';

type Props = {
  resource: string;
  singular: string;
  fields: FieldDef[];
  row: Record<string, unknown> | null;
  options: Record<string, Option[]>;
  m2mSelected: Record<string, string[]>;
  canWrite: boolean;
  deletable?: boolean;
};

const widths = { full: 'sm:col-span-6', half: 'sm:col-span-3', third: 'sm:col-span-2' };

export function ResourceForm({ resource, singular, fields, row, options, m2mSelected, canWrite, deletable }: Props) {
  const [state, action, pending] = useActionState(saveResource, {} as ActionState);
  const [delState, delAction, deleting] = useActionState(deleteResource, {} as ActionState);
  const isEdit = Boolean(row);
  const err = (n: string) => state.fieldErrors?.[n];

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" aria-describedby="form-status">
        <input type="hidden" name="__resource" value={resource} />
        {row && <input type="hidden" name="__id" value={String(row.id ?? row.reward_id ?? '')} />}
        <Card>
          <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            {fields.map((f) => {
              const id = `f-${f.name}`;
              const value = row ? row[f.name] : f.default;
              const readOnly = isEdit && f.readOnlyOnEdit;
              return (
                <Field key={f.name} id={id} label={f.label} help={f.help} error={err(f.name)} required={f.required} className={widths[f.width ?? 'full']}>
                  <FieldControl field={f} id={id} value={value} options={options[f.name] ?? f.options ?? []} selected={m2mSelected[f.name] ?? []} readOnly={readOnly} invalid={Boolean(err(f.name))} rewardOptions={options.__rewards ?? []} />
                </Field>
              );
            })}
          </fieldset>
        </Card>
        <div id="form-status" className="space-y-3">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.ok && <Alert tone="success">{state.message}</Alert>}
        </div>
        {canWrite ? (
          <Button type="submit" loading={pending}>
            {isEdit ? 'Save changes' : `Create ${singular.toLowerCase()}`}
          </Button>
        ) : (
          <Alert tone="info">You have read-only access to this page.</Alert>
        )}
      </form>
      {isEdit && deletable && canWrite && (
        <form
          action={delAction}
          onSubmit={(e) => {
            if (!window.confirm(`Delete this ${singular.toLowerCase()}? This cannot be undone.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="__resource" value={resource} />
          <input type="hidden" name="__id" value={String(row?.id ?? '')} />
          <Button type="submit" variant="danger" size="sm" loading={deleting}>
            Delete
          </Button>
          {delState.error && <Alert tone="danger" className="mt-2">{delState.error}</Alert>}
        </form>
      )}
    </div>
  );
}

function FieldControl({
  field: f,
  id,
  value,
  options,
  selected,
  readOnly,
  invalid,
  rewardOptions,
}: {
  field: FieldDef;
  id: string;
  value: unknown;
  options: Option[];
  selected: string[];
  readOnly?: boolean;
  invalid: boolean;
  rewardOptions: Option[];
}) {
  const common = { id, name: f.name, 'aria-invalid': invalid || undefined, 'aria-describedby': `${id}-help ${id}-error` };
  switch (f.type) {
    case 'textarea':
      return <Textarea {...common} defaultValue={(value as string) ?? ''} required={f.required} />;
    case 'number':
      return <Input {...common} type="number" inputMode="decimal" step={f.step ?? 1} min={f.min} max={f.max} defaultValue={value === null || value === undefined ? '' : String(value)} required={f.required} />;
    case 'money':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">S$</span>
          <Input {...common} type="number" step="0.01" min={0} className="pl-10" defaultValue={value === null || value === undefined ? '' : (Number(value) / 100).toFixed(2)} />
        </div>
      );
    case 'datetime':
      return <Input {...common} type="datetime-local" defaultValue={toSgtInput(value as string)} />;
    case 'time':
      return <Input {...common} type="time" defaultValue={value ? String(value).slice(0, 5) : ''} />;
    case 'checkbox':
      return <Checkbox id={id} name={f.name} label="Yes" defaultChecked={Boolean(value)} />;
    case 'select':
    case 'ref':
      return (
        <>
          <Select {...common} defaultValue={(value as string) ?? ''} required={f.required} disabled={readOnly}>
            {(!f.required || f.type === 'ref') && <option value="">{f.type === 'ref' ? '— None —' : '— Select —'}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {readOnly && <input type="hidden" name={f.name} value={(value as string) ?? ''} />}
        </>
      );
    case 'multiselect': {
      const current = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div className="flex flex-wrap gap-4" id={id} role="group">
          {options.map((o) => (
            <Checkbox key={o.value} name={f.name} value={o.value} label={o.label} defaultChecked={current.has(o.value)} />
          ))}
        </div>
      );
    }
    case 'm2m':
      return (
        <div className="flex flex-wrap gap-4" id={id} role="group">
          {options.length === 0 && <span className="text-sm text-text-muted">No options yet.</span>}
          {options.map((o) => (
            <Checkbox key={o.value} name={f.name} value={o.value} label={o.label} defaultChecked={selected.includes(o.value)} />
          ))}
        </div>
      );
    case 'tags':
      return <Input {...common} defaultValue={Array.isArray(value) ? (value as string[]).join(', ') : ''} />;
    case 'json':
      return <Textarea {...common} className="font-mono text-xs" rows={5} defaultValue={JSON.stringify(value ?? f.default ?? {}, null, 2)} spellCheck={false} />;
    case 'rewards':
      return <RewardsField id={id} name={f.name} initial={(value as { reward_id: string; qty: number }[]) ?? []} options={rewardOptions} />;
    default:
      return <Input {...common} type="text" defaultValue={(value as string) ?? ''} required={f.required} placeholder={f.placeholder} />;
  }
}

/** Reward picker: rows of [reward, quantity], serialised to JSON in a hidden input. */
export function RewardsField({ id, name, initial, options }: { id: string; name: string; initial: { reward_id: string; qty: number }[]; options: Option[] }) {
  const [rows, setRows] = useState(initial.length ? initial : []);
  return (
    <div id={id} className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(rows.filter((r) => r.reward_id))} />
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Select aria-label={`Reward ${i + 1}`} value={r.reward_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reward_id: e.target.value } : x)))}>
            <option value="">— Choose reward —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input aria-label={`Quantity ${i + 1}`} type="number" min={1} className="w-24" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove reward ${i + 1}`}>
            ✕
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setRows([...rows, { reward_id: '', qty: 1 }])}>
        + Add reward
      </Button>
    </div>
  );
}
