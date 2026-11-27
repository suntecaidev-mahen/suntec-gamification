import { ConfirmLink } from './ConfirmLink';

export const metadata = { title: 'Signing you in' };

/** Landing page for links in Supabase emails (admin invitations, password resets). */
export default function ConfirmPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <ConfirmLink />
    </main>
  );
}
