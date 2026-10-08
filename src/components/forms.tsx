'use client';
import { useActionState, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/server/context';
import { Button, ErrorText, cx } from './ui';

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Formulário ligado a uma server action com mensagens de erro/sucesso. */
export function ActionForm({ action, children, submit = 'Salvar', className, footer, resetOnSuccess, onDone }: {
  action: Action; children: ReactNode; submit?: string | null; className?: string; footer?: ReactNode; resetOnSuccess?: boolean; onDone?: () => void;
}) {
  const [state, run, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, { ok: true } as ActionResult);
  return (
    <form action={run} className={cx('space-y-4', className)} key={resetOnSuccess && state.ok && 'message' in state ? String(Math.random()) : undefined}>
      {children}
      {!state.ok && <ErrorText>{state.error}</ErrorText>}
      {state.ok && state.message && <p className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">{state.message}</p>}
      {(submit || footer) && (
        <div className="flex flex-wrap items-center gap-2">
          {submit && <Button type="submit" disabled={pending} className="min-w-32">{pending ? 'Salvando…' : submit}</Button>}
          {footer}
        </div>
      )}
    </form>
  );
}

/** Botão que chama uma action simples e atualiza a tela. */
export function ActionButton({ run, children, confirm, variant = 'secondary', size = 'sm', className }: {
  run: () => Promise<ActionResult>; children: ReactNode; confirm?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md';
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const go = () => {
    if (confirm && !armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setArmed(false);
    start(async () => {
      const r = await run();
      if (!r.ok) setError(r.error); else { setError(''); router.refresh(); }
    });
  };
  return (
    <span className="inline-flex flex-col">
      <Button type="button" variant={armed ? 'danger' : variant} size={size} disabled={pending} onClick={go} className={className}>
        {pending ? '…' : armed ? confirm : children}
      </Button>
      {error && <span className="mt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}
