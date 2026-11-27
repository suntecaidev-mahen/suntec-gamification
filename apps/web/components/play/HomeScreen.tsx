'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, ProgressBar } from '@suntec/ui';
import { formatDate } from '@suntec/core';
import { api, haptic, emitBridge, usePlay, useApi, type ApiError } from './client';
import { ErrorBlock, JoinCta, LoadingBlock, ResultDialog } from './bits';
import { SUNTEC } from '@/lib/brand';
import type { Availability, CheckinStatus, GameCard, Home } from './types';

const GAME_ICON: Record<string, string> = { spin_wheel: '🎡', scratch_card: '🎟️', quiz: '🧠' };

export function availabilityLabel(a: Availability | null | undefined): string {
  if (!a) return '';
  if (a.reason === 'daily_limit') return 'Daily limit reached';
  if (a.reason === 'cooldown') return `Ready in ${a.cooldown_s}s`;
  if (a.free_left > 0) return `${a.free_left} free play${a.free_left > 1 ? 's' : ''} today`;
  if (a.attempts > 0) return `${a.attempts} bonus play${a.attempts > 1 ? 's' : ''}`;
  return 'No plays left today';
}

export function HomeScreen({ claimed, initial }: { claimed?: string; initial?: Home | null }) {
  const { base, refreshBalance, viewer } = usePlay();
  const { data, error, loading, reload } = useApi<Home>('/home', initial);
  if (loading && !data) return <LoadingBlock lines={4} />;
  if (error && !data) return <ErrorBlock error={error} retry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const inProgress = data.missions.filter((m) => !m.completed).slice(0, 3);
  const claimedPoints = Number(claimed ?? 0);

  return (
    <div className="space-y-6">
      {claimedPoints > 0 && !s.is_guest && (
        <Alert tone="success" title="Your guest winnings are now yours">
          {claimedPoints.toLocaleString()} Suntec+ Points (and any prizes) you won as a guest have been added to your Suntec+ account.
        </Alert>
      )}

      {s.is_guest ? (
        <section aria-labelledby="hello" className="rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 p-5">
          <h1 id="hello" className="text-2xl font-bold">
            Play &amp; win Suntec+ Points 🎉
          </h1>
          <p className="mt-1 text-sm text-text-muted">Spin, scratch and quiz — no sign-up needed to play. Suntec+ members get their points straight into their account.</p>
          {s.held.rewards > 0 ? (
            <div className="mt-4 rounded-lg border border-brand-200 bg-surface p-4">
              <p className="text-sm">You’ve won</p>
              <p className="text-2xl font-bold text-primary">
                {s.held.points > 0 ? `${Number(s.held.points).toLocaleString()} Suntec+ Points` : `${s.held.rewards} prize${s.held.rewards > 1 ? 's' : ''}`}
              </p>
              {s.held.points > 0 && s.held.rewards > 1 && <p className="text-xs text-text-muted">plus other prizes</p>}
              <p className="mt-1 mb-3 text-xs text-text-muted">Saved until {s.claim ? formatDate(s.claim.expires_at) : '30 days from now'}. Join Suntec+ to collect.</p>
              <JoinCta claimCode={viewer.claimCode ?? s.claim?.code ?? null} />
            </div>
          ) : (
            <p className="mt-3 text-sm">
              Already a Suntec+ member?{' '}
              <Link href="/play/signin" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>{' '}
              so your wins go straight to your account.
            </p>
          )}
        </section>
      ) : (
        <section aria-labelledby="hello" className="rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 p-5">
          <h1 id="hello" className="text-2xl font-bold">
            Hi {s.member.first_name ?? 'there'} 👋
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {Number(s.points_won) > 0 ? (
              <>
                You’ve won <strong className="text-text">{Number(s.points_won).toLocaleString()} Suntec+ Points</strong> with Play &amp; Win. Points go straight to your Suntec+ account.
              </>
            ) : (
              'Play games, check in daily and complete missions — every point you win goes straight to your Suntec+ account.'
            )}
          </p>
        </section>
      )}

      {data.checkin && (
        <CheckinCard
          status={data.checkin}
          onDone={() => {
            void reload();
            refreshBalance();
          }}
        />
      )}

      <section aria-labelledby="games-h">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="games-h" className="text-lg font-semibold">
            Play &amp; Win
          </h2>
        </div>
        {data.games.length === 0 ? (
          <Card className="text-sm text-text-muted">No games are running right now. Check back soon!</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.games.map((g) => (
              <li key={g.id}>
                <GameTile game={g} base={base} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="missions-h">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="missions-h" className="text-lg font-semibold">
            Missions
          </h2>
          <Link href={`${base}/missions`} className="text-sm font-medium text-primary hover:underline">
            See all
          </Link>
        </div>
        {inProgress.length === 0 ? (
          <Card className="text-sm text-text-muted">All caught up — new missions are coming.</Card>
        ) : (
          <ul className="space-y-2">
            {inProgress.map((m) => (
              <li key={m.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{m.title}</p>
                    <span className="shrink-0 text-xs text-text-muted">{m.rewards.map((r) => r.name).join(' + ')}</span>
                  </div>
                  <ProgressBar className="mt-3" value={Number(m.progress)} max={Number(m.target)} label={`${m.title} progress`} />
                  <p className="mt-1 text-xs text-text-muted">{progressText(m.objective_type, Number(m.progress), Number(m.target))}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.campaigns.length > 0 && (
        <section aria-labelledby="camp-h">
          <h2 id="camp-h" className="mb-3 text-lg font-semibold">
            Campaigns
          </h2>
          <ul className="space-y-2">
            {data.campaigns.map((c) => (
              <li key={c.id}>
                <Card className="p-4">
                  <p className="font-medium">{c.name}</p>
                  <p className="mt-1 text-sm text-text-muted">{c.description}</p>
                  {c.ends_at && <p className="mt-1 text-xs text-text-subtle">Ends {formatDate(c.ends_at)}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-border pt-4 text-xs text-text-muted">
        <p className="font-medium text-text">{SUNTEC.mallName}</p>
        <p>
          {SUNTEC.address} · {SUNTEC.openingHours}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <a href={SUNTEC.links.gettingHere} target="_blank" rel="noopener noreferrer" className="hover:underline">
            Getting here
          </a>
          <a href={SUNTEC.links.faq} target="_blank" rel="noopener noreferrer" className="hover:underline">
            FAQ
          </a>
          <a href={SUNTEC.links.terms} target="_blank" rel="noopener noreferrer" className="hover:underline">
            Terms
          </a>
          <a href={SUNTEC.links.privacy} target="_blank" rel="noopener noreferrer" className="hover:underline">
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}

export function progressText(type: string, progress: number, target: number): string {
  if (type === 'spend_amount') return `$${(progress / 100).toFixed(2)} of $${(target / 100).toFixed(2)}`;
  return `${Math.min(progress, target)} of ${target}`;
}

function GameTile({ game, base }: { game: GameCard; base: string }) {
  const a = game.availability;
  return (
    <Link href={`${base}/games/${game.id}`} className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <Card className="flex h-full flex-col gap-2 p-4 transition-shadow hover:shadow-md">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-subtle text-2xl" aria-hidden="true">
            {GAME_ICON[game.type] ?? '🎮'}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{game.name}</p>
            {game.campaign_name && <p className="truncate text-xs text-text-muted">{game.campaign_name}</p>}
          </div>
        </div>
        <p className="line-clamp-2 text-sm text-text-muted">{game.description}</p>
        <div className="mt-auto flex items-center justify-between pt-1">
          <Badge tone={a?.can_play ? 'brand' : 'neutral'}>{availabilityLabel(a)}</Badge>
          <span className="text-sm font-semibold text-primary" aria-hidden="true">
            Play →
          </span>
        </div>
      </Card>
    </Link>
  );
}

function CheckinCard({ status, onDone }: { status: CheckinStatus; onDone: () => void }) {
  const { base } = usePlay();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinStatus | null>(null);
  const days = lastSevenDays();
  const done = new Set(status.recent_days);

  async function checkIn() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<CheckinStatus>('/checkin', { method: 'POST', json: {} });
      haptic('success');
      emitBridge('balance_changed');
      setResult(r);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5" aria-labelledby="ci-h">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="ci-h" className="text-lg font-semibold">
            Daily check-in
          </h2>
          <p className="text-sm text-text-muted">
            {status.streak > 0 ? (
              <>
                🔥 <strong className="text-text">{status.streak}-day streak</strong>
                {status.best > status.streak ? ` · best ${status.best}` : ''}
              </>
            ) : (
              'Start a streak today!'
            )}
          </p>
        </div>
        <Button onClick={checkIn} loading={busy} disabled={status.checked_in_today}>
          {status.checked_in_today ? 'Checked in ✓' : 'Check in'}
        </Button>
      </div>
      <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Last 7 days">
        {days.map((d) => (
          <li key={d.key} className="text-center">
            <span
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${done.has(d.key) ? 'bg-primary text-primary-fg' : 'bg-surface-sunken text-text-muted'}`}
              aria-label={`${d.label}: ${done.has(d.key) ? 'checked in' : 'not checked in'}`}
            >
              {done.has(d.key) ? '✓' : d.day}
            </span>
            <span className="mt-1 block text-[10px] text-text-subtle" aria-hidden="true">
              {d.label}
            </span>
          </li>
        ))}
      </ol>
      {status.next_milestone && (
        <p className="mt-3 text-sm">
          <span className="font-medium">{status.next_milestone.days_to_go} more day{status.next_milestone.days_to_go > 1 ? 's' : ''}</span> to unlock <span className="font-semibold text-primary">{status.next_milestone.label}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-text-muted">
        Tip: scan a Play &amp; Win QR at the Concierge for {status.qr_multiplier}× check-in points. <Link href={`${base}/scan`} className="font-medium text-primary hover:underline">Scan QR</Link>
      </p>
      {err && <Alert tone="danger" className="mt-3">{err}</Alert>}
      <ResultDialog
        open={Boolean(result)}
        won={Boolean(result?.rewards?.length)}
        title={result?.already ? 'Already checked in today' : `Day ${result?.streak ?? ''} — nice!`}
        reward={result?.rewards?.[0] ?? null}
        base={base}
        extra={
          result?.rewards && result.rewards.length > 1 ? (
            <ul className="mt-2 text-sm">
              {result.rewards.slice(1).map((r) => (
                <li key={r.id}>+ {r.name}</li>
              ))}
            </ul>
          ) : null
        }
        onClose={() => {
          setResult(null);
          onDone();
        }}
      />
    </Card>
  );
}

function lastSevenDays() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
  const wd = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short' });
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = fmt.format(d);
    return { key, day: Number(key.slice(8)), label: i === 6 ? 'Today' : wd.format(d) };
  });
}
