import { redirect } from 'next/navigation';
import { HomeScreen } from '@/components/play/HomeScreen';
import type { Home } from '@/components/play/types';
import { resolvePlayMember } from '@/lib/play/member';
import { rpc } from '@/lib/api/core';

export const metadata = { title: 'Play & Win' };

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string; claimed?: string }> }) {
  const { code, claimed } = await searchParams;
  // /play?code=… (handoff URL from the Suntec+ app) → sign the member in first
  if (code) redirect(`/api/v1/auth/exchange?code=${encodeURIComponent(code)}`);
  // Render with the home data already in the page (no second round trip from the browser).
  // resolvePlayMember is cached per request, so this reuses the layout's lookup.
  const r = await resolvePlayMember();
  const initial = r.state === 'ok' ? await rpc<Home>('member_home', { p_member: r.memberId }).catch(() => null) : null;
  return <HomeScreen claimed={claimed} initial={initial} />;
}
