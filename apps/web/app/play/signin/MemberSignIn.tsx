'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input } from '@suntec/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export function MemberSignIn({ next, switchAccount, linkError }: { next: string; switchAccount: boolean; linkError: boolean }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(linkError ? 'That sign-in link is invalid or has expired. Request a new one.' : '');

  useEffect(() => {
    if (switchAccount) void createSupabaseBrowserClient().auth.signOut();
  }, [switchAccount]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: err } = await createSupabaseBrowserClient().auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (err) {
      setError(/rate limit/i.test(err.message) ? 'Too many sign-in emails. Please wait a few minutes and try again.' : err.message);
      return;
    }
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await createSupabaseBrowserClient().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) {
      setError('That code is incorrect or has expired.');
      return;
    }
    // /auth/claim is a Route Handler (claims guest winnings, then redirects) — needs a full navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/auth/claim?next=${encodeURIComponent(next)}`);
  }

  return step === 'email' ? (
    <form onSubmit={sendCode} className="space-y-4" noValidate>
      <Field id="email" label="Email used for your Suntec+ account" required>
        <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>
        Email me a sign-in code
      </Button>
    </form>
  ) : (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <Alert tone="info">
        We sent an email to <strong>{email}</strong>. Enter the code, or simply tap the link in the email.
      </Alert>
      <Field id="code" label="Sign-in code" required>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.4em]" />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy} disabled={code.length < 6}>
        Sign in
      </Button>
      <button type="button" className="w-full text-sm font-medium text-primary hover:underline" onClick={() => { setStep('email'); setCode(''); }}>
        Use a different email
      </button>
    </form>
  );
}
