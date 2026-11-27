import { redirect } from 'next/navigation';
import { HomeScreen } from '@/components/play/HomeScreen';

export const metadata = { title: 'Play & Win' };

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string; claimed?: string }> }) {
  const { code, claimed } = await searchParams;
  // /play?code=… (handoff URL from the Suntec+ app) → sign the member in first
  if (code) redirect(`/api/v1/auth/exchange?code=${encodeURIComponent(code)}`);
  return <HomeScreen claimed={claimed} />;
}
