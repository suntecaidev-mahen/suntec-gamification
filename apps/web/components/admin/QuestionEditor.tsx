'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@suntec/ui';
import { saveQuestion } from '@/lib/admin/actions';

export type AdminQuestion = {
  id?: string;
  category: string;
  text: string;
  explanation: string;
  time_limit_s: number | null;
  points: number;
  status: 'active' | 'inactive' | 'archived';
  sort: number;
  options: { text: string; is_correct: boolean }[];
};

const blank = (): AdminQuestion => ({
  category: 'general',
  text: '',
  explanation: '',
  time_limit_s: null,
  points: 100,
  status: 'active',
  sort: 100,
  options: [
    { text: '', is_correct: true },
    { text: '', is_correct: false },
    { text: '', is_correct: false },
    { text: '', is_correct: false },
  ],
});

export function QuestionEditor({ gameId, questions, canWrite }: { gameId: string; questions: AdminQuestion[]; canWrite: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState<AdminQuestion | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  const save = () =>
    q &&
    start(async () => {
      const res = await saveQuestion(gameId, { ...q, options: q.options.filter((o) => o.text.trim()) });
      setMsg(res.ok ? { ok: res.message } : { error: res.error });
      if (res.ok) {
        setQ(null);
        router.refresh();
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="space-y-2">
        {msg.ok && <Alert tone="success">{msg.ok}</Alert>}
        {questions.length === 0 && <p className="text-sm text-text-muted">No questions yet.</p>}
        {questions.map((item, i) => (
          <Card key={item.id ?? i} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.text}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {item.category} · {item.points} pts · {item.options.length} options · correct: {item.options.find((o) => o.is_correct)?.text}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.status !== 'active' && <Badge>{item.status}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => { setQ(structuredClone(item)); setMsg({}); }} disabled={!canWrite}>
                  Edit
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div>
        {q ? (
          <Card className="space-y-4">
            <h2 className="text-base font-semibold">{q.id ? 'Edit question' : 'New question'}</h2>
            <Field id="q-text" label="Question" required>
              <Textarea id="q-text" value={q.text} maxLength={500} onChange={(e) => setQ({ ...q, text: e.target.value })} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Options (select the correct answer)</legend>
              {q.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct"
                    aria-label={`Option ${i + 1} is correct`}
                    checked={o.is_correct}
                    onChange={() => setQ({ ...q, options: q.options.map((x, j) => ({ ...x, is_correct: j === i })) })}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  <Input aria-label={`Option ${i + 1}`} value={o.text} maxLength={200} onChange={(e) => setQ({ ...q, options: q.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove option ${i + 1}`} disabled={q.options.length <= 2} onClick={() => setQ({ ...q, options: q.options.filter((_, j) => j !== i) })}>
                    ✕
                  </Button>
                </div>
              ))}
              {q.options.length < 6 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setQ({ ...q, options: [...q.options, { text: '', is_correct: false }] })}>
                  + Option
                </Button>
              )}
            </fieldset>
            <Field id="q-expl" label="Explanation (shown after answering)">
              <Textarea id="q-expl" value={q.explanation} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="q-cat" label="Category">
                <Select id="q-cat" value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value })}>
                  {['suntec', 'merchants', 'campaign', 'general'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="q-status" label="Status">
                <Select id="q-status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value as AdminQuestion['status'] })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
              <Field id="q-points" label="Points">
                <Input id="q-points" type="number" min={0} value={q.points} onChange={(e) => setQ({ ...q, points: Number(e.target.value) || 0 })} />
              </Field>
              <Field id="q-time" label="Time limit (s)" help="Blank = game default">
                <Input id="q-time" type="number" min={5} max={300} value={q.time_limit_s ?? ''} onChange={(e) => setQ({ ...q, time_limit_s: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            </div>
            {msg.error && <Alert tone="danger">{msg.error}</Alert>}
            <div className="flex gap-2">
              <Button onClick={save} loading={pending}>
                Save question
              </Button>
              <Button variant="ghost" onClick={() => setQ(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-text-muted">Select a question to edit, or add a new one. Correct answers are never sent to customers before they answer.</p>
            <Button className="mt-3" onClick={() => { setQ(blank()); setMsg({}); }} disabled={!canWrite}>
              + New question
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
