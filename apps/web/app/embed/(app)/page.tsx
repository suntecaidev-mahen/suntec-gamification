import { redirect } from 'next/navigation';
import { HomeScreen } from '@/components/play/HomeScreen';

export const metadata = { title: 'Play & Win' };

/** /embed?code=… (legacy handoff URL) is forwarded to the code exchange. */
export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  if (code) redirect(`/api/v1/auth/exchange?code=${encodeURIComponent(code)}`);
  return <HomeScreen />;
}
