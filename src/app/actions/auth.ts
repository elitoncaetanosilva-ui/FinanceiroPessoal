'use server';
import { redirect } from 'next/navigation';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { login, logout, requireUser } from '@/server/auth/session';
import { one, q } from '@/server/db';

export async function loginAction(_: { error: string }, fd: FormData) {
  const email = String(fd.get('email') ?? '');
  const password = String(fd.get('password') ?? '');
  const r = await login(email, password);
  if (!r.ok) return { error: r.error };
  const next = String(fd.get('next') ?? '');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function logoutAction() {
  await logout();
  redirect('/login');
}

export async function changePasswordAction(_: { error: string; ok?: boolean }, fd: FormData) {
  const u = await requireUser();
  const current = String(fd.get('current') ?? '');
  const next = String(fd.get('next') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  if (next.length < 10) return { error: 'A nova senha precisa ter pelo menos 10 caracteres.' };
  if (next !== confirm) return { error: 'A confirmação não confere.' };
  const row = await one<{ password_hash: string }>('select password_hash from users where id=$1', [u.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) return { error: 'Senha atual incorreta.' };
  await q('update users set password_hash=$2, updated_at=now() where id=$1', [u.id, await hashPassword(next)]);
  return { error: '', ok: true };
}
