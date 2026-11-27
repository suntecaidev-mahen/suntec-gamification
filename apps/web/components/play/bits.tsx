'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, Button, Skeleton } from '@suntec/ui';
import type { ApiError } from './client';
import type { RewardView } from './types';

export function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, retry }: { error: ApiError | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title="We couldn’t load this">
      <p>{error.message}</p>
      {retry && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={retry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}

/** Lightweight CSS confetti; hidden for reduced-motion users. */
export function Confetti() {
  const colors = ['#F97316', '#C2410C', '#FED7AA', '#FB923C', '#FFFFFF', '#9A3412'];
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden">
      {Array.from({ length: 40 }).map((_, i) => (
        <span
          key={i}
          className="sp-confetti absolute top-[-10px] block h-2.5 w-1.5 rounded-sm"
          style={{ left: `${(i * 97) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 10) * 0.08}s`, animationDuration: `${1.6 + (i % 5) * 0.25}s` }}
        />
      ))}
    </div>
  );
}

/** Accessible modal dialog (focus moves in, Escape closes, focus returns). */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        tabIndex={-1}
        className="sp-pop w-full max-w-sm rounded-xl bg-surface p-6 text-center shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dlg-title" className="text-xl font-bold">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function rewardLine(r: RewardView | null | undefined): string {
  if (!r) return '';
  if (r.type === 'play_points') return `${r.amount ?? ''} Play Points added to your balance.`;
  if (r.type === 'bonus_attempt') return 'A bonus play has been added — use it any time.';
  if (r.type === 'capillary_points') return `${r.amount ?? ''} Suntec+ Points are on their way to your Suntec+ account.`;
  if (r.voucher_code) return `Your code: ${r.voucher_code}. Find it any time in My Rewards.`;
  if (r.claim_token) return 'Show the claim code in My Rewards at the Concierge to collect.';
  if (r.status === 'pending') return 'Your voucher is being issued and will appear in My Rewards shortly.';
  return 'Find it in My Rewards.';
}

export function ResultDialog({ open, won, title, reward, onClose, base, extra }: { open: boolean; won: boolean; title: string; reward?: RewardView | null; onClose: () => void; base: string; extra?: ReactNode }) {
  return (
    <>
      {open && won && <Confetti />}
      <Dialog open={open} title={title} onClose={onClose}>
        {won && reward ? (
          <>
            <p className="text-3xl" aria-hidden="true">
              🎉
            </p>
            <p className="mt-2 text-lg font-semibold text-primary">{reward.name}</p>
            <p className="mt-2 text-sm text-text-muted">{rewardLine(reward)}</p>
          </>
        ) : (
          <p className="text-sm text-text-muted">No prize this time — better luck next play!</p>
        )}
        {extra}
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onClose}>Continue</Button>
          {won && reward && !['play_points', 'bonus_attempt'].includes(reward.type) && (
            <Link href={`${base}/rewards?tab=mine`} className="text-sm font-medium text-primary hover:underline">
              Go to My Rewards
            </Link>
          )}
        </div>
      </Dialog>
    </>
  );
}

export function PlayPointsPill({ value, name = 'Play Points' }: { value: number | null | undefined; name?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-3 py-1 text-sm font-semibold text-primary-subtle-fg" aria-label={`${value ?? 0} ${name}`}>
      <span aria-hidden="true">★</span>
      {(value ?? 0).toLocaleString()}
      <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium">{name}</span>
    </span>
  );
}
