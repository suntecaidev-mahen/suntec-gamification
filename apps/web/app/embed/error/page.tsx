import { Alert, Card } from '@suntec/ui';

export const metadata = { title: 'Play & Win' };

const MESSAGES: Record<string, string> = {
  expired: 'This link has expired or was already used. Please close and open Play & Win again from the Suntec+ app.',
  invalid: 'This link is not valid. Please open Play & Win again from the Suntec+ app.',
  blocked: 'Your Play & Win access is suspended. Please contact Suntec+ Customer Service.',
  session: 'Your session has ended. Please close and open Play & Win again from the Suntec+ app.',
  signin: 'We could not sign you in right now. Please try again in a moment.',
  server: 'Something went wrong on our side. Please try again in a moment.',
};

export default async function EmbedError({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <p className="text-4xl" aria-hidden="true">
          🎡
        </p>
        <h1 className="mt-2 text-lg font-semibold">Play &amp; Win</h1>
        <Alert tone={reason === 'blocked' ? 'danger' : 'info'} className="mt-4 text-left">
          {MESSAGES[reason ?? 'session'] ?? MESSAGES.session}
        </Alert>
      </Card>
    </main>
  );
}
