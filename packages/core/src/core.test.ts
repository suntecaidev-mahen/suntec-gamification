import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  CircuitBreaker,
  attemptRulesSchema,
  chiSquare,
  createCapillaryAdapter,
  createMockAdapter,
  drawOutcome,
  evaluateRules,
  eventsBodySchema,
  maskEmail,
  maskName,
  maskTail,
  periodKey,
  businessDay,
  preferencesBodySchema,
  simulate,
  statusForCode,
  validateWeights,
  type SimOutcome,
} from './index';

// The seeded Year-End wheel (supabase/seed.sql)
const wheel: SimOutcome[] = [
  { id: 'o0', position: 0, label: '20 PP', weightBp: 2500, rewardId: 'pp20', fallback: 'renormalize' },
  { id: 'o1', position: 1, label: '$5 Dining', weightBp: 1200, rewardId: 'din5', unitCostCents: 500, fallback: 'renormalize' },
  { id: 'o2', position: 2, label: 'Bonus Spin', weightBp: 800, rewardId: 'bonus', fallback: 'renormalize' },
  { id: 'o3', position: 3, label: '50 PP', weightBp: 1500, rewardId: 'pp50', fallback: 'renormalize' },
  { id: 'o4', position: 4, label: 'Free Kopi', weightBp: 500, rewardId: 'kopi', stock: 20, unitCostCents: 350, fallback: 'outcome', fallbackOutcomeId: 'o0' },
  { id: 'o5', position: 5, label: '100 Suntec+ Pts', weightBp: 600, rewardId: 'cap100', unitCostCents: 50, fallback: 'renormalize' },
  { id: 'o6', position: 6, label: '$10 Voucher', weightBp: 300, rewardId: 'ret10', stock: 500, unitCostCents: 1000, fallback: 'outcome', fallbackOutcomeId: 'o3' },
  { id: 'o7', position: 7, label: 'Try Again', weightBp: 2600, rewardId: null, fallback: 'none' },
];

/** Deterministic PRNG (mulberry32) so statistical tests are reproducible. */
function seeded(seed: number) {
  let a = seed;
  return (upper: number) => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * upper);
  };
}

