import { requireUser } from './auth/session';
import { getDb, tx } from './db';
import { DomainError, type Ctx } from './domain/types';

/** Contexto de leitura da requisição (usuário autenticado + conexão). */
export async function readCtx(): Promise<Ctx> {
  const user = await requireUser();
  return { q: await getDb(), userId: user.id };
}

/** Executa uma escrita numa transação com o usuário autenticado. */
export async function writeTx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return tx(q => fn({ q, userId: user.id }));
}

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Envolve uma server action: erros de regra viram mensagem amigável; o resto é logado. */
export async function safe<T>(fn: () => Promise<T>, okMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: okMessage };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
    if (e instanceof DomainError) return { ok: false, error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (/check_violation|Rateio/.test(msg)) return { ok: false, error: 'O rateio precisa somar exatamente o valor do movimento.' };
    console.error(e);
    return { ok: false, error: 'Não foi possível concluir. Tente novamente.' };
  }
}
