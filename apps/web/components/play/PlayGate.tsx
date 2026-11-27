import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Alert, Button, Card, Select } from '@suntec/ui';
import { listDemoMembers, resolvePlayMember } from '@/lib/play/member';
import { linkDemoMember, signOutPlay } from '@/lib/play/actions';
import { BrandInline } from '@/components/Brand';
import { PlayShell } from './PlayShell';
import { GuestStart } from './GuestStart';

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md">
        <div className="mb-4 text-center text-xl">
          <BrandInline size={36} />
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Server-side gate for every /play screen:
 * Suntec+ member (app or web sign-in) → guest on the public link → first-time visitor.
 */
export async function PlayGate({ children }: { children: ReactNode }) {
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
  if (r.state === 'app_session_ended') redirect('/play/error?reason=session');
  if (r.state === 'new_visitor') {
    return (
      <Centered>
        <GuestStart />
      </Centered>
    );
  }
  if (r.state === 'blocked') {
    return (
      <Centered>
        <Alert tone="danger" title="Access suspended">
          Play &amp; Win is not available for this account. Please contact Suntec+ Customer Service.
        </Alert>
      </Centered>
    );
  }
  if (r.state === 'not_linked') {
    const demo = r.demo ? await listDemoMembers() : [];
    return (
      <Centered>
        <Card className="space-y-4 p-6">
          <h1 className="text-lg font-semibold">This email isn’t a Suntec+ member yet</h1>
          <p className="text-sm text-text-muted">
            <strong>{r.email}</strong> isn’t registered with Suntec+. Join Suntec+ in the app (it’s free) to collect your points, or keep playing as a guest — your winnings are saved for 30 days.
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/play/join" className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
              Join Suntec+
            </Link>
            <form action={signOutPlay}>
              <Button type="submit" variant="secondary" className="w-full">
                Keep playing as a guest
              </Button>
            </form>
            <Link href="/play/signin?switch=1" className="text-center text-sm font-medium text-primary hover:underline">
              Use a different email
            </Link>
          </div>
          {r.demo && demo.length > 0 && (
            <form action={linkDemoMember} className="space-y-2 rounded-md border border-dashed border-warning/50 bg-warning-subtle p-3">
              <p className="text-sm font-medium text-warning">Test environment only</p>
              <p className="text-xs text-text-muted">Link this login to a demo member from the mock Suntec+ system:</p>
              <label htmlFor="member_id" className="sr-only">
                Demo member
              </label>
              <Select id="member_id" name="member_id">
                {demo.map((m) => (
                  <option key={m.member_id} value={m.member_id} disabled={m.linked}>
                    {`${m.member_id} · ${m.name} (${m.tier})${m.linked ? ' — already linked' : ''}`}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm">
                Link demo member
              </Button>
            </form>
          )}
        </Card>
      </Centered>
    );
  }
  return (
    <PlayShell mode={r.mode} viewer={r.viewer}>
      {children}
    </PlayShell>
  );
}
