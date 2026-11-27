import { Alert, Card } from '@suntec/ui';
import { isSupabaseConfigured } from '@/lib/env';
import { PortalLogin } from './PortalLogin';

export const metadata = { title: 'Sign in' };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; switch?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/portal';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-5xl" aria-hidden="true">
            🎡
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            Suntec<span className="text-primary">+</span> Play &amp; Win
          </h1>
          <p className="mt-1 text-sm text-text-muted">Spin, scratch, quiz and complete missions for rewards at Suntec City.</p>
        </div>
        <Card className="p-6">
          {isSupabaseConfigured() ? (
            <PortalLogin next={next} switchAccount={sp.switch === '1'} linkError={sp.error === 'link'} />
          ) : (
            <Alert tone="warning">Not configured yet — see SETUP.md.</Alert>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-text-muted">By continuing you agree to the Suntec+ Terms and Privacy Policy. No password needed.</p>
      </div>
    </main>
  );
}
