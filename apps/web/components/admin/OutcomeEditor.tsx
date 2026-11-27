'use client';

import { useMemo, useState, useTransition } from 'react';
import { Alert, Button, Card, Input, Select } from '@suntec/ui';
import { formatMoney, simulate, validateWeights, type SimOutcome, type SimulationResult } from '@suntec/core';
import { saveOutcomes } from '@/lib/admin/actions';
import { Wheel } from '@/components/play/Wheel';

export type EditorOutcome = {
  id?: string;
  position: number;
  label: string;
  display: { color?: string; text_color?: string; icon?: string };
  reward_id: string | null;
  reward_qty: number;
  weight_bp: number;
  fallback_strategy: 'none' | 'outcome' | 'renormalize';
  fallback_position: number | null;
};

export type RewardOption = { id: string; name: string; type: string; stock: number | null; unit_cost_cents: number };

export function OutcomeEditor({ gameId, gameType, initial, rewards, canWrite }: { gameId: string; gameType: string; initial: EditorOutcome[]; rewards: RewardOption[]; canWrite: boolean }) {
  const [rows, setRows] = useState<EditorOutcome[]>(initial);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const [spins, setSpins] = useState(10000);
  const [sim, setSim] = useState<SimulationResult | null>(null);

  const check = useMemo(
    () => validateWeights(rows.map((r) => ({ id: String(r.position), label: r.label || `#${r.position}`, weightBp: r.weight_bp, fallback: r.fallback_strategy, fallbackOutcomeId: r.fallback_position === null ? null : String(r.fallback_position) }))),
    [rows],
  );
  const update = (i: number, patch: Partial<EditorOutcome>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reward = (id: string | null) => rewards.find((r) => r.id === id);

  const addRow = () =>
    setRows([...rows, { position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0, label: 'New prize', display: {}, reward_id: null, reward_qty: 1, weight_bp: 0, fallback_strategy: 'renormalize', fallback_position: null }]);
  const removeRow = (i: number) => {
    const removed = rows[i]!.position;
    setRows(rows.filter((_, j) => j !== i).map((r) => (r.fallback_position === removed ? { ...r, fallback_strategy: 'renormalize', fallback_position: null } : r)));
  };
  const balance = () => {
    // put the remainder on the first "no prize" outcome (or the last row)
    const diff = 10000 - check.totalBp;
    const idx = Math.max(0, rows.findIndex((r) => !r.reward_id));
    const target = idx >= 0 && rows[idx] ? idx : rows.length - 1;
    update(target, { weight_bp: Math.max(0, (rows[target]?.weight_bp ?? 0) + diff) });
  };

  const runSim = () => {
    const outcomes: SimOutcome[] = rows.map((r) => {
      const rw = reward(r.reward_id);
      return {
        id: String(r.position),
        position: r.position,
        label: r.label,
        weightBp: r.weight_bp,
        rewardId: r.reward_id,
        stock: rw?.stock ?? null,
        unitCostCents: (rw?.unit_cost_cents ?? 0) * (rw?.type === 'capillary_points' || rw?.type === 'play_points' ? 1 : r.reward_qty),
        fallback: r.fallback_strategy,
        fallbackOutcomeId: r.fallback_position === null ? null : String(r.fallback_position),
      };
    });
    setSim(simulate(outcomes, spins));
  };

  const save = () =>
    start(async () => {
      setStatus({});
      const res = await saveOutcomes(gameId, rows.map((r) => ({ ...r, display: Object.fromEntries(Object.entries(r.display).filter(([, v]) => v)) })));
      setStatus(res.ok ? { ok: res.message } : { error: res.error });
    });

  const meterTone = check.totalBp === 10000 ? 'bg-success' : check.totalBp > 10000 ? 'bg-danger' : 'bg-warning';

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Total probability</span>
            <span className={`font-semibold ${check.totalBp === 10000 ? 'text-success' : 'text-danger'}`} aria-live="polite">
              {check.percent.toFixed(2)}% {check.totalBp === 10000 ? '✓' : `(needs ${((10000 - check.totalBp) / 100).toFixed(2)}% ${check.totalBp < 10000 ? 'more' : 'less'})`}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={check.percent} aria-label="Total probability">
            <div className={`h-full ${meterTone} transition-[width]`} style={{ width: `${Math.min(100, check.percent)}%` }} />
          </div>
          {check.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-danger">
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Prize</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Chance %</th>
                {gameType === 'spin_wheel' && <th className="px-3 py-2">Colours</th>}
                <th className="px-3 py-2">If out of stock</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => {
                const rw = reward(r.reward_id);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2 text-text-muted">{r.position}</td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Label ${i + 1}`} value={r.label} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Select aria-label={`Prize ${i + 1}`} value={r.reward_id ?? ''} onChange={(e) => update(i, { reward_id: e.target.value || null })}>
                        <option value="">No prize (try again)</option>
                        {rewards.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                            {o.stock !== null ? ` — ${o.stock} left` : ''}
                          </option>
                        ))}
                      </Select>
                      {rw && rw.stock !== null && rw.stock <= 0 && <p className="mt-1 text-xs text-danger">Out of stock — fallback will apply</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Quantity ${i + 1}`} type="number" min={1} className="w-20" value={r.reward_qty} onChange={(e) => update(i, { reward_qty: Math.max(1, Number(e.target.value) || 1) })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Chance ${i + 1} percent`}
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        className="w-24"
                        value={(r.weight_bp / 100).toString()}
                        onChange={(e) => update(i, { weight_bp: Math.round(Math.max(0, Math.min(100, Number(e.target.value) || 0)) * 100) })}
                      />
                    </td>
                    {gameType === 'spin_wheel' && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input aria-label={`Segment colour ${i + 1}`} type="color" value={r.display.color ?? '#F97316'} onChange={(e) => update(i, { display: { ...r.display, color: e.target.value.toUpperCase() } })} className="h-9 w-10 cursor-pointer rounded border border-input-border" />
                          <input aria-label={`Text colour ${i + 1}`} type="color" value={r.display.text_color ?? '#1F2937'} onChange={(e) => update(i, { display: { ...r.display, text_color: e.target.value.toUpperCase() } })} className="h-9 w-10 cursor-pointer rounded border border-input-border" />
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Select aria-label={`Fallback ${i + 1}`} value={r.fallback_strategy} onChange={(e) => update(i, { fallback_strategy: e.target.value as EditorOutcome['fallback_strategy'], fallback_position: e.target.value === 'outcome' ? (r.fallback_position ?? rows.find((x) => x.position !== r.position)?.position ?? null) : null })}>
                          <option value="renormalize">Re-draw among in-stock</option>
                          <option value="outcome">Give another prize</option>
                          <option value="none">No prize</option>
                        </Select>
                        {r.fallback_strategy === 'outcome' && (
                          <Select aria-label={`Fallback prize ${i + 1}`} value={r.fallback_position ?? ''} onChange={(e) => update(i, { fallback_position: e.target.value === '' ? null : Number(e.target.value) })}>
                            {rows
                              .filter((x) => x.position !== r.position)
                              .map((x) => (
                                <option key={x.position} value={x.position}>
                                  #{x.position} {x.label}
                                </option>
                              ))}
                          </Select>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(i)} disabled={rows.length <= 1} aria-label={`Remove ${r.label}`}>
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={addRow} disabled={!canWrite || rows.length >= 24}>
            + Add outcome
          </Button>
          <Button type="button" variant="secondary" onClick={balance} disabled={!canWrite || check.totalBp === 10000}>
            Balance to 100%
          </Button>
          <Button type="button" onClick={save} loading={pending} disabled={!canWrite || !check.ok}>
            Save prizes & probabilities
          </Button>
        </div>
        {status.error && <Alert tone="danger">{status.error}</Alert>}
        {status.ok && <Alert tone="success">{status.ok}</Alert>}
        {!canWrite && <Alert tone="info">Read-only: you need the “Configure games” permission to change probabilities.</Alert>}

        <Card>
          <h2 className="text-base font-semibold">Probability simulator</h2>
          <p className="mt-1 text-sm text-text-muted">Simulates spins with today’s stock levels to preview the real prize distribution, cost per spin and when prizes sell out. Uses the same draw and fallback algorithm as the live engine.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Number of spins</span>
              <Input type="number" min={100} max={1000000} step={1000} value={spins} onChange={(e) => setSpins(Number(e.target.value) || 1000)} className="w-40" />
            </label>
            <Button type="button" variant="secondary" onClick={runSim} disabled={check.totalBp !== 10000}>
              Run simulation
            </Button>
          </div>
          {sim && (
            <div className="mt-4 overflow-x-auto">
              <p className="mb-2 text-sm">
                Expected cost per spin: <strong>{formatMoney(sim.expectedCostPerSpinCents)}</strong> · total {formatMoney(sim.totalCostCents)} · no-prize rate{' '}
                <strong>{(sim.noPrizeRate * 100).toFixed(1)}%</strong> · fallbacks applied {sim.fallbacksApplied}
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-medium text-text-muted">
                  <tr>
                    <th className="py-1">Outcome</th>
                    <th className="py-1">Configured</th>
                    <th className="py-1">Observed</th>
                    <th className="py-1">Wins</th>
                    <th className="py-1">Stock left</th>
                    <th className="py-1">Sold out at spin</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1">{r.label}</td>
                      <td className="py-1">{r.configuredPercent.toFixed(2)}%</td>
                      <td className="py-1">{r.observedPercent.toFixed(2)}%</td>
                      <td className="py-1">{r.wins.toLocaleString()}</td>
                      <td className="py-1">{r.stockLeft ?? '∞'}</td>
                      <td className="py-1">{r.stockOutAtSpin?.toLocaleString() ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <aside className="space-y-3">
        <Card className="flex flex-col items-center">
          <h2 className="mb-3 self-start text-base font-semibold">Live preview</h2>
          {gameType === 'spin_wheel' ? (
            <Wheel segments={[...rows].sort((a, b) => a.position - b.position).map((r) => ({ label: r.label, color: r.display.color, text_color: r.display.text_color }))} size={300} />
          ) : (
            <ul className="w-full space-y-1 text-sm">
              {[...rows]
                .sort((a, b) => a.position - b.position)
                .map((r) => (
                  <li key={r.position} className="flex justify-between rounded bg-surface-muted px-3 py-2">
                    <span>{r.label}</span>
                    <span className="text-text-muted">{(r.weight_bp / 100).toFixed(2)}%</span>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-text-muted">Customers see labels and colours only. Probabilities never leave the server.</p>
        </Card>
      </aside>
    </div>
  );
}
