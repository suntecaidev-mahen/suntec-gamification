'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { cn } from '@suntec/ui';
import { emitBridge, PLAY_BASE, PlayContext, type PlayMode, type Viewer } from './client';
import { BrandInline } from '@/components/Brand';
import { signOutPlay } from '@/lib/play/actions';

const NAV = [
  { path: '', label: 'Home', icon: '🏠' },
  { path: '/missions', label: 'Missions', icon: '🎯' },
  { path: '/rewards', label: 'My rewards', icon: '🎁' },
];

/**
 * Frame for every Play & Win screen.
 *   web: Suntec City header with "Sign in" (guests) or the member's name + sign out.
 *   app: compact header with back/close for the Suntec+ app WebView (native bridge events).
 */
export function PlayShell({ mode, viewer, children }: { mode: PlayMode; viewer: Viewer; children: ReactNode }) {
  const base = PLAY_BASE;
  const pathname = usePathname();
  const router = useRouter();

  const refreshBalance = useCallback(() => {
    if (mode === 'app') emitBridge('balance_changed');
  }, [mode]);

  useEffect(() => {
    if (mode === 'app') emitBridge('ready', { path: pathname });
  }, [mode, pathname]);

  const ctx = useMemo(() => ({ base, mode, viewer, refreshBalance }), [base, mode, viewer, refreshBalance]);
  const active = (p: string) => (p === '' ? pathname === base : pathname.startsWith(base + p));
  const atHome = pathname === base;

  return (
    <PlayContext.Provider value={ctx}>
      <a href="#play-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {mode === 'web' ? (
        <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
            <Link href={base} aria-label="Suntec+ Play & Win home">
              <BrandInline size={34} />
            </Link>
            <nav aria-label="Main" className="hidden gap-1 md:flex">
              {NAV.map((n) => (
                <Link key={n.path} href={base + n.path} aria-current={active(n.path) ? 'page' : undefined} className={cn('rounded-full px-3 py-1.5 text-sm font-medium', active(n.path) ? 'bg-primary-subtle text-primary-subtle-fg' : 'text-text hover:bg-surface-sunken')}>
                  {n.label}
                </Link>
              ))}
            </nav>
            {viewer.guest ? (
              <Link href="/play/signin" className="shrink-0 rounded-full border border-brand-200 bg-primary-subtle px-3 py-1.5 text-sm font-semibold text-primary-subtle-fg hover:bg-primary-subtle-hover">
                Member sign in
              </Link>
            ) : (
              <div className="flex shrink-0 items-center gap-2 text-sm">
                <span className="hidden font-medium sm:inline">Hi, {viewer.firstName ?? 'member'}</span>
                <form action={signOutPlay}>
                  <button type="submit" className="rounded-full px-3 py-1.5 font-medium text-primary hover:bg-surface-sunken">
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-3 py-2">
          <button
            type="button"
            onClick={() => (atHome ? emitBridge('close') : router.back())}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg font-medium text-primary hover:bg-surface-sunken"
            aria-label={atHome ? 'Close Play & Win' : 'Back'}
          >
            {atHome ? '✕' : '←'}
          </button>
          <BrandInline size={28} />
          <span className="h-9 w-9" aria-hidden="true" />
        </header>
      )}

      <main id="play-main" className="mx-auto max-w-5xl px-4 py-5 pb-24 md:pb-10">
        {children}
      </main>

      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map((n) => (
            <li key={n.path}>
              <Link href={base + n.path} aria-current={active(n.path) ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-xs font-medium', active(n.path) ? 'text-primary' : 'text-text-muted')}>
                <span className="text-lg" aria-hidden="true">
                  {n.icon}
                </span>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PlayContext.Provider>
  );
}
