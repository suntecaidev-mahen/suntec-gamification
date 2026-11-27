'use client';

import { useActionState, type ReactNode } from 'react';
import { Alert, Button, type ButtonVariant } from '@suntec/ui';
import type { ActionState } from '@/lib/admin/actions';

/**
 * Small form bound to a server action with inline success/error feedback.
 * `result` picks how one-time data in the result is shown (an invite link, an API key, a test-link QR).
 * (Server pages cannot pass render functions to this Client Component, so the views live here.)
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant = 'primary',
  className,
  confirm,
  result,
  inline,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  variant?: ButtonVariant;
  className?: string;
  confirm?: string;
  result?: ResultView;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={className ?? (inline ? 'flex flex-wrap items-end gap-2' : 'space-y-3')}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className={inline ? '' : 'flex items-center gap-3'}>
        <Button type="submit" variant={variant} loading={pending} size={inline ? 'sm' : 'md'}>
          {submitLabel}
        </Button>
      </div>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && state.message && !inline && <Alert tone="success">{state.message}</Alert>}
      {state.ok && inline && <span className="text-xs font-medium text-success" role="status">✓ {state.message}</span>}
      <ResultData view={result} state={state} />
    </form>
  );
}

export type ResultView = 'invite-link' | 'api-key' | 'test-link';

function ResultData({ view, state }: { view?: ResultView; state: ActionState }) {
  const d = state.data ?? {};
  if (view === 'invite-link' && d.link) {
    return (
      <Alert tone="warning" title="Send this link to the user (valid for 24 hours, one use)">
        <code className="mt-1 block break-all rounded bg-surface p-2 font-mono text-xs text-text">{String(d.link)}</code>
      </Alert>
    );
  }
  if (view === 'api-key' && d.key) {
    return (
      <Alert tone="warning" title="Copy this key now">
        <code className="block break-all rounded bg-surface p-2 font-mono text-xs text-text">{String(d.key)}</code>
        It will not be shown again. Store it in the calling system’s secret manager.
      </Alert>
    );
  }
  if (view === 'test-link' && d.url) {
    return (
      <div className="space-y-3 rounded-md border border-border bg-surface-muted p-4">
        <p className="text-sm font-medium">Scan with the tester’s phone camera, or send them the link:</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={String(d.qr)} alt="QR code for the in-app test link" width={200} height={200} className="rounded border border-border bg-white" />
        <code className="block break-all rounded bg-surface p-2 font-mono text-xs">{String(d.url)}</code>
        <p className="text-xs text-text-muted">Single use · expires in 10 minutes. Create a new link for each tester or device.</p>
      </div>
    );
  }
  return null;
}
