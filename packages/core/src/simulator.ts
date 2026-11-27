import { WEIGHT_TOTAL_BP } from './constants';

/**
 * Probability engine mirror (TypeScript). The authoritative draw runs in SQL
 * (public.draw_outcome with pgcrypto RNG). This module implements the SAME algorithm
 * for the admin probability simulator, weight validation and unit tests.
 */
export type FallbackStrategy = 'none' | 'outcome' | 'renormalize';

export interface SimOutcome {
  id: string;
  position: number;
  label: string;
  weightBp: number;
  rewardId: string | null;
  /** remaining stock for the outcome's reward; null = unlimited */
  stock?: number | null;
  /** business cost per award in cents (for expected cost) */
  unitCostCents?: number;
  fallback?: FallbackStrategy;
  fallbackOutcomeId?: string | null;
}

export interface WeightCheck {
  ok: boolean;
  totalBp: number;
  percent: number;
  errors: string[];
}

export function validateWeights(outcomes: Pick<SimOutcome, 'weightBp' | 'label' | 'fallback' | 'fallbackOutcomeId' | 'id'>[]): WeightCheck {
  const errors: string[] = [];
  const totalBp = outcomes.reduce((s, o) => s + o.weightBp, 0);
  if (outcomes.length === 0) errors.push('Add at least one outcome.');
  for (const o of outcomes) {
    if (!Number.isInteger(o.weightBp) || o.weightBp < 0 || o.weightBp > WEIGHT_TOTAL_BP) {
      errors.push(`"${o.label}": weight must be a whole number of basis points between 0 and 10000.`);
    }
    if (o.fallback === 'outcome' && !o.fallbackOutcomeId) errors.push(`"${o.label}": choose a fallback outcome.`);
    if (o.fallbackOutcomeId && o.fallbackOutcomeId === o.id) errors.push(`"${o.label}": cannot fall back to itself.`);
  }
  if (totalBp !== WEIGHT_TOTAL_BP) {
    errors.push(`Weights total ${(totalBp / 100).toFixed(2)}% — they must total exactly 100%.`);
  }
  return { ok: errors.length === 0, totalBp, percent: totalBp / 100, errors };
}

/** Uniform integer in [0, upper). Injected so tests can be deterministic. */
export type RandomInt = (upper: number) => number;

export const mathRandomInt: RandomInt = (upper) => Math.floor(Math.random() * upper);

/** Crypto RNG with rejection sampling (no modulo bias) — same approach as the SQL engine. */
export const cryptoRandomInt: RandomInt = (upper) => {
  if (upper <= 0) throw new Error('upper must be > 0');
  const limit = Math.floor(0x1_0000_0000 / upper) * upper;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const r = buf[0]!;
    if (r < limit) return r % upper;
  }
};

function pickWeighted(outcomes: SimOutcome[], roll: number): SimOutcome | undefined {
  let cum = 0;
  for (const o of [...outcomes].sort((a, b) => a.position - b.position)) {
    if (o.weightBp <= 0) continue;
    cum += o.weightBp;
    if (roll < cum) return o;
  }
  return undefined;
}

export interface DrawResult {
  drawn: SimOutcome;
  final: SimOutcome;
  fallback: FallbackStrategy | null;
  noReward: boolean;
}

