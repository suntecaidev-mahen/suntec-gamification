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

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message);
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  async function sendLink() {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setBusy(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setInfo('If this email belongs to a staff account, a sign-in link is on its way.');
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
      <button type="button" onClick={sendLink} className="w-full text-center text-sm font-medium text-primary hover:underline" disabled={busy}>
        Email me a sign-in link instead
      </button>
    </form>
  );
}
