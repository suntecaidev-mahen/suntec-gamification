'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@suntec/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError ?? '');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  function start() {
    setBusy(true);
    setError('');
    setInfo('');
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      setInfo('');
      return;
    }
    start();
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Email or password is incorrect. Use "Forgot password?" below to set a new one.'
          : err.message,
      );
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  async function sendEmail(kind: 'link' | 'reset') {
    if (!email.trim()) {
      setError('Enter your work email first.');
      setInfo('');
      return;
    }
    start();
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;
    const { error: err } =
      kind === 'reset'
        ? await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${origin}/auth/callback?next=/admin/set-password`,
          })
        : await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=/admin` },
          });
    setBusy(false);
    if (err) {
      setError(/rate limit|security purposes/i.test(err.message) ? 'Too many emails requested. Please wait a minute and try again.' : err.message);
      return;
    }
    setInfo(
      kind === 'reset'
        ? 'If this email belongs to a staff account, a password-reset link is on its way. Open it in this browser.'
        : 'If this email belongs to a staff account, a sign-in link is on its way. Open it in this browser.',
    );
  }

  return (
    <form onSubmit={signIn} className="space-y-4" noValidate>
      <Field id="email" label="Work email" required>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field id="password" label="Password" required>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>
        Sign in
      </Button>
      <div className="flex items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => sendEmail('reset')} className="font-medium text-primary hover:underline" disabled={busy}>
          Forgot password?
        </button>
        <button type="button" onClick={() => sendEmail('link')} className="font-medium text-primary hover:underline" disabled={busy}>
          Email me a sign-in link
        </button>
      </div>
    </form>
  );
}
