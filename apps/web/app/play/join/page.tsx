import { cookies } from 'next/headers';
import { BrandHero } from '@/components/Brand';
import { findGuest } from '@/lib/api/guest';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { JoinRedirect } from './JoinRedirect';

export const metadata = { title: 'Join Suntec+' };
export const dynamic = 'force-dynamic';

/**
 * "Join Suntec+": opens the Suntec+ app's sign-up screen when the app is installed,
 * otherwise the App Store / Google Play. Carries the guest's claim code along.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ claim?: string }> }) {
  const sp = await searchParams;
  let claim = sp.claim && /^[A-Za-z0-9]{8}$/.test(sp.claim) ? sp.claim.toUpperCase() : null;
  if (!claim && isSupabaseConfigured()) {
    const guest = await findGuest(await cookies());
    if (guest) {
      const { data } = await supabaseAdmin().from('members').select('claim_code').eq('id', guest.id).single();
      claim = data?.claim_code ?? null;
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-8">
      <div className="w-full max-w-sm">
        <BrandHero subtitle="Join Suntec+ — it’s free. Collect your Play & Win points and enjoy member rewards at Suntec City." />
        <JoinRedirect claimCode={claim} />
      </div>
    </main>
  );
}
