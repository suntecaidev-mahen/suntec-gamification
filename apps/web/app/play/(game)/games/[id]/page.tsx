import { GameScreen } from '@/components/play/GameScreen';

export const metadata = { title: 'Play' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameScreen id={id} />;
}
