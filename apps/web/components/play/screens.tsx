'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, ProgressBar, cn } from '@suntec/ui';
import { formatDate } from '@suntec/core';
import { api, emitBridge, haptic, usePlay, useApi, type ApiError } from './client';
import { Dialog, ErrorBlock, JoinCta, LoadingBlock, rewardLine } from './bits';
import { progressText } from './HomeScreen';
import type { Mission } from './types';

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-text-muted">{sub}</p>}
    </header>
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
      <Title sub="Complete missions to earn Suntec+ Points, bonus plays and prizes.">Missions</Title>
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

/* ============================== My rewards ============================== */
type WalletItem = { id: string; ref: string; type: string; name: string; description: string; terms: string; points: number | null; collect_at: string | null; source: string; status: string; voucher_code: string | null; claim_token: string | null; expires_at: string | null; created_at: string };

const STATUS_TEXT: Record<string, string> = {
  held: 'Saved — join to collect',
  issued: 'Ready',
  pending: 'Adding…',
  retrying: 'Adding…',
  failed: 'Delayed — we’re on it',
  redeemed: 'Used',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export function MyRewardsScreen() {
  const { viewer } = usePlay();
  const { data, error, loading, reload } = useApi<{ items: WalletItem[] }>('/me/rewards');
  const [show, setShow] = useState<WalletItem | null>(null);
  useEffect(() => {
    const pending = data?.items.some((i) => i.status === 'pending' || i.status === 'retrying');
    if (!pending) return;
    const t = window.setTimeout(() => void reload(), 4000);
    return () => window.clearTimeout(t);
  }, [data, reload]);

  const items = data?.items ?? [];
  const heldPoints = items.filter((i) => i.status === 'held').reduce((n, i) => n + (i.points ?? 0), 0);
  const heldCount = items.filter((i) => i.status === 'held').length;

  return (
    <>
      <Title sub={viewer.guest ? 'Everything you win is saved here for 30 days.' : 'Suntec+ Points go straight to your Suntec+ account. Vouchers and gifts are kept here.'}>My rewards</Title>

      {viewer.guest && heldCount > 0 && (
        <Card className="mb-4 border-brand-200 bg-primary-subtle p-5">
          <p className="text-sm">Waiting to be collected</p>
          <p className="text-2xl font-bold text-primary">{heldPoints > 0 ? `${heldPoints.toLocaleString()} Suntec+ Points` : `${heldCount} prize${heldCount > 1 ? 's' : ''}`}</p>
          {heldPoints > 0 && heldCount > 1 && <p className="text-xs text-text-muted">plus other prizes</p>}
          <div className="mt-4">
            <JoinCta claimCode={viewer.claimCode} />
          </div>
        </Card>
      )}

      {!viewer.guest && <ClaimCodeForm onClaimed={reload} />}

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} retry={reload} />
      ) : items.length === 0 ? (
        <EmptyState title="No rewards yet" description="Play games, check in and complete missions to win Suntec+ Points and prizes." />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const usable = r.status === 'issued' && (r.voucher_code || r.claim_token);
            return (
              <li key={r.id}>
                <Card className={cn('p-4', ['redeemed', 'expired', 'cancelled'].includes(r.status) && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{r.type === 'capillary_points' && r.points ? `${r.points.toLocaleString()} Suntec+ Points` : r.name}</p>
                      <p className="text-xs text-text-muted">
                        {formatDate(r.created_at)}
                        {r.expires_at && ['issued', 'held'].includes(r.status) ? ` · ${r.status === 'held' ? 'saved until' : 'expires'} ${formatDate(r.expires_at)}` : ''}
                      </p>
                    </div>
                    <Badge tone={r.status === 'issued' ? 'success' : r.status === 'held' ? 'brand' : r.status === 'failed' ? 'warning' : 'neutral'}>{STATUS_TEXT[r.status] ?? r.status}</Badge>
                  </div>
                  {r.type === 'capillary_points' && r.status !== 'held' && (
                    <p className="mt-2 text-sm text-text-muted">{r.status === 'issued' ? 'Added to your Suntec+ account.' : 'Being added to your Suntec+ account.'}</p>
                  )}
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
      )}
      <Dialog open={Boolean(show)} title={show?.name ?? ''} onClose={() => setShow(null)}>
        {show && <RewardCode item={show} />}
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setShow(null)}>
          Close
        </Button>
      </Dialog>
    </>
  );
}

/** Members: collect winnings from guest play on another device with the claim code. */
function ClaimCodeForm({ onClaimed }: { onClaimed: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      const r = await api<{ already: boolean; rewards: number; points: number }>('/claims', { method: 'POST', json: { code } });
      haptic('success');
      emitBridge('balance_changed');
      setMsg({
        ok: r.already
          ? 'You have already collected these winnings.'
          : r.rewards === 0
            ? 'Done — there were no saved winnings on this code.'
            : `Collected! ${Number(r.points) > 0 ? `${Number(r.points).toLocaleString()} Suntec+ Points are being added to your account` : 'Your prizes are now in My rewards'}.`,
      });
      setCode('');
      onClaimed();
    } catch (err) {
      setMsg({ err: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mb-4 text-sm font-medium text-primary hover:underline">
        Played as a guest? Enter your claim code
      </button>
    );
  }
  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <Field id="claim" label="Claim code" help="The 8-character code shown when you won as a guest, e.g. 7K3M-Q9XD." className="flex-1">
          <Input id="claim" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" maxLength={9} placeholder="XXXX-XXXX" className="font-mono tracking-widest" />
        </Field>
        <Button type="submit" loading={busy} disabled={code.replace(/[^A-Z0-9]/gi, '').length !== 8}>
          Collect
        </Button>
      </form>
      {msg.ok && <Alert tone="success" className="mt-3">{msg.ok}</Alert>}
      {msg.err && <Alert tone="danger" className="mt-3">{msg.err}</Alert>}
    </Card>
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

