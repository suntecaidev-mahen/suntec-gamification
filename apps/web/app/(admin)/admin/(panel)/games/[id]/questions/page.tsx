import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { QuestionEditor, type AdminQuestion } from '@/components/admin/QuestionEditor';
import { PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Question bank' };

export default async function QuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff('campaigns.read');
  const supabase = await createSupabaseServerClient();
  const { data: game } = await supabase.from('games').select('id, name, type, config').eq('id', id).maybeSingle();
  if (!game || game.type !== 'quiz') notFound();
  const { data } = await supabase
    .from('quiz_questions')
    .select('id, category, text, explanation, time_limit_s, points, status, sort, quiz_options(position, text, is_correct)')
    .eq('game_id', id)
    .order('sort');
  const questions: AdminQuestion[] = (data ?? []).map((q) => ({
    id: q.id,
    category: q.category,
    text: q.text,
    explanation: q.explanation,
    time_limit_s: q.time_limit_s,
    points: q.points,
    status: q.status,
    sort: q.sort,
    options: ((q.quiz_options ?? []) as { position: number; text: string; is_correct: boolean }[]).sort((a, b) => a.position - b.position).map((o) => ({ text: o.text, is_correct: o.is_correct })),
  }));
  const per = Number((game.config as Record<string, unknown>)?.questions_per_session ?? 5);
  const active = questions.filter((q) => q.status === 'active').length;
  return (
    <>
      <PageHeader
        title={`${game.name}: question bank`}
        description={`Each quiz session draws ${per} random active questions. ${active} active question(s)${active < per ? ' — add more so every session gets a full set.' : '.'}`}
        back={{ href: `/admin/r/games/${id}`, label: 'Game settings' }}
      />
      <QuestionEditor gameId={id} questions={questions} canWrite={staff.can('games.write') || staff.can('content.write')} />
    </>
  );
}
