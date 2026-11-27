'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Spinner } from '@suntec/ui';
import { api, type ApiError } from './client';

/** First visit on the public link: start a guest session, then show the games. No sign-up needed. */
export function GuestStart() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const start = () => {
    setError(null);
    api('/guest', { method: 'POST', json: {} }).then(
      () => router.refresh(),
      (e: unknown) => setError((e as ApiError).message),
    );
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api('/guest', { method: 'POST', json: {} }).then(
      () => router.refresh(),
      (e: unknown) => setError((e as ApiError).message),
    );
  }, [router]);

  if (error) {
    return (
      <Alert tone="danger" title="We couldn’t start the game">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={start}>
          Try again
        </Button>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-text-muted" aria-live="polite">
      <Spinner />
      <p className="text-sm">Getting your games ready…</p>
    </div>
  );
}
