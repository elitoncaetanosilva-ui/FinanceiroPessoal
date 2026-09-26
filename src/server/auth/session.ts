import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { q, one } from '../db';
import { newToken, sha256, verifyPassword } from './password';

export const SESSION_COOKIE = 'fp_session';
const MAX_AGE_DAYS = 30;

export interface User { id: string; email: string; name: string }

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = email.trim().toLowerCase();
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const recent = await one<{ n: number }>(
    "select count(*)::int as n from login_attempts where (email=$1 or ip=$2) and not success and created_at > now() - interval '15 minutes'",
    [e, ip],
  );
  if ((recent?.n ?? 0) >= 8) return { ok: false, error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };

  const u = await one<{ id: string; password_hash: string }>('select id, password_hash from users where email=$1', [e]);
  const ok = !!u && (await verifyPassword(password, u.password_hash));
  await q('insert into login_attempts(email, ip, success) values ($1,$2,$3)', [e, ip, ok]);
  if (!ok || !u) return { ok: false, error: 'E-mail ou senha inválidos.' };

  const token = newToken();
  await q(
    `insert into sessions(id, user_id, expires_at, user_agent) values ($1,$2, now() + interval '${MAX_AGE_DAYS} days', $3)`,
    [sha256(token), u.id, (h.get('user-agent') || '').slice(0, 300)],
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE_DAYS * 86400,
  });
  return { ok: true };
}

export async function logout() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await q('delete from sessions where id=$1', [sha256(token)]);
  c.delete(SESSION_COOKIE);
}

/** Usuário da sessão atual (uma consulta por requisição). */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const u = await one<User & { last_seen_at: Date }>(
    `select u.id, u.email, u.name, s.last_seen_at from sessions s join users u on u.id = s.user_id
     where s.id=$1 and s.expires_at > now()`,
    [sha256(token)],
  );
  if (!u) return null;
  // renova a validade no máximo uma vez por hora (sessão deslizante)
  if (Date.now() - new Date(u.last_seen_at).getTime() > 3600_000) {
    await q(`update sessions set last_seen_at=now(), expires_at=now() + interval '${MAX_AGE_DAYS} days' where id=$1`, [sha256(token)]);
  }
  return { id: u.id, email: u.email, name: u.name };
});

/** Exige sessão: em páginas redireciona para /login; em actions/API lança erro. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}
