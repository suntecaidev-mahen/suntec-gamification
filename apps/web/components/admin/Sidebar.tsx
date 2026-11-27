'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@suntec/ui';
import { BrandInline } from '@/components/Brand';

export type NavGroup = { title: string; items: { href: string; label: string }[] };

export function Sidebar({ groups, user, signOut, envTag = null }: { groups: NavGroup[]; user: { name: string; roles: string }; signOut: () => Promise<void>; envTag?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <BrandInline size={28} />
        <button type="button" className="rounded-md border border-input-border px-3 py-1.5 text-sm" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen(!open)}>
          Menu
        </button>
      </div>
      <aside
        id="admin-nav"
        className={cn('fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-border bg-surface px-3 py-5 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0', open ? 'translate-x-0 shadow-lg' : '-translate-x-full')}
      >
        <Link href="/admin" className="mb-6 block px-3" onClick={() => setOpen(false)}>
          <BrandInline size={32} subtitle="Admin control panel" className="whitespace-nowrap text-[15px]" />
          {envTag && (
            <span className="mt-2 inline-block rounded border border-warning/40 bg-warning-subtle px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-warning" title="Test environment — not the live system">
              {envTag}
            </span>
          )}
        </Link>
        <nav aria-label="Admin">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <p className="px-3 pb-1 text-xs font-normal text-text-subtle">{g.title}</p>
              <ul>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(it.href) ? 'page' : undefined}
                      className={cn('block rounded-md px-3 py-1.5 text-sm', isActive(it.href) ? 'bg-primary-subtle font-semibold text-primary-subtle-fg' : 'text-text hover:bg-surface-sunken')}
                    >
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-6 border-t border-border px-3 pt-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-text-muted">{user.roles}</p>
          <form action={signOut}>
            <button type="submit" className="mt-2 text-sm font-medium text-primary hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
    </>
  );
}