describe('weights', () => {
  it('accepts a wheel totalling exactly 100%', () => {
    expect(validateWeights(wheel)).toMatchObject({ ok: true, totalBp: 10000, percent: 100 });
  });
  it('rejects totals other than 100% and bad fallbacks', () => {
    const bad = validateWeights([
      { id: 'a', label: 'A', weightBp: 5000 },
      { id: 'b', label: 'B', weightBp: 4000, fallback: 'outcome', fallbackOutcomeId: null },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/90\.00%/);
    expect(bad.errors.join(' ')).toMatch(/fallback/);
  });
});

describe('draw engine', () => {
  it('matches configured probabilities (chi-square, 100k draws)', () => {
    const rand = seeded(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < 100_000; i++) {
      const r = drawOutcome(wheel, () => true, rand);
      counts.set(r.final.id, (counts.get(r.final.id) ?? 0) + 1);
    }
    const chi = chiSquare(wheel.map((o) => counts.get(o.id) ?? 0), wheel.map((o) => o.weightBp));
    expect(chi).toBeLessThan(24.32); // df = 7, p = 0.001
  });

  it('uses the configured fallback outcome when a prize is out of stock', () => {
    const rand = seeded(7);
    for (let i = 0; i < 2000; i++) {
      const r = drawOutcome(wheel, (o) => o.id !== 'o4', rand);
      expect(r.final.id).not.toBe('o4');
      if (r.drawn.id === 'o4') expect(r.final.id).toBe('o0');
    }
  });

  it('renormalises among in-stock outcomes', () => {
    const rand = seeded(9);
    for (let i = 0; i < 2000; i++) {
      const r = drawOutcome(wheel, (o) => o.id !== 'o1', rand);
      expect(r.final.id).not.toBe('o1');
    }
  });

  it('falls back to "try again" when nothing is available', () => {
    const r = drawOutcome(wheel, (o) => o.rewardId === null, seeded(1));
    expect(r.final.rewardId).toBeNull();
  });
});

describe('simulator', () => {
  it('reports stock-out, cost per spin and observed distribution', () => {
    const res = simulate(wheel, 10_000, seeded(123));
    const kopi = res.rows.find((r) => r.id === 'o4')!;
    expect(kopi.wins).toBe(20); // never more than stock
    expect(kopi.stockOutAtSpin).toBeGreaterThan(0);
    expect(res.expectedCostPerSpinCents).toBeGreaterThan(0);
    expect(res.rows.reduce((s, r) => s + r.wins, 0)).toBe(10_000);
    const tryAgain = res.rows.find((r) => r.id === 'o7')!;
    expect(Math.abs(tryAgain.observedPercent - 26)).toBeLessThan(2);
  });
});

describe('rules', () => {
  const member = { tier: 'gold', tags: ['vip', 'frequent_diner'], joined_days: 30, checkins_total: 5, status: 'active' };
  it('evaluates all/any conditions like the SQL engine', () => {
    expect(evaluateRules(member, { all: [{ field: 'tier', op: 'in', value: ['gold', 'platinum'] }] })).toBe(true);
    expect(evaluateRules(member, { all: [{ field: 'joined_days', op: 'lte', value: 90 }] })).toBe(true);
    expect(evaluateRules(member, { all: [{ field: 'tags', op: 'contains', value: 'vip' }] })).toBe(true);
    expect(evaluateRules(member, { all: [{ field: 'tags', op: 'in', value: ['family'] }] })).toBe(false);
    expect(evaluateRules(member, { any: [{ field: 'tier', op: 'eq', value: 'silver' }, { field: 'checkins_total', op: 'gte', value: 5 }] })).toBe(true);
    expect(evaluateRules(member, { all: [{ field: 'missing', op: 'gte', value: 1 }] })).toBe(false);
    expect(evaluateRules(member, { all: [{ field: 'missing', op: 'neq', value: 1 }] })).toBe(true);
    expect(evaluateRules(member, null)).toBe(true);
  });
});

describe('time (Asia/Singapore business day)', () => {
  it('rolls the day over at midnight SGT, not UTC', () => {
    // 2026-11-27 16:30 UTC = 2026-11-28 00:30 SGT
    const d = new Date('2026-11-27T16:30:00Z');
    expect(businessDay(d)).toBe('2026-11-28');
    expect(periodKey('daily', d)).toBe('2026-11-28');
    expect(periodKey('monthly', d)).toBe('2026-11');
    expect(periodKey('overall', d)).toBe('all');
  });
  it('uses ISO weeks (week 1 contains the first Thursday)', () => {
    expect(periodKey('weekly', new Date('2026-11-27T04:00:00Z'))).toBe('2026-W48');
    expect(periodKey('weekly', new Date('2027-01-01T04:00:00Z'))).toBe('2026-W53');
    expect(periodKey('weekly', new Date('2024-12-30T04:00:00Z'))).toBe('2025-W01');
  });
});

describe('masking', () => {
  it('masks names, emails and identifiers', () => {
    expect(maskName('Mei Ling', 'Lim')).toBe('M*** L.');
    expect(maskName(null, null)).toBe('?***');
    expect(maskEmail('tan.demo@example.com')).toBe('ta***@example.com');
    expect(maskTail('6012000010001', 4)).toBe('*********0001');
  });
});

describe('schemas', () => {
  it('validates attempt rules and preferences', () => {
    expect(attemptRulesSchema.parse({ free_per_day: 1, pp_cost: 200 })).toMatchObject({ cooldown_seconds: 10 });
    expect(() => attemptRulesSchema.parse({ free_per_day: -1 })).toThrow();
    expect(preferencesBodySchema.safeParse({ lb_nickname: '<script>' }).success).toBe(false);
    expect(preferencesBodySchema.safeParse({ lb_nickname: 'Kopi King' }).success).toBe(true);
  });
  it('accepts single events and batches', () => {
    const ev = { type: 'transaction', external_id: 'TX-1', member_id: 'SUN-1', payload: { amount_cents: 500, merchant_code: 'M-1' } };
    expect(eventsBodySchema.safeParse(ev).success).toBe(true);
    expect(eventsBodySchema.safeParse({ events: [ev, ev] }).success).toBe(true);
    expect(eventsBodySchema.safeParse({ ...ev, type: 'hack' }).success).toBe(false);
  });
  it('maps error codes to HTTP statuses', () => {
    expect(statusForCode('NO_ATTEMPTS')).toBe(409);
    expect(statusForCode('COOLDOWN')).toBe(429);
    expect(statusForCode('whatever')).toBe(500);
  });
});

describe('adapters', () => {
  it('mock adapter maps the mock Capillary functions', async () => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'mock_cap_get_member') return { member_id: 'SUN-1', card_no: '1', first_name: 'A', last_name: 'B', email: 'a@b.c', mobile: null, tier: 'gold', tags: [], joined_at: '2020-01-01', status: 'active', points_balance: 5 };
      if (fn === 'mock_cap_award_points') return { external_ref: 'CAP-TX-1' };
      return { external_ref: 'VMS-1', code: 'DIN5-AB', expires_at: null };
    });
    const a = createMockAdapter(rpc);
    expect((await a.findMemberByEmail('a@b.c'))?.tier).toBe('gold');
    expect(await a.awardPoints({ memberId: 'SUN-1', points: 100, idempotencyKey: 'k', reason: 'r' })).toEqual({ externalRef: 'CAP-TX-1' });
    expect((await a.issueVoucher({ memberId: 'SUN-1', seriesId: 'DIN5', idempotencyKey: 'k' })).code).toBe('DIN5-AB');
  });

  it('capillary adapter sends the idempotency key and opens the circuit after failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    let now = 0;
    const breaker = new CircuitBreaker(2, 1000, () => now);
    const a = createCapillaryAdapter({ baseUrl: 'https://api.example.test', apiKey: 'k', fetchImpl, breaker });
    await expect(a.awardPoints({ memberId: 'SUN-1', points: 1, idempotencyKey: 'idem-1', reason: 'r' })).rejects.toBeInstanceOf(AppError);
    await expect(a.awardPoints({ memberId: 'SUN-1', points: 1, idempotencyKey: 'idem-1', reason: 'r' })).rejects.toThrow();
    expect(breaker.state).toBe('open');
    await expect(a.awardPoints({ memberId: 'SUN-1', points: 1, idempotencyKey: 'idem-1', reason: 'r' })).rejects.toThrow(/circuit open/);
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2);
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
    now = 2000;
    expect(breaker.state).toBe('half-open');
  });
});
