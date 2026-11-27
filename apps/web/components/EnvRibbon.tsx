'use client';

import { usePathname } from 'next/navigation';

type Module = 'admin' | 'play';

// White text on each colour meets WCAG AA (contrast ≥ 4.5:1).
const MODULE_STYLE: Record<Module, string> = {
  admin: 'bg-text',
  play: 'bg-primary',
};

function moduleFor(pathname: string): Module | null {
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/play') || pathname.startsWith('/q/')) return 'play';
  return null;
}

/** Thin strip with a module tag: PLAY-UAT (customer Play & Win) or ADMIN-UAT. */
export function EnvRibbon({ env }: { env: 'local' | 'uat' }) {
  const mod = moduleFor(usePathname() ?? '/');
  const tag = (mod ? `${mod}-${env}` : env).toUpperCase();
  return (
    <div role="note" aria-label={`${tag} test environment`} className="flex items-center justify-center gap-2 border-b border-border bg-surface-muted px-4 py-1 text-xs">
      <span className={`rounded px-2 py-0.5 font-bold tracking-wide text-white ${mod ? MODULE_STYLE[mod] : 'bg-warning'}`}>{tag}</span>
      <span className="text-text-muted">{env === 'uat' ? 'Test environment · rewards are not real' : 'Local development'}</span>
    </div>
  );
}
