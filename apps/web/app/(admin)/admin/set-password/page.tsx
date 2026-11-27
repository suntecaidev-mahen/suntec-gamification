import { redirect } from 'next/navigation';
import { Card } from '@suntec/ui';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

/** Landing page of the password-reset email (reached via /auth/callback, which signs the user in first). */
export default async function SetPasswordPage() {
  if (!isSupabaseConfigured()) redirect('/admin/login');
  const { data } = await (await createSupabaseServerClient()).auth.getUser();
  if (!data.user) redirect('/admin/login?error=link');
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold">
            Suntec<span className="text-primary">+</span> Play &amp; Win
          </p>
          <p className="text-sm text-text-muted">Set a new password</p>
        </div>
        <Card className="p-6">
          <p className="mb-4 text-sm text-text-muted">
            Signed in as <strong className="text-text">{data.user.email}</strong>
          </p>
          <SetPasswordForm />
        </Card>
      </div>
    </main>
  );
}
