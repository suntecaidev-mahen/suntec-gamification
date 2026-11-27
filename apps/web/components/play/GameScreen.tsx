'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, ProgressBar } from '@suntec/ui';
import { api, emitBridge, haptic, newIdempotencyKey, prefersReducedMotion, usePlay, useApi, type ApiError } from './client';
import { ErrorBlock, LoadingBlock, ResultDialog } from './bits';
import { Wheel, rotationForSegment } from './Wheel';
import { availabilityLabel } from './HomeScreen';
import type { Availability, GameDetail, Session } from './types';

export function GameScreen({ id, initial }: { id: string; initial?: GameDetail | null }) {
  const { base } = usePlay();
  const { data, error, loading, reload } = useApi<GameDetail>(`/games/${id}`, initial);
  if (loading && !data) return <LoadingBlock lines={3} />;
  if (error && !data) return <ErrorBlock error={error} retry={reload} />;
  if (!data) return null;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={base} className="text-sm font-medium text-primary hover:underline">
        ← Back
      </Link>
      <header>
        <h1 className="text-2xl font-bold">{data.name}</h1>
        {data.campaign && <p className="text-sm text-text-muted">{data.campaign.name}</p>}
      </header>
      {data.type === 'spin_wheel' && <SpinGame game={data} onPlayed={reload} />}
      {data.type === 'scratch_card' && <ScratchGame game={data} onPlayed={reload} />}
      {data.type === 'quiz' && <QuizGame game={data} onPlayed={reload} />}
      <details className="rounded-lg border border-border bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium">How to play &amp; terms</summary>
        <p className="mt-2 whitespace-pre-line text-text-muted">{data.rules_text}</p>
        {data.campaign?.terms && <p className="mt-2 whitespace-pre-line text-xs text-text-subtle">{data.campaign.terms}</p>}
      </details>
    </div>
  );
}

function playLabel(a: Availability, verb: string): string {
  if (a.free_left > 0) return `${verb} — free`;
  if (a.attempts > 0) return `${verb} — use bonus play`;
  return verb;
}

function AvailabilityNote({ a }: { a: Availability }) {
  return (
    <p className="text-center text-sm text-text-muted" aria-live="polite">
      {availabilityLabel(a)}
      {a.reason === 'no_attempts' ? ' · Earn extra plays from missions and check-in streaks' : ''}
    </p>
  );
}

/** Shared "start a play" call with an idempotency key per tap. */
function usePlayStart(gameId: string) {
  const { refreshBalance } = usePlay();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = useCallback(async (): Promise<Session | null> => {
    setBusy(true);
    setErr(null);
    try {
      const s = await api<Session>(`/games/${gameId}/play`, { method: 'POST', json: { payment: 'auto' }, idempotencyKey: newIdempotencyKey() });
      refreshBalance();
      emitBridge('balance_changed');
      return s;
    } catch (e) {
      setErr((e as ApiError).message);
      haptic('warning');
      return null;
    } finally {
      setBusy(false);
    }
  }, [gameId, refreshBalance]);
  return { start, busy, err };
}

/* ---------------------------------------------------------------------------
 * Spin & Win: the result comes from the server; the wheel just animates to it.
 * ------------------------------------------------------------------------ */
