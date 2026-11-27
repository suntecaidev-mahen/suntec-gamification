import { Alert, Card } from '@suntec/ui';
import { isSupabaseConfigured } from '@/lib/env';
import { BrandHero } from '@/components/Brand';
import { SUNTEC } from '@/lib/brand';
import { PortalLogin } from './PortalLogin';

export const metadata = { title: 'Sign in' };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; switch?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/portal';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm">
        <BrandHero subtitle="Spin, scratch, quiz and complete missions for rewards at Suntec City." />
        <Card className="p-6">
          {isSupabaseConfigured() ? (
            <PortalLogin next={next} switchAccount={sp.switch === '1'} linkError={sp.error === 'link'} />
          ) : (
            <Alert tone="warning">Not configured yet — see SETUP.md.</Alert>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-text-muted">
          By continuing you agree to the Suntec City{' '}
          <a href={SUNTEC.links.terms} target="_blank" rel="noopener noreferrer" className="underline">
            Terms and Conditions
          </a>{' '}
          and{' '}
          <a href={SUNTEC.links.privacy} target="_blank" rel="noopener noreferrer" className="underline">
            Privacy Policy
          </a>
          . No password needed.
        </p>
      </div>
    </main>
  );
}
