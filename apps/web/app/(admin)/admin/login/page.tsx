import { redirect } from 'next/navigation';
import { Alert, Card } from '@suntec/ui';
import { getStaff } from '@/lib/admin/session';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/admin/actions';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Staff sign in' };
export const dynamic = 'force-dynamic';

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let notStaff = false;
  let email: string | undefined;
  if (isSupabaseConfigured()) {
    if (await getStaff()) redirect('/admin');
    const { data } = await (await createSupabaseServerClient()).auth.getUser();
    notStaff = Boolean(data.user);
    email = data.user?.email;
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold">
            Suntec<span className="text-primary">+</span> Play &amp; Win
          </p>
          <p className="text-sm text-text-muted">Admin control panel</p>
        </div>
        <Card className="p-6">
          {!isSupabaseConfigured() ? (
            <Alert tone="warning" title="Not configured">
              Add your Supabase keys to apps/web/.env.local (see SETUP.md).
            </Alert>
          ) : (
            <>
              {notStaff && (
                <Alert tone="warning" className="mb-4">
                  You are signed in{email ? <> as <strong>{email}</strong></> : null}, but this account is not a staff user.{' '}
                  <form action={signOut} className="mt-2">
                    <button type="submit" className="font-medium underline">
                      Sign out and use a staff account
                    </button>
                  </form>
                </Alert>
              )}
              <LoginForm initialError={error === 'link' ? 'That sign-in link is invalid or has expired.' : undefined} />
            </>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-text-muted">Access is logged. Authorised Suntec City staff only.</p>
      </div>
    </main>
  );
}
