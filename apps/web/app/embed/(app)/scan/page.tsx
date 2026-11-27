import { ScanScreen } from '@/components/play/screens';

export const metadata = { title: 'Scan QR' };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ScanScreen initialToken={token} />;
}
