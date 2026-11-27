import { GameScreen } from '@/components/play/GameScreen';
import type { GameDetail } from '@/components/play/types';
import { resolvePlayMember } from '@/lib/play/member';
import { rpc } from '@/lib/api/core';

export const metadata = { title: 'Play' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Render with the game (wheel segments, availability) already in the page.
  const r = await resolvePlayMember();
  const initial =
    r.state === 'ok' && UUID.test(id) ? await rpc<GameDetail>('game_public', { p_member: r.memberId, p_game: id }).catch(() => null) : null;
  return <GameScreen id={id} initial={initial} />;
}
