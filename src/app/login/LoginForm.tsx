'use client';

import { useActionState } from 'react';
import { login } from '../actions';

export function LoginForm({ de }: { de: string }) {
  const [estado, action, pendente] = useActionState(login, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="de" value={de} />
      <label className="field">
        Senha
        <input type="password" name="senha" autoComplete="current-password" autoFocus required />
      </label>
      {estado?.erro && <p className="alert alert-err" role="alert">{estado.erro}</p>}
      <button className="btn btn-primary" disabled={pendente}>{pendente ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}
