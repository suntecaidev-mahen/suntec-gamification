import { PlayGate } from '@/components/play/PlayGate';

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlayGate mode="embed">{children}</PlayGate>;
}
