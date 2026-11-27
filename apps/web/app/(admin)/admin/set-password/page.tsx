import { redirect } from 'next/navigation';
import { Card } from '@suntec/ui';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BrandHero } from '@/components/Brand';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

/**
 * Landing page of invitation and password-reset emails (reached via /auth/confirm or
 * /auth/callback, which sign the user in first). ?welcome=1 = first-time invitation.
 */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  if (!isSupabaseConfigured()) redirect('/admin/login');
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/admin/login?error=link');
  const { data: staff } = await supabase.from('staff_users').select('display_name').eq('id', data.user.id).maybeSingle();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <BrandHero subtitle={welcome ? 'Welcome to the admin control panel' : 'Set a new password'} logoWidth={120} />
        <Card className="p-6">
          {welcome && (
            <p className="mb-2 text-base font-semibold">
              Hi {staff?.display_name?.split(' ')[0] ?? 'there'}, create your password to finish setting up your account.
            </p>
          )}
          <p className="mb-4 text-sm text-text-muted">
            Signed in as <strong className="text-text">{data.user.email}</strong>
          </p>
          <SetPasswordForm />
        </Card>
      </div>
    </main>
  );
}
