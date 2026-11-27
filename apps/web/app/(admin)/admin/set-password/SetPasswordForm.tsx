'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@suntec/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/** Supabase Auth's own lowest allowed password length (cannot be set lower). */
const SUPABASE_MIN = 6;

/**
 * Production asks for at least 10 characters. In UAT/local there is no extra rule of ours;
 * only Supabase's own minimum (6 characters) applies.
 */
export function SetPasswordForm({ strict }: { strict: boolean }) {
  const router = useRouter();
  const min = strict ? 10 : SUPABASE_MIN;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < min) return setError(`Use at least ${min} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const { error: err } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(/at least \d+ characters/i.test(err.message) ? `Use at least ${SUPABASE_MIN} characters.` : err.message);
    router.replace('/admin');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="password" label="New password" help={`At least ${min} characters`} required>
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Field id="confirm" label="Confirm new password" required>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>
        Save password and continue
      </Button>
    </form>
  );
}
