'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner } from '@suntec/ui';
import { BrandInline } from '@/components/Brand';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/admin';
}

/**
 * Supabase email links arrive here in one of three shapes:
 *   #access_token=…&refresh_token=…  (invitations / resets sent by the server)
 *   ?token_hash=…&type=…              (custom email templates)
 *   ?code=…                           (PKCE, started in this browser)
 * The session is stored in cookies, then the person continues to `next`.
 */
export function ConfirmLink() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const next = safeNext(search.get('next'));

    if (search.get('token_hash') || search.get('code')) {
      window.location.replace(`/auth/callback${window.location.search}`);
      return;
    }
    const failed = hash.get('error_description') ?? search.get('error_description');
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (failed || !accessToken || !refreshToken) {
      // Only set state from the async branch below or here, once.
      queueMicrotask(() => setError(failed ? failed.replace(/\+/g, ' ') : 'This link is not valid.'));
      return;
    }
    createSupabaseBrowserClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: err }) => {
        if (err) setError(err.message);
        else window.location.replace(next);
      });
  }, []);

  return (
    <Card className="w-full max-w-sm space-y-4 p-6 text-center">
      <BrandInline size={36} />
      {error ? (
        <>
          <Alert tone="danger" className="text-left">
            This link has expired or was already used ({error}). Ask your administrator to resend the invitation, or use “Forgot password?” on the sign-in page.
          </Alert>
          <Link href="/admin/login" className="text-sm font-medium text-primary hover:underline">
            Go to admin sign-in
          </Link>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4 text-text-muted" aria-live="polite">
          <Spinner />
          <p className="text-sm">Signing you in…</p>
        </div>
      )}
    </Card>
  );
}
