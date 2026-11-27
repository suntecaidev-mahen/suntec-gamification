import Link from 'next/link';
import { Alert, Card } from '@suntec/ui';
import { BrandInline } from '@/components/Brand';

export const metadata = { title: 'Play & Win' };

const MESSAGES: Record<string, string> = {
  expired: 'This link has expired or was already used. Please close Play & Win and open it again from the Suntec+ app.',
  invalid: 'This link is not valid. Please open Play & Win again from the Suntec+ app.',
  blocked: 'Play & Win is not available for this account. Please contact Suntec+ Customer Service.',
  session: 'Your session has ended. Please close Play & Win and open it again from the Suntec+ app.',
  signin: 'We could not sign you in right now. Please try again in a moment.',
  server: 'Something went wrong on our side. Please try again in a moment.',
};

export default async function PlayError({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <BrandInline size={36} />
        <Alert tone={reason === 'blocked' ? 'danger' : 'info'} className="mt-4 text-left">
          {MESSAGES[reason ?? 'session'] ?? MESSAGES.session}
        </Alert>
        {reason !== 'blocked' && (
          <Link href="/play/web" prefetch={false} className="mt-4 block text-sm font-medium text-primary hover:underline">
            Not in the app? Play on the web instead
          </Link>
        )}
      </Card>
    </main>
  );
}
