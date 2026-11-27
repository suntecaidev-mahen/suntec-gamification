'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@suntec/ui';
import { api, emitBridge, PlayContext, type PlayMode } from './client';
import { PlayPointsPill } from './bits';
import type { Summary } from './types';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { BrandInline } from '@/components/Brand';

const NAV = [
  { path: '', label: 'Home', icon: '🏠' },
  { path: '/missions', label: 'Missions', icon: '🎯' },
  { path: '/rewards', label: 'Rewards', icon: '🎁' },
  { path: '/leaderboard', label: 'Ranks', icon: '🏆' },
  { path: '/inbox', label: 'Inbox', icon: '🔔' },
];

export function PlayShell({ mode, initial, children }: { mode: PlayMode; initial: { pp_balance: number; unread: number; first_name: string | null }; children: ReactNode }) {
  const base = mode === 'embed' ? '/embed' : '/portal';
  const pathname = usePathname();
  const router = useRouter();
  const [balance, setBalance] = useState(initial.pp_balance);
  const [unread, setUnread] = useState(initial.unread);

  const refreshBalance = useCallback(() => {
    api<Summary>('/me')
      .then((s) => {
        setBalance(s.pp_balance);
        setUnread(s.unread_notifications);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode === 'embed') emitBridge('ready', { path: pathname });
  }, [mode, pathname]);

  // Live inbox: Supabase Realtime pushes new notifications (RLS limits the stream to this member).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel('inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => refreshBalance())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshBalance]);

  const ctx = useMemo(() => ({ base, mode, refreshBalance }), [base, mode, refreshBalance]);
  const active = (p: string) => (p === '' ? pathname === base : pathname.startsWith(base + p));

  return (
    <PlayContext.Provider value={ctx}>
      <a href="#play-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {mode === 'portal' ? (
        <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href={base} className="text-lg" aria-label="Suntec+ Play & Win home">
              <BrandInline size={34} />
            </Link>
            <nav aria-label="Main" className="hidden gap-1 md:flex">
              {NAV.map((n) => (
                <Link key={n.path} href={base + n.path} aria-current={active(n.path) ? 'page' : undefined} className={cn('rounded-full px-3 py-1.5 text-sm font-medium', active(n.path) ? 'bg-primary-subtle text-primary-subtle-fg' : 'text-text hover:bg-surface-sunken')}>
                  {n.label}
                  {n.path === '/inbox' && unread > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-fg">{unread}</span>}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <PlayPointsPill value={balance} />
              <Link href={`${base}/profile`} className="rounded-full p-2 text-sm hover:bg-surface-sunken" aria-label="Profile">
                👤
              </Link>
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
          <button type="button" onClick={() => (pathname === base ? emitBridge('close') : router.back())} className="rounded-full px-2 py-1 text-sm font-medium text-primary" aria-label={pathname === base ? 'Close Play & Win' : 'Back'}>
            {pathname === base ? '✕' : '←'}
          </button>
          <span className="font-semibold">Play &amp; Win</span>
          <Link href={`${base}/profile`} aria-label="Profile and Play Points">
            <PlayPointsPill value={balance} />
          </Link>
        </header>
      )}

      <main id="play-main" className={cn('mx-auto max-w-5xl px-4 py-5', mode === 'embed' ? 'pb-24' : 'pb-24 md:pb-10')}>
        {children}
      </main>

      <nav aria-label="Sections" className={cn('fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]', mode === 'portal' && 'md:hidden')}>
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((n) => (
            <li key={n.path}>
              <Link href={base + n.path} aria-current={active(n.path) ? 'page' : undefined} className={cn('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active(n.path) ? 'text-primary' : 'text-text-muted')}>
                <span className="text-lg" aria-hidden="true">
                  {n.icon}
                </span>
                {n.label}
                {n.path === '/inbox' && unread > 0 && (
                  <span className="absolute right-[22%] top-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-fg" aria-label={`${unread} unread`}>
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PlayContext.Provider>
  );
}
