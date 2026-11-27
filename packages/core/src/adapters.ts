import { AppError } from './errors';

/**
 * Integration contracts with the EXISTING Suntec+ platform. The gamification platform
 * never stores Suntec+ loyalty points or vouchers — it only asks the system of record
 * to award/issue them, always with an idempotency key (= our reward transaction id).
 *
 *   LOYALTY_ADAPTER=mock       → MockAdapter (mock_capillary schema, DEV/SIT)
 *   LOYALTY_ADAPTER=capillary  → CapillaryHttpAdapter (real REST API)
 */
export interface LoyaltyMember {
  memberId: string;
  cardNo?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mobile?: string | null;
  tier?: string | null;
  tags?: string[];
  joinedAt?: string | null;
  status?: string | null;
  pointsBalance?: number | null;
}

export interface AwardPointsInput {
  memberId: string;
  points: number;
  idempotencyKey: string;
  reason: string;
}

export interface IssueVoucherInput {
  memberId: string;
  seriesId: string;
  idempotencyKey: string;
}

export interface PushInput {
  memberId: string;
  title: string;
  body: string;
  deepLink?: string | null;
  idempotencyKey: string;
}

export interface LoyaltyAdapter {
  readonly name: string;
  getMember(memberId: string): Promise<LoyaltyMember | null>;
  findMemberByEmail(email: string): Promise<LoyaltyMember | null>;
  awardPoints(input: AwardPointsInput): Promise<{ externalRef: string }>;
  issueVoucher(input: IssueVoucherInput): Promise<{ externalRef: string; code: string | null; expiresAt: string | null }>;
  sendPush(input: PushInput): Promise<{ externalRef: string | null }>;
}

