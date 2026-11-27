'use client';

import { useActionState, type ReactNode } from 'react';
import { Alert, Button, type ButtonVariant } from '@suntec/ui';
import type { ActionState } from '@/lib/admin/actions';

/**
 * Small form bound to a server action with inline success/error feedback.
 * `render` receives the last result so callers can show one-time data (e.g. an API key).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant = 'primary',
  className,
  confirm,
  render,
  inline,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  variant?: ButtonVariant;
  className?: string;
  confirm?: string;
  render?: (state: ActionState) => ReactNode;
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
      {render?.(state)}
    </form>
  );
}
