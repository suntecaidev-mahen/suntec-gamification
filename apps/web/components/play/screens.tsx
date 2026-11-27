'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, ProgressBar, Select, cn } from '@suntec/ui';
import { formatDate, formatDateTime } from '@suntec/core';
import { api, deepLinkToPath, emitBridge, haptic, newIdempotencyKey, usePlay, useApi, type ApiError } from './client';
import { Dialog, ErrorBlock, LoadingBlock, rewardLine } from './bits';
import { progressText } from './HomeScreen';
import type { Mission, Summary } from './types';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { SUNTEC } from '@/lib/brand';

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-text-muted">{sub}</p>}
    </header>
  );
}

function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 inline-flex rounded-full bg-surface-sunken p-1">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          type="button"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition-colors', value === i.value ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/* ============================== Missions ============================== */
export function MissionsScreen() {
  const { data, error, loading, reload } = useApi<{ items: Mission[] }>('/missions');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function join(id: string) {
    setBusy(id);
    setErr(null);
    try {
      await api(`/missions/${id}/enrol`, { method: 'POST', json: {} });
      haptic('light');
      await reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }
  const items = data?.items ?? [];
  return (
    <>
      <Title sub="Complete missions to earn Play Points, bonus spins and more.">Missions</Title>
      {err && <Alert tone="danger" className="mb-3">{err}</Alert>}
      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} retry={reload} />
      ) : items.length === 0 ? (
        <EmptyState title="No missions right now" description="New missions appear with every campaign." />
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id}>
              <Card className={cn('p-4', m.completed && 'bg-success-subtle')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{m.title}</p>
                    <p className="mt-0.5 text-sm text-text-muted">{m.description}</p>
                  </div>
                  {m.completed ? <Badge tone="success">Completed ✓</Badge> : m.recurrence !== 'once' ? <Badge tone="info">{m.recurrence}</Badge> : null}
                </div>
                {m.enrolled ? (
                  <>
                    <ProgressBar className="mt-3" value={Number(m.progress)} max={Number(m.target)} label={`${m.title} progress`} />
                    <p className="mt-1 text-xs text-text-muted">{progressText(m.objective_type, Number(m.progress), Number(m.target))}</p>
                  </>
                ) : (
                  <Button size="sm" className="mt-3" onClick={() => join(m.id)} loading={busy === m.id}>
                    Join mission
                  </Button>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-primary">🎁 {m.rewards.map((r) => (r.qty > 1 ? `${r.qty}× ${r.name}` : r.name)).join(' + ')}</span>
                  {m.ends_at && <span className="text-text-subtle">Ends {formatDate(m.ends_at)}</span>}
                </div>
                {m.how_to && !m.completed && (
                  <details className="mt-2 text-xs text-text-muted">
                    <summary className="cursor-pointer font-medium text-text">How to complete</summary>
                    <p className="mt-1">{m.how_to}</p>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ============================== Rewards ============================== */
type CatalogueItem = { id: string; type: string; name: string; description: string; pp_cost: number; validity_days: number | null; terms: string; face_value_cents: number | null; limit: { count: number; period: string } | null; category: { name: string } | null; in_stock: boolean; low_stock: boolean };
type WalletItem = { id: string; ref: string; type: string; name: string; description: string; terms: string; points: number | null; collect_at: string | null; source: string; status: string; voucher_code: string | null; claim_token: string | null; expires_at: string | null; created_at: string };

export function RewardsScreen() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'catalogue' | 'mine'>(params.get('tab') === 'mine' ? 'mine' : 'catalogue');
  return (
    <>
      <Title sub="Redeem Play Points for vouchers, gifts and Suntec+ Points.">Rewards</Title>
      <Tabs label="Rewards" value={tab} onChange={setTab} items={[{ value: 'catalogue', label: 'Catalogue' }, { value: 'mine', label: 'My rewards' }]} />
      {tab === 'catalogue' ? <Catalogue onRedeemed={() => setTab('mine')} /> : <Wallet />}
    </>
  );
}

function Catalogue({ onRedeemed }: { onRedeemed: () => void }) {
  const { refreshBalance } = usePlay();
  const me = useApi<Summary>('/me');
  const { data, error, loading, reload } = useApi<{ items: CatalogueItem[] }>('/rewards');
  const [confirm, setConfirm] = useState<CatalogueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey());
  const balance = me.data?.pp_balance ?? 0;

  async function redeem() {
    if (!confirm) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/rewards/${confirm.id}/redeem`, { method: 'POST', json: {}, idempotencyKey: key });
      haptic('success');
      emitBridge('balance_changed');
      refreshBalance();
      setConfirm(null);
      setKey(newIdempotencyKey());
      onRedeemed();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} retry={reload} />;
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState title="The catalogue is empty" description="Check back soon for new rewards." />;
  return (
    <>
      <p className="mb-3 text-sm">
        Your balance: <strong>{balance.toLocaleString()} Play Points</strong>
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <li key={r.id}>
            <Card className="flex h-full flex-col p-4">
              {r.category && <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">{r.category.name}</p>}
              <p className="mt-1 font-semibold">{r.name}</p>
              <p className="mt-1 flex-1 text-sm text-text-muted">{r.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-bold text-primary">★ {r.pp_cost.toLocaleString()}</span>
                {!r.in_stock ? (
                  <Badge>Out of stock</Badge>
                ) : (
                  <Button size="sm" disabled={balance < r.pp_cost} onClick={() => { setErr(null); setConfirm(r); }}>
                    {balance < r.pp_cost ? `Need ${(r.pp_cost - balance).toLocaleString()} more` : 'Redeem'}
                  </Button>
                )}
              </div>
              {r.low_stock && r.in_stock && <p className="mt-1 text-xs text-warning">Limited stock</p>}
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(confirm)} title={`Redeem ${confirm?.name ?? ''}?`} onClose={() => setConfirm(null)}>
        <p className="text-sm text-text-muted">
          {confirm?.pp_cost.toLocaleString()} Play Points will be deducted. {confirm?.validity_days ? `Valid for ${confirm.validity_days} days after issue.` : ''}
        </p>
        {confirm?.terms && <p className="mt-2 text-xs text-text-subtle">{confirm.terms}</p>}
        {err && <Alert tone="danger" className="mt-3">{err}</Alert>}
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={redeem} loading={busy}>
            Confirm redemption
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}

const STATUS_TEXT: Record<string, string> = { issued: 'Ready to use', pending: 'Issuing…', retrying: 'Issuing…', failed: 'Delayed — we’re on it', redeemed: 'Used', expired: 'Expired', cancelled: 'Cancelled' };

function Wallet() {
  const { data, error, loading, reload } = useApi<{ items: WalletItem[] }>('/me/rewards');
  const [show, setShow] = useState<WalletItem | null>(null);
  useEffect(() => {
    const pending = data?.items.some((i) => i.status === 'pending' || i.status === 'retrying');
    if (!pending) return;
    const t = window.setTimeout(() => void reload(), 4000);
    return () => window.clearTimeout(t);
  }, [data, reload]);
  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} retry={reload} />;
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No rewards yet" description="Play games, check in and complete missions to win rewards." />;
  return (
    <>
      <ul className="space-y-3">
        {items.map((r) => {
          const usable = r.status === 'issued' && (r.voucher_code || r.claim_token);
          return (
            <li key={r.id}>
              <Card className={cn('p-4', ['redeemed', 'expired', 'cancelled'].includes(r.status) && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-text-muted">
                      {r.ref} · {formatDate(r.created_at)}
                      {r.expires_at && r.status === 'issued' ? ` · expires ${formatDate(r.expires_at)}` : ''}
                    </p>
                  </div>
                  <Badge tone={r.status === 'issued' ? 'success' : r.status === 'failed' ? 'warning' : 'neutral'}>{STATUS_TEXT[r.status] ?? r.status}</Badge>
                </div>
                {r.type === 'capillary_points' && <p className="mt-2 text-sm">{r.status === 'issued' ? `${r.points} Suntec+ Points credited to your Suntec+ account.` : `${r.points} Suntec+ Points are being credited.`}</p>}
                {r.collect_at && r.status === 'issued' && <p className="mt-2 text-sm">Collect at {r.collect_at}</p>}
                {usable && (
                  <Button size="sm" className="mt-3" onClick={() => setShow(r)}>
                    {r.voucher_code ? 'Show code' : 'Show claim QR'}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <Dialog open={Boolean(show)} title={show?.name ?? ''} onClose={() => setShow(null)}>
        {show && <RewardCode item={show} />}
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setShow(null)}>
          Close
        </Button>
      </Dialog>
    </>
  );
}

function RewardCode({ item }: { item: WalletItem }) {
  const [src, setSrc] = useState<string | null>(null);
  const value = item.voucher_code ?? item.claim_token ?? '';
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 360, color: { dark: '#1F2937', light: '#FFFFFF' } }).then(setSrc, () => setSrc(null));
  }, [value]);
  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={`QR code for ${item.voucher_code ? 'voucher code' : 'claim code'} ${value}`} className="h-52 w-52" />}
      <code className="rounded bg-surface-sunken px-3 py-1.5 font-mono text-lg font-semibold tracking-wider">{value}</code>
      <p className="text-xs text-text-muted">{item.voucher_code ? 'Show this at the counter.' : 'Show this at the Concierge to collect.'}</p>
      {item.terms && <p className="text-xs text-text-subtle">{item.terms}</p>}
      <p className="text-xs text-text-muted">{rewardLine({ ...item, amount: item.points })}</p>
    </div>
  );
}

/* ============================== Badges ============================== */
type BadgeItem = { id: string; name: string; description: string; icon: string | null; tier: string; earned: boolean; awarded_at: string | null; progress: { current: number; target: number } | null };
const TIER_STYLE: Record<string, string> = { bronze: 'bg-[#f3e1d1] text-[#7c4a1e]', silver: 'bg-[#eceff3] text-[#374151]', gold: 'bg-[#fdf0c4] text-[#7a5a00]', platinum: 'bg-[#e6e3f5] text-[#3f3a73]' };

export function BadgesScreen() {
  const { data, error, loading, reload } = useApi<{ items: BadgeItem[] }>('/badges');
  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} retry={reload} />;
  const items = data?.items ?? [];
  const earned = items.filter((b) => b.earned).length;
  return (
    <>
      <Title sub={`${earned} of ${items.length} unlocked`}>Badges</Title>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((b) => (
          <li key={b.id}>
            <Card className={cn('flex h-full flex-col items-center p-4 text-center', !b.earned && 'bg-surface-muted')}>
              <span className={cn('flex h-16 w-16 items-center justify-center rounded-full text-2xl', b.earned ? TIER_STYLE[b.tier] : 'bg-surface-sunken grayscale')} aria-hidden="true">
                {b.earned ? '🏅' : '🔒'}
              </span>
              <p className="mt-2 font-semibold">{b.name}</p>
              <p className="text-xs text-text-muted">{b.description}</p>
              <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">{b.tier}</span>
              {b.earned ? (
                <p className="mt-2 text-xs text-success">Unlocked {formatDate(b.awarded_at)}</p>
              ) : b.progress ? (
                <div className="mt-2 w-full">
                  <ProgressBar value={b.progress.current} max={b.progress.target} label={`${b.name} progress`} />
                  <p className="mt-1 text-[11px] text-text-muted">
                    {b.progress.current.toLocaleString()} / {b.progress.target.toLocaleString()}
                  </p>
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ============================== Leaderboard ============================== */
type Board = { id: string; name: string; description: string; periods: string[] };
type BoardView = { board: Board & { prize_rules: { period: string; rank_from: number; rank_to: number }[] }; period: string; period_key: string; entries: { rank: number; name: string; score: number; is_me: boolean }[]; me: { rank: number; score: number } | null };

export function LeaderboardScreen() {
  const { base } = usePlay();
  const boards = useApi<{ items: Board[] }>('/leaderboards');
  const [boardId, setBoardId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const id = boardId ?? boards.data?.items[0]?.id ?? null;
  const view = useApi<BoardView>(id ? `/leaderboards/${id}${period ? `?period=${period}` : ''}` : null);
  if (boards.loading && !boards.data) return <LoadingBlock />;
  if (boards.error) return <ErrorBlock error={boards.error} retry={boards.reload} />;
  if (!boards.data?.items.length) return <EmptyState title="No leaderboards yet" />;
  const v = view.data;
  return (
    <>
      <Title sub="Names are masked to protect your privacy.">Leaderboard</Title>
      {boards.data.items.length > 1 && (
        <Field id="board" label="Leaderboard" className="mb-3 max-w-xs">
          <Select id="board" value={id ?? ''} onChange={(e) => { setBoardId(e.target.value); setPeriod(null); }}>
            {boards.data.items.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {v && (
        <Tabs
          label="Period"
          value={v.period}
          onChange={(p) => setPeriod(p)}
          items={v.board.periods.map((p) => ({ value: p, label: p === 'overall' ? 'All time' : p[0]!.toUpperCase() + p.slice(1) }))}
        />
      )}
      {view.loading && !v ? (
        <LoadingBlock />
      ) : view.error ? (
        <ErrorBlock error={view.error} retry={view.reload} />
      ) : v ? (
        <>
          {v.me ? (
            <Card className="mb-3 flex items-center justify-between bg-primary-subtle p-4">
              <span className="font-medium">Your rank</span>
              <span className="text-lg font-bold text-primary-subtle-fg">
                #{v.me.rank} · {Number(v.me.score).toLocaleString()}
              </span>
            </Card>
          ) : (
            <p className="mb-3 text-sm text-text-muted">Play to get on the board this period.</p>
          )}
          {v.board.prize_rules?.filter((p) => p.period === v.period).map((p) => (
            <p key={`${p.rank_from}-${p.rank_to}`} className="mb-2 text-xs text-text-muted">
              🏆 Prizes for ranks {p.rank_from}–{p.rank_to} at the end of the period.
            </p>
          ))}
          {v.entries.length === 0 ? (
            <EmptyState title="No scores yet this period" description="Be the first!" />
          ) : (
            <Card className="p-0">
              <ol aria-label={`${v.board.name} ranking`} className="divide-y divide-border">
                {v.entries.map((e) => (
                  <li key={e.rank} className={cn('flex items-center gap-3 px-4 py-2.5', e.is_me && 'bg-primary-subtle font-semibold')}>
                    <span className={cn('w-8 text-center font-bold', e.rank <= 3 ? 'text-primary' : 'text-text-muted')}>{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
                    <span className="flex-1">
                      {e.name}
                      {e.is_me && ' (you)'}
                    </span>
                    <span className="tabular-nums">{Number(e.score).toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <p className="mt-3 text-xs text-text-muted">
            Prefer a nickname or to stay off the board? <Link href={`${base}/profile`} className="font-medium text-primary hover:underline">Privacy settings</Link>
          </p>
        </>
      ) : null}
    </>
  );
}

/* ============================== Inbox ============================== */
type Note = { id: string; title: string; body: string; deep_link: string | null; read_at: string | null; created_at: string };

export function InboxScreen() {
  const { base, refreshBalance } = usePlay();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ items: Note[]; unread: number }>('/notifications');
  async function markAll() {
    await api('/notifications/read', { method: 'POST', json: { all: true } }).catch(() => undefined);
    await reload();
    refreshBalance();
  }
  async function open(n: Note) {
    if (!n.read_at) await api('/notifications/read', { method: 'POST', json: { ids: [n.id] } }).catch(() => undefined);
    refreshBalance();
    router.push(deepLinkToPath(n.deep_link, base));
  }
  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} retry={reload} />;
  const items = data?.items ?? [];
  return (
    <>
      <div className="flex items-start justify-between">
        <Title>Inbox</Title>
        {data && data.unread > 0 && (
          <Button size="sm" variant="ghost" onClick={markAll}>
            Mark all read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState title="No messages yet" description="Wins, mission updates and reminders will appear here." />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                <Card className={cn('p-4 hover:shadow-md', !n.read_at && 'border-l-4 border-l-primary')}>
                  <div className="flex justify-between gap-2">
                    <p className={cn('font-medium', !n.read_at && 'font-semibold')}>
                      {!n.read_at && <span className="sr-only">Unread: </span>}
                      {n.title}
                    </p>
                    <span className="shrink-0 text-xs text-text-subtle">{formatDateTime(n.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-text-muted">{n.body}</p>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ============================== History ============================== */
type History = { sessions: { id: string; ref: string; game_name: string; won: boolean; result: string; reward_name: string | null; payment_source: string; started_at: string }[]; ledger: { id: string; delta: number; balance_after: number; reason: string; note: string | null; created_at: string }[] };

export function HistoryScreen() {
  const [tab, setTab] = useState<'plays' | 'points'>('plays');
  const { data, error, loading, reload } = useApi<History>('/me/history');
  return (
    <>
      <Title>Activity</Title>
      <Tabs label="Activity" value={tab} onChange={setTab} items={[{ value: 'plays', label: 'Plays' }, { value: 'points', label: 'Play Points' }]} />
      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} retry={reload} />
      ) : tab === 'plays' ? (
        data?.sessions.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{s.game_name}</p>
                  <p className="text-xs text-text-muted">
                    {formatDateTime(s.started_at)} · {s.ref}
                  </p>
                </div>
                <span className={s.won ? 'font-semibold text-success' : 'text-text-muted'}>{s.reward_name ?? s.result}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No plays yet" />
        )
      ) : data?.ledger.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data.ledger.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{l.note ?? l.reason.replace(/_/g, ' ')}</p>
                <p className="text-xs text-text-muted">{formatDateTime(l.created_at)}</p>
              </div>
              <span className={l.delta > 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No Play Points activity yet" />
      )}
    </>
  );
}

/* ============================== Profile ============================== */
export function ProfileScreen() {
  const { base, mode, refreshBalance } = usePlay();
  const router = useRouter();
  const signOut =
    mode === 'portal'
      ? async () => {
          await createSupabaseBrowserClient().auth.signOut();
          router.replace('/portal/login');
          router.refresh();
        }
      : undefined;
  const { data, error, loading, reload, setData } = useApi<Summary>('/me');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [haptics, setHaptics] = useState(() => {
    try {
      return typeof window === 'undefined' || localStorage.getItem('sp_haptics') !== 'off';
    } catch {
      return true;
    }
  });
  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock error={error} retry={reload} />;
  const p = data.preferences;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setMsg({});
    try {
      const nickname = String(fd.get('lb_nickname') ?? '').trim();
      const s = await api<Summary>('/me/preferences', {
        method: 'PATCH',
        json: {
          lb_display_mode: fd.get('lb_display_mode'),
          lb_nickname: nickname || null,
          lb_opt_out: fd.get('lb_opt_out') === 'on',
          notify_push: fd.get('notify_push') === 'on',
          notify_email: fd.get('notify_email') === 'on',
        },
      });
      setData(s);
      refreshBalance();
      setMsg({ ok: 'Preferences saved.' });
    } catch (e2) {
      setMsg({ err: (e2 as ApiError).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Title sub={`Suntec+ ${data.member.tier} member · ${data.member.suntec_member_id}`}>
        {data.member.first_name} {data.member.last_name}
      </Title>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Play Points', data.pp_balance.toLocaleString()],
          ['Games played', data.stats.games_played],
          ['Check-ins', data.stats.checkins_total],
          ['Badges', data.stats.badges],
        ].map(([k, v]) => (
          <Card key={String(k)} className="p-3 text-center">
            <p className="text-xl font-bold">{v}</p>
            <p className="text-xs text-text-muted">{k}</p>
          </Card>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-sm">
        <Link className="font-medium text-primary hover:underline" href={`${base}/history`}>
          Activity history
        </Link>
        <Link className="font-medium text-primary hover:underline" href={`${base}/badges`}>
          Badges
        </Link>
      </div>
      <Card className="mt-6">
        <form onSubmit={save} className="space-y-4">
          <h2 className="text-base font-semibold">Leaderboard privacy</h2>
          <Field id="lb_display_mode" label="Show me on leaderboards as">
            <Select id="lb_display_mode" name="lb_display_mode" defaultValue={p.lb_display_mode}>
              <option value="masked">Masked name (e.g. T*** K.)</option>
              <option value="nickname">My nickname</option>
              <option value="hidden">Hidden</option>
            </Select>
          </Field>
          <Field id="lb_nickname" label="Nickname" help="2–24 letters, numbers, spaces, dots, dashes or underscores.">
            <Input id="lb_nickname" name="lb_nickname" defaultValue={p.lb_nickname ?? ''} maxLength={24} />
          </Field>
          <Checkbox name="lb_opt_out" label="Don’t show me on any leaderboard" defaultChecked={p.lb_opt_out} />
          <h2 className="pt-2 text-base font-semibold">Notifications</h2>
          <Checkbox name="notify_push" label="Push notifications for wins, missions and reminders" defaultChecked={p.notify_push} />
          <Checkbox name="notify_email" label="Email updates" defaultChecked={p.notify_email} />
          <Checkbox
            name="haptics"
            label="Vibration feedback on this device"
            checked={haptics}
            onChange={(e) => {
              setHaptics(e.target.checked);
              try {
                localStorage.setItem('sp_haptics', e.target.checked ? 'on' : 'off');
              } catch {
                /* ignore */
              }
            }}
          />
          {msg.ok && <Alert tone="success">{msg.ok}</Alert>}
          {msg.err && <Alert tone="danger">{msg.err}</Alert>}
          <Button type="submit" loading={saving}>
            Save preferences
          </Button>
        </form>
      </Card>
      <Card className="mt-4">
        <h2 className="text-base font-semibold">Visit {SUNTEC.mallName}</h2>
        <p className="mt-1 text-sm">{SUNTEC.address}</p>
        <p className="text-sm text-text-muted">{SUNTEC.openingHours}</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
          {[
            ['Getting here', SUNTEC.links.gettingHere],
            ['FAQ', SUNTEC.links.faq],
            ['Chat with us', SUNTEC.links.chat],
            ['About Suntec+', SUNTEC.links.aboutSuntecPlus],
          ].map(([label, href]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-6 text-xs text-text-muted">
        Your Suntec+ loyalty points and vouchers remain in your Suntec+ account. Play &amp; Win keeps only the data needed to run games and rewards, in line with the PDPA. See the{' '}
        <a href={SUNTEC.links.terms} target="_blank" rel="noopener noreferrer" className="underline">
          Terms and Conditions
        </a>{' '}
        and{' '}
        <a href={SUNTEC.links.privacy} target="_blank" rel="noopener noreferrer" className="underline">
          Privacy Policy
        </a>
        .
      </p>
      {signOut && (
        <Button variant="secondary" className="mt-4" onClick={signOut}>
          Sign out
        </Button>
      )}
    </>
  );
}

/* ============================== QR scan ============================== */
type ScanResult = { purpose: string; label: string; location: string; result: { checkin?: { checked_in: boolean; already: boolean; streak: number; rewards: { name: string }[] }; missions?: { title: string; rewards: string }[] } };

export function extractQrToken(text: string): string {
  const t = text.trim();
  const m = t.match(/\/q\/([^/?#\s]+)/);
  return decodeURIComponent(m?.[1] ?? t);
}

export function ScanScreen({ initialToken }: { initialToken?: string }) {
  const { refreshBalance } = usePlay();
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'idle' | 'on' | 'unsupported' | 'denied'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const started = useRef(false);

  async function submit(raw: string) {
    const token = extractQrToken(raw);
    if (token.length < 8) {
      setErr('That doesn’t look like a Play & Win code.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ScanResult>('/qr/scan', { method: 'POST', json: { token } });
      haptic('success');
      refreshBalance();
      setResult(r);
    } catch (e) {
      setErr((e as ApiError).message);
      haptic('warning');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialToken && !started.current) {
      started.current = true;
      void submit(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  async function startCamera() {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      setCamera('on');
      const detector = new Detector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!v.srcObject) return;
        const codes = await detector.detect(v).catch(() => []);
        if (codes[0]?.rawValue) {
          stream.getTracks().forEach((t) => t.stop());
          v.srcObject = null;
          setCamera('idle');
          void submit(codes[0].rawValue);
          return;
        }
        requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      setCamera('denied');
    }
  }

  useEffect(() => () => {
    const v = video.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <>
      <Title sub="Scan Play & Win QR codes at the Concierge, events and around the mall.">Scan QR</Title>
      {result ? (
        <Card className="space-y-3 p-5 text-center">
          <p className="text-4xl" aria-hidden="true">
            📍
          </p>
          <h2 className="text-xl font-bold" aria-live="polite">
            {result.result.checkin ? (result.result.checkin.already ? 'Already checked in today' : `Checked in! ${result.result.checkin.streak}-day streak`) : `Scanned: ${result.label}`}
          </h2>
          {result.location && <p className="text-sm text-text-muted">{result.location}</p>}
          {result.result.checkin?.rewards?.length ? <p className="font-medium text-primary">{result.result.checkin.rewards.map((r) => r.name).join(' + ')}</p> : null}
          {result.result.missions?.length ? (
            <ul className="text-sm">
              {result.result.missions.map((m, i) => (
                <li key={i}>✅ Mission complete: {m.title}</li>
              ))}
            </ul>
          ) : (
            !result.result.checkin && <p className="text-sm text-text-muted">Visit recorded — it counts towards your missions.</p>
          )}
          <Button variant="secondary" onClick={() => setResult(null)}>
            Scan another
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <video ref={video} className={cn('w-full rounded-lg bg-black', camera !== 'on' && 'hidden')} playsInline muted aria-label="Camera preview" />
            {camera !== 'on' && (
              <Button onClick={startCamera} className="w-full">
                Open camera
              </Button>
            )}
            {camera === 'unsupported' && <Alert tone="info">Your browser can’t scan QR codes here. Use your phone camera app, or type the code below.</Alert>}
            {camera === 'denied' && <Alert tone="warning">Camera access was blocked. Allow camera access, or type the code below.</Alert>}
          </Card>
          <Card className="p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(code);
              }}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <Field id="code" label="Or enter the code" className="flex-1">
                <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" placeholder="DEMO-CONCIERGE-CHECKIN-T3" />
              </Field>
              <Button type="submit" loading={busy}>
                Submit
              </Button>
            </form>
          </Card>
          {err && <Alert tone="danger">{err}</Alert>}
        </div>
      )}
    </>
  );
}

