'use client';
import { useActionState } from 'react';
import { loginAction } from '@/app/actions/auth';
import { Button, ErrorText, Field, inputClass } from '@/components/ui';

export default function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: '' });
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="E-mail">
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="Senha">
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</Button>
    </form>
  );
}
