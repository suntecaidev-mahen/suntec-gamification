import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Alert, Button, Card, Select } from '@suntec/ui';
import { listDemoMembers, resolvePlayMember } from '@/lib/play/member';
import { linkDemoMember } from '@/lib/play/actions';
import { BrandInline } from '@/components/Brand';
import { PlayShell } from './PlayShell';
import type { PlayMode } from './client';

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-xl">
          <BrandInline size={36} />
        </p>
        {children}
      </div>
    </main>
  );
}

/** Server-side gate for /portal and /embed: session → linked member → shell. */
export async function PlayGate({ mode, children }: { mode: PlayMode; children: ReactNode }) {
  const r = await resolvePlayMember();
  if (r.state === 'unconfigured') {
    return (
      <Centered>
        <Alert tone="warning" title="Not configured yet">
          Add your Supabase keys to apps/web/.env.local (see SETUP.md).
        </Alert>
      </Centered>
    );
  }
  if (r.state === 'anon') {
    if (mode === 'embed') redirect('/embed/error?reason=session');
    redirect('/portal/login');
  }
  if (r.state === 'blocked') {
    return (
      <Centered>
        <Alert tone="danger" title="Access suspended">
          Your Play &amp; Win access is suspended. Please contact Suntec+ Customer Service.
        </Alert>
      </Centered>
    );
  }
  if (r.state === 'not_linked') {
    const demo = r.demo ? await listDemoMembers() : [];
    return (
      <Centered>
        <Card className="space-y-4 p-6">
          <h1 className="text-lg font-semibold">We couldn’t find your Suntec+ membership</h1>
          <p className="text-sm text-text-muted">
            You’re signed in as <strong>{r.email}</strong>, but this email isn’t registered with Suntec+. Sign in with the email you use for the Suntec+ app, or join Suntec+ first.
          </p>
          {r.demo && demo.length > 0 && (
            <form action={linkDemoMember} className="space-y-2 rounded-md border border-dashed border-warning/50 bg-warning-subtle p-3">
              <p className="text-sm font-medium text-warning">Test environment</p>
              <p className="text-xs text-text-muted">Link this login to a demo member from the mock Suntec+ system:</p>
              <label htmlFor="member_id" className="sr-only">
                Demo member
              </label>
              <Select id="member_id" name="member_id">
                {demo.map((m) => (
                  <option key={m.member_id} value={m.member_id} disabled={m.linked}>
                    {m.member_id} · {m.name} ({m.tier}){m.linked ? ' — already linked' : ''}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm">
                Link demo member
              </Button>
            </form>
          )}
          {mode === 'portal' && (
            <Link href="/portal/login?switch=1" className="block text-sm font-medium text-primary hover:underline">
              Use a different email
            </Link>
          )}
        </Card>
      </Centered>
    );
  }
  return (
    <PlayShell mode={mode} initial={r.initial}>
      {children}
    </PlayShell>
  );
}