/** Converts a loyalty member to the profile JSON accepted by public.ensure_member(). */
export function toMemberProfile(m: LoyaltyMember): Record<string, unknown> {
  return {
    card_no: m.cardNo ?? undefined,
    first_name: m.firstName ?? undefined,
    last_name: m.lastName ?? undefined,
    email: m.email ?? undefined,
    mobile: m.mobile ?? undefined,
    tier: m.tier ?? undefined,
    tags: m.tags ?? undefined,
    joined_at: m.joinedAt ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker: after `threshold` consecutive failures the upstream is skipped for
// `cooldownMs`; work stays in the outbox and is retried later. Protects Suntec+.
// ---------------------------------------------------------------------------
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.failures < this.threshold) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Loyalty system temporarily unavailable (circuit open)');
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (e) {
      this.failures++;
      if (this.failures >= this.threshold) this.openedAt = this.now();
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock adapter — calls the server-only mock_cap_* SQL functions.
// ---------------------------------------------------------------------------
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

type MockMemberRow = {
  member_id: string;
  card_no: string;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile: string | null;
  tier: string;
  tags: string[];
  joined_at: string;
  status: string;
  points_balance: number;
};

function fromMock(row: MockMemberRow | null): LoyaltyMember | null {
  if (!row) return null;
  return {
    memberId: row.member_id,
    cardNo: row.card_no,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    mobile: row.mobile,
    tier: row.tier,
    tags: row.tags ?? [],
    joinedAt: row.joined_at,
    status: row.status,
    pointsBalance: Number(row.points_balance ?? 0),
  };
}

export function createMockAdapter(rpc: RpcCaller): LoyaltyAdapter {
  return {
    name: 'mock',
    async getMember(memberId) {
      return fromMock((await rpc('mock_cap_get_member', { p_member_id: memberId })) as MockMemberRow | null);
    },
    async findMemberByEmail(email) {
      return fromMock((await rpc('mock_cap_get_member', { p_email: email })) as MockMemberRow | null);
    },
    async awardPoints({ memberId, points, idempotencyKey, reason }) {
      const r = (await rpc('mock_cap_award_points', {
        p_member_id: memberId,
        p_points: points,
        p_idem: idempotencyKey,
        p_reason: reason,
      })) as { external_ref: string };
      return { externalRef: r.external_ref };
    },
    async issueVoucher({ memberId, seriesId, idempotencyKey }) {
      const r = (await rpc('mock_cap_issue_coupon', {
        p_member_id: memberId,
        p_series: seriesId,
        p_idem: idempotencyKey,
      })) as { external_ref: string; code: string; expires_at: string | null };
      return { externalRef: r.external_ref, code: r.code, expiresAt: r.expires_at };
    },
    async sendPush({ idempotencyKey }) {
      // DEV/SIT: push is simulated; the message is still visible in the in-app inbox.
      return { externalRef: `MOCK-PUSH-${idempotencyKey.slice(0, 8)}` };
    },
  };
}

// ---------------------------------------------------------------------------
// Capillary / Suntec+ REST adapter. Endpoint paths are configuration-driven
// placeholders until the Suntec+ API specification is supplied (see
// docs/solution/10-integration-capillary.md); only this file changes when it is.
// ---------------------------------------------------------------------------
export interface CapillaryConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  breaker?: CircuitBreaker;
}

export function createCapillaryAdapter(cfg: CapillaryConfig): LoyaltyAdapter {
  const f = cfg.fetchImpl ?? fetch;
  const breaker = cfg.breaker ?? new CircuitBreaker();
  const base = cfg.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idem?: string): Promise<T | null> {
    return breaker.exec(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 4000);
      try {
        const res = await f(`${base}${path}`, {
          method,
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(idem ? { 'Idempotency-Key': idem } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 404 && method === 'GET') return null;
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new AppError(res.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_MEMBER_NOT_FOUND', `Suntec+ API ${res.status}: ${text.slice(0, 200)}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('UPSTREAM_UNAVAILABLE', `Suntec+ API unreachable: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  type ApiMember = {
    member_id: string;
    card_no?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile?: string;
    tier?: string;
    tags?: string[];
    joined_at?: string;
    status?: string;
    points_balance?: number;
  };
  const map = (m: ApiMember | null): LoyaltyMember | null =>
    m
      ? {
          memberId: m.member_id,
          cardNo: m.card_no,
          firstName: m.first_name,
          lastName: m.last_name,
          email: m.email,
          mobile: m.mobile,
          tier: m.tier,
          tags: m.tags,
          joinedAt: m.joined_at,
          status: m.status,
          pointsBalance: m.points_balance,
        }
      : null;

  return {
    name: 'capillary',
    async getMember(memberId) {
      return map(await call<ApiMember>('GET', `/members/${encodeURIComponent(memberId)}`));
    },
    async findMemberByEmail(email) {
      const r = await call<{ members: ApiMember[] }>('GET', `/members?email=${encodeURIComponent(email)}`);
      return map(r?.members?.[0] ?? null);
    },
    async awardPoints({ memberId, points, idempotencyKey, reason }) {
      const r = await call<{ transaction_id: string }>('POST', '/points/award', { member_id: memberId, points, reason }, idempotencyKey);
      return { externalRef: r?.transaction_id ?? idempotencyKey };
    },
    async issueVoucher({ memberId, seriesId, idempotencyKey }) {
      const r = await call<{ voucher_id: string; code?: string; expires_at?: string }>(
        'POST',
        '/vouchers/issue',
        { member_id: memberId, series_id: seriesId },
        idempotencyKey,
      );
      return { externalRef: r?.voucher_id ?? idempotencyKey, code: r?.code ?? null, expiresAt: r?.expires_at ?? null };
    },
    async sendPush({ memberId, title, body, deepLink, idempotencyKey }) {
      const r = await call<{ message_id?: string }>('POST', '/push/send', { member_id: memberId, title, body, deep_link: deepLink }, idempotencyKey);
      return { externalRef: r?.message_id ?? null };
    },
  };
}
