import { after } from 'next/server';
import { quizSubmitBodySchema, uuid } from '@suntec/core';
import { ok, parseJson, route, rpc } from '@/lib/api/core';
import { requireMember } from '@/lib/api/auth';
import { deliverNow } from '@/lib/api/outbox';

/** POST /api/v1/sessions/{id}/answers — submit quiz answers; scored on the server. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { member } = await requireMember(req, { key: 'play', limit: 30 }, { guests: true });
  const body = await parseJson(req, quizSubmitBodySchema);
  const result = await rpc<{ outcome?: { reward?: { id?: string } | null } }>('quiz_submit', {
    p_member: member.id,
    p_session: uuid.parse(id),
    p_answers: body.answers,
  });
  const txn = result.outcome?.reward?.id;
  if (txn) after(() => deliverNow([txn]));
  return ok(result);
});