/** One draw. `available(o)` reports whether the outcome's reward is in stock. */
export function drawOutcome(
  outcomes: SimOutcome[],
  available: (o: SimOutcome) => boolean,
  rand: RandomInt = cryptoRandomInt,
): DrawResult {
  const total = outcomes.reduce((s, o) => s + Math.max(o.weightBp, 0), 0);
  if (total <= 0) throw new Error('No weighted outcomes');
  const drawn = pickWeighted(outcomes, rand(WEIGHT_TOTAL_BP)) ?? outcomes[outcomes.length - 1]!;
  if (available(drawn)) return { drawn, final: drawn, fallback: null, noReward: false };

  const strategy = drawn.fallback ?? 'renormalize';
  if (strategy === 'outcome' && drawn.fallbackOutcomeId) {
    const fb = outcomes.find((o) => o.id === drawn.fallbackOutcomeId);
    if (fb && available(fb)) return { drawn, final: fb, fallback: 'outcome', noReward: false };
  } else if (strategy === 'renormalize') {
    const pool = outcomes.filter((o) => o.weightBp > 0 && available(o));
    const poolTotal = pool.reduce((s, o) => s + o.weightBp, 0);
    if (poolTotal > 0) {
      const fin = pickWeighted(pool, rand(poolTotal));
      if (fin) return { drawn, final: fin, fallback: 'renormalize', noReward: false };
    }
  }
  const tryAgain = [...outcomes].sort((a, b) => a.position - b.position).find((o) => o.rewardId === null);
  return { drawn, final: tryAgain ?? drawn, fallback: 'none', noReward: !tryAgain };
}

export interface SimulationRow {
  id: string;
  label: string;
  configuredPercent: number;
  wins: number;
  observedPercent: number;
  stockLeft: number | null;
  stockOutAtSpin: number | null;
}

export interface SimulationResult {
  spins: number;
  rows: SimulationRow[];
  noPrizeRate: number;
  expectedCostPerSpinCents: number;
  totalCostCents: number;
  fallbacksApplied: number;
}

/**
 * Monte-Carlo simulation of N spins with finite stock, so admins can see the real
 * prize distribution, cost per spin and when each prize sells out before going live.
 */
export function simulate(outcomes: SimOutcome[], spins: number, rand: RandomInt = cryptoRandomInt): SimulationResult {
  const n = Math.max(1, Math.min(Math.floor(spins), 1_000_000));
  const stock = new Map<string, number | null>(outcomes.map((o) => [o.id, o.rewardId ? (o.stock ?? null) : null]));
  const stockOut = new Map<string, number | null>(outcomes.map((o) => [o.id, null]));
  const wins = new Map<string, number>(outcomes.map((o) => [o.id, 0]));
  let cost = 0;
  let fallbacks = 0;
  let noPrize = 0;
  const available = (o: SimOutcome) => {
    if (!o.rewardId) return true;
    const s = stock.get(o.id);
    return s === null || s === undefined || s > 0;
  };
  for (let i = 1; i <= n; i++) {
    const r = drawOutcome(outcomes, available, rand);
    if (r.fallback) fallbacks++;
    const f = r.final;
    wins.set(f.id, (wins.get(f.id) ?? 0) + 1);
    if (!f.rewardId || r.noReward) {
      noPrize++;
      continue;
    }
    cost += f.unitCostCents ?? 0;
    const s = stock.get(f.id);
    if (typeof s === 'number') {
      stock.set(f.id, s - 1);
      if (s - 1 === 0) stockOut.set(f.id, i);
    }
  }
  return {
    spins: n,
    rows: [...outcomes]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        id: o.id,
        label: o.label,
        configuredPercent: o.weightBp / 100,
        wins: wins.get(o.id) ?? 0,
        observedPercent: ((wins.get(o.id) ?? 0) / n) * 100,
        stockLeft: stock.get(o.id) ?? null,
        stockOutAtSpin: stockOut.get(o.id) ?? null,
      })),
    noPrizeRate: noPrize / n,
    expectedCostPerSpinCents: cost / n,
    totalCostCents: cost,
    fallbacksApplied: fallbacks,
  };
}

/** Pearson chi-square statistic of observed counts vs. configured weights. */
export function chiSquare(observed: number[], weightsBp: number[]): number {
  const n = observed.reduce((s, x) => s + x, 0);
  return observed.reduce((chi, o, i) => {
    const exp = (n * (weightsBp[i] ?? 0)) / WEIGHT_TOTAL_BP;
    return exp > 0 ? chi + (o - exp) ** 2 / exp : chi;
  }, 0);
}
