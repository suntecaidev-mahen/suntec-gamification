import Link from 'next/link';
import { Alert, Card } from '@suntec/ui';
import { isSupabaseConfigured } from '@/lib/env';
import { BrandHero } from '@/components/Brand';
import { SUNTEC } from '@/lib/brand';
import { MemberSignIn } from './MemberSignIn';

export const metadata = { title: 'Member sign in' };

/** Suntec+ members sign in on the web link so their wins go straight to their Suntec+ account. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; switch?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/play') ? sp.next : '/play';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-8">
      <div className="w-full max-w-sm">
        <BrandHero subtitle="Sign in with the email of your Suntec+ account. Points you win go straight to your Suntec+ account." />
        <Card className="p-6">
          {isSupabaseConfigured() ? (
            <MemberSignIn next={next} switchAccount={sp.switch === '1'} linkError={sp.error === 'link'} />
          ) : (
            <Alert tone="warning">Not configured yet — see SETUP.md.</Alert>
          )}
        </Card>
        <div className="mt-4 flex flex-col items-center gap-2 text-sm">
          <Link href="/play/join" className="font-medium text-primary hover:underline">
            Not a member yet? Join Suntec+
          </Link>
          <Link href="/play" className="font-medium text-text-muted hover:underline">
            Keep playing as a guest
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-text-muted">
          By continuing you agree to the Suntec City{' '}
          <a href={SUNTEC.links.terms} target="_blank" rel="noopener noreferrer" className="underline">
            Terms and Conditions
          </a>{' '}
          and{' '}
          <a href={SUNTEC.links.privacy} target="_blank" rel="noopener noreferrer" className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}