function SpinGame({ game, onPlayed }: { game: GameDetail; onPlayed: () => void }) {
  const { base } = usePlay();
  const { start, busy, err } = usePlayStart(game.id);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Session | null>(null);
  const [announce, setAnnounce] = useState('');
  const [landed, setLanded] = useState<number | null>(null);
  const spins = useRef(0);
  const segs = game.outcomes.map((o) => ({ label: o.label, color: o.display.color, text_color: o.display.text_color }));
  const duration = prefersReducedMotion() ? 0 : (game.config.spin_duration_ms ?? 4500);

  async function spin() {
    setLanded(null);
    const s = await start();
    if (!s) return;
    haptic('light');
    // The server already decided the outcome; the wheel stops with that segment under the pointer.
    const idx = Math.max(game.outcomes.findIndex((o) => o.position === s.outcome.position), 0);
    spins.current += 1;
    const target = rotationForSegment(idx, segs.length, 6 * spins.current, Math.random() - 0.5);
    setSpinning(true);
    setAnnounce('Spinning…');
    setRotation(target);
    window.setTimeout(() => {
      // Wheel stopped: light up the segment under the pointer, then show the result.
      setSpinning(false);
      setLanded(idx);
      const won = Boolean(s.outcome.won);
      setAnnounce(won ? `The wheel stopped on ${segs[idx]?.label}. You won ${s.outcome.reward?.name}!` : `The wheel stopped on ${segs[idx]?.label}. No prize this time.`);
      if (won) {
        haptic('success');
        emitBridge('reward_won', { reward: s.outcome.reward?.name, type: s.outcome.reward?.type, ref: s.ref });
      }
      window.setTimeout(() => setResult(s), duration ? 1100 : 0);
    }, duration + 100);
  }

  return (
    <Card className="flex flex-col items-center gap-4 p-5">
      <Wheel segments={segs} rotation={rotation} durationMs={duration} size={340} highlight={spinning ? null : landed} />
      {landed !== null && !spinning && (
        <p className="text-center text-sm font-semibold text-brand-navy" aria-hidden="true">
          ▲ {segs[landed]?.label}
        </p>
      )}
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>
      <Button size="lg" className="w-full max-w-xs" onClick={spin} loading={busy} disabled={spinning || !game.availability.can_play}>
        {spinning ? 'Spinning…' : playLabel(game.availability, 'Spin')}
      </Button>
      <AvailabilityNote a={game.availability} />
      {err && <Alert tone="danger">{err}</Alert>}
      <ResultDialog
        open={Boolean(result)}
        won={Boolean(result?.outcome.won)}
        title={result?.outcome.won ? 'You won!' : (result?.outcome.label ?? 'Try again')}
        reward={result?.outcome.reward}
        base={base}
        onClose={() => {
          setResult(null);
          onPlayed();
        }}
      />
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * Scratch & Win: the prize is decided when the card is issued; scratching reveals it.
 * ------------------------------------------------------------------------ */
function ScratchGame({ game, onPlayed }: { game: GameDetail; onPlayed: () => void }) {
  const { base } = usePlay();
  const { start, busy, err } = usePlayStart(game.id);
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const threshold = game.config.reveal_threshold ?? 0.6;

  useEffect(() => {
    if (!session || revealed) return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    ctx.scale(ratio, ratio);
    const g = ctx.createLinearGradient(0, 0, c.offsetWidth, c.offsetHeight);
    g.addColorStop(0, '#C2410C');
    g.addColorStop(1, '#F97316');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.offsetWidth, c.offsetHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scratch here ✨', c.offsetWidth / 2, c.offsetHeight / 2 + 6);
    ctx.globalCompositeOperation = 'destination-out';
  }, [session, revealed]);

  const finish = useCallback(() => {
    setRevealed(true);
    setShowResult(true);
    if (session?.outcome.won) {
      haptic('success');
      emitBridge('reward_won', { reward: session.outcome.reward?.name, type: session.outcome.reward?.type, ref: session.ref });
    }
  }, [session]);

  function scratch(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || revealed) return;
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const r = c.getBoundingClientRect();
    ctx.beginPath();
    ctx.arc(e.clientX - r.left, e.clientY - r.top, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  function checkCleared() {
    const c = canvas.current;
    if (!c || revealed) return;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let clear = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i] === 0) clear++;
    if (clear / (data.length / (4 * 16)) >= threshold) finish();
  }

  async function newCard() {
    const s = await start();
    if (!s) return;
    setRevealed(false);
    setShowResult(false);
    setSession(s);
  }

  return (
    <Card className="flex flex-col items-center gap-4 p-5">
      {session ? (
        <div className="relative aspect-[3/2] w-full max-w-sm overflow-hidden rounded-xl border-4 border-brand-700 bg-brand-50">
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <span className="text-4xl" aria-hidden="true">
              {session.outcome.won ? '🎁' : '🍀'}
            </span>
            <p className="mt-2 text-xl font-bold text-brand-800">{session.outcome.won ? session.outcome.reward?.name : session.outcome.label}</p>
          </div>
          {!revealed && (
            <canvas
              ref={canvas}
              className="absolute inset-0 h-full w-full touch-none"
              aria-label="Scratch card. Use the Reveal button if you cannot scratch."
              onPointerDown={(e) => {
                drawing.current = true;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                scratch(e);
              }}
              onPointerMove={scratch}
              onPointerUp={() => {
                drawing.current = false;
                checkCleared();
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex aspect-[3/2] w-full max-w-sm items-center justify-center rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 text-center text-sm text-text-muted">
          Get a card, then scratch to reveal your prize.
        </div>
      )}
      <p className="sr-only" aria-live="assertive">
        {revealed && session ? (session.outcome.won ? `You won ${session.outcome.reward?.name}` : 'No prize this time') : ''}
      </p>
      {session && !revealed ? (
        <Button variant="secondary" onClick={finish}>
          Reveal all
        </Button>
      ) : (
        <Button size="lg" className="w-full max-w-xs" onClick={newCard} loading={busy} disabled={!game.availability.can_play}>
          {playLabel(game.availability, session ? 'Another card' : 'Get a card')}
        </Button>
      )}
      <AvailabilityNote a={game.availability} />
      {err && <Alert tone="danger">{err}</Alert>}
      <ResultDialog
        open={showResult}
        won={Boolean(session?.outcome.won)}
        title={session?.outcome.won ? 'You won!' : 'So close!'}
        reward={session?.outcome.reward}
        base={base}
        onClose={() => {
          setShowResult(false);
          onPlayed();
        }}
      />
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * Quiz & Win: timed questions, answers scored on the server.
 * ------------------------------------------------------------------------ */
function QuizGame({ game, onPlayed }: { game: GameDetail; onPlayed: () => void }) {
  const { base, refreshBalance } = usePlay();
  const { start, busy, err } = usePlayStart(game.id);
  const [session, setSession] = useState<Session | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<{ question_id: string; option_id: string | null }[]>([]);
  const [qStart, setQStart] = useState(0);
  const [now, setNow] = useState(0);
  const answered = useRef<Set<string>>(new Set());
  const answerRef = useRef<(optionId: string | null) => void>(() => undefined);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Session | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const questions = session?.questions ?? [];
  const q = questions[index];

  const submit = useCallback(
    async (all: { question_id: string; option_id: string | null }[]) => {
      if (!session) return;
      setSubmitting(true);
      try {
        const r = await api<Session>(`/sessions/${session.id}/answers`, { method: 'POST', json: { answers: all } });
        setResult(r);
        refreshBalance();
        if (r.outcome.won) {
          haptic('success');
          emitBridge('reward_won', { reward: r.outcome.reward?.name, type: r.outcome.reward?.type, ref: r.ref });
        }
      } catch (e) {
        setSubmitErr((e as ApiError).message);
      } finally {
        setSubmitting(false);
      }
    },
    [session, refreshBalance],
  );

  const answer = useCallback(
    (optionId: string | null) => {
      if (!q || answered.current.has(q.id)) return;
      answered.current.add(q.id);
      const next = [...answers, { question_id: q.id, option_id: optionId }];
      setAnswers(next);
      haptic('light');
      if (index + 1 < questions.length) {
        setIndex(index + 1);
        setQStart(Date.now());
        setNow(Date.now());
      } else void submit(next);
    },
    [q, answers, index, questions.length, submit],
  );

  useEffect(() => {
    answerRef.current = answer;
  });

  // Per-question countdown; unanswered questions are submitted as blank when time runs out.
  useEffect(() => {
    if (!q || result) return;
    const limit = qStart + q.time_limit_s * 1000;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n > limit + 250) answerRef.current(null);
    }, 250);
    return () => window.clearInterval(t);
  }, [q, result, qStart]);

  const left = q ? Math.max(0, Math.ceil((qStart + q.time_limit_s * 1000 - now) / 1000)) : 0;

  async function begin() {
    const s = await start();
    if (!s) return;
    answered.current = new Set();
    setSession(s);
    setIndex(0);
    setAnswers([]);
    setResult(null);
    setSubmitErr(null);
    setQStart(Date.now());
    setNow(Date.now());
  }

  if (result) {
    return (
      <Card className="space-y-4 p-5">
        <div className="text-center">
          <p className="text-4xl" aria-hidden="true">
            {result.outcome.passed ? '🏆' : '📚'}
          </p>
          <h2 className="mt-1 text-xl font-bold" aria-live="polite">
            {result.correct_count}/{result.question_count} correct · {result.score} pts
          </h2>
          {result.outcome.speed_bonus ? <p className="text-sm text-text-muted">Includes a speed bonus of {result.outcome.speed_bonus}</p> : null}
        </div>
        <ul className="space-y-2">
          {(result.results ?? []).map((r, i) => (
            <li key={r.question_id} className={`rounded-md border p-3 text-sm ${r.correct ? 'border-success/40 bg-success-subtle' : 'border-danger/30 bg-danger-subtle'}`}>
              <p className="font-medium text-text">
                {i + 1}. {r.text}
              </p>
              <p className={r.correct ? 'text-success' : 'text-danger'}>{r.correct ? '✓ Correct' : `✗ Answer: ${r.correct_option_text}`}</p>
              {r.explanation && <p className="mt-1 text-xs text-text-muted">{r.explanation}</p>}
            </li>
          ))}
        </ul>
        <ResultDialog open={Boolean(result.outcome.won)} won title="You earned a reward!" reward={result.outcome.reward} base={base} onClose={() => setResult({ ...result, outcome: { ...result.outcome, won: false } })} />
        <Button className="w-full" variant="secondary" onClick={() => { setSession(null); setResult(null); onPlayed(); }}>
          Done
        </Button>
      </Card>
    );
  }

  if (session && q) {
    const pct = q.time_limit_s > 0 ? left : 0;
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            Question {index + 1} of {questions.length}
          </span>
          <Badge tone={left <= 5 ? 'danger' : 'brand'} aria-live="off">
            ⏱ {left}s
          </Badge>
        </div>
        <ProgressBar value={pct} max={q.time_limit_s} label="Time left" />
        <h2 className="text-lg font-semibold" aria-live="polite">
          {q.text}
        </h2>
        <ul className="grid gap-2">
          {q.options.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => answer(o.id)}
                className="w-full rounded-lg border-2 border-border bg-surface px-4 py-3 text-left font-medium transition-colors hover:border-primary hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
              >
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-sunken text-xs" aria-hidden="true">
                  {String.fromCharCode(65 + i)}
                </span>
                {o.text}
              </button>
            </li>
          ))}
        </ul>
        {submitting && <p className="text-center text-sm text-text-muted">Scoring your answers…</p>}
        {submitErr && <Alert tone="danger">{submitErr}</Alert>}
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5 text-center">
      <p className="text-5xl" aria-hidden="true">
        🧠
      </p>
      <p className="text-sm text-text-muted">
        {game.config.questions_per_session} questions · {game.config.time_limit_s}s each · pass with {game.config.pass_percent}%
      </p>
      {game.config.reward_tiers && game.config.reward_tiers.length > 0 && (
        <ul className="mx-auto max-w-xs text-left text-sm">
          {game.config.reward_tiers.map((t) => (
            <li key={t.min_correct} className="flex justify-between border-b border-border py-1">
              <span>{t.min_correct}+ correct</span>
              <span className="font-medium text-primary">{t.reward}</span>
            </li>
          ))}
        </ul>
      )}
      <Button size="lg" className="w-full max-w-xs" onClick={begin} loading={busy} disabled={!game.availability.can_play}>
        {playLabel(game.availability, 'Start quiz')}
      </Button>
      <AvailabilityNote a={game.availability} />
      {err && <Alert tone="danger">{err}</Alert>}
    </Card>
  );
}
