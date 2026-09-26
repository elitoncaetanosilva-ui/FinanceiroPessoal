import type { Db, Q } from './db';
import { hashPassword } from './auth/password';
import { seedUserDefaults } from './seed';

/** Cria um usuário com as categorias, instituições e regras iniciais. */
export async function createUser(q: Q, email: string, password: string, name = '') {
  if (password.length < 10) throw new Error('A senha precisa ter pelo menos 10 caracteres.');
  const hash = await hashPassword(password);
  const r = await q.query<{ id: string }>(
    'insert into users(email, name, password_hash) values (lower($1), $2, $3) returning id',
    [email.trim(), name, hash],
  );
  await seedUserDefaults(q, r[0].id);
  return r[0].id;
}

/**
 * Garante o usuário inicial a partir de ADMIN_EMAIL/ADMIN_PASSWORD (só se ainda não houver usuários)
 * e reaplica o seed (idempotente) para todos os usuários — assim novas categorias de sistema chegam
 * em deploys futuros.
 */
export async function ensureAdminUser(db: Db, log: (m: string) => void = () => {}) {
  const users = await db.query<{ id: string }>('select id from users');
  if (!users.length) {
    const email = process.env.ADMIN_EMAIL || (process.env.VERCEL ? '' : 'dev@local');
    const password = process.env.ADMIN_PASSWORD || (process.env.VERCEL ? '' : 'dev-password-123');
    if (!email || !password) { log('nenhum usuário e ADMIN_EMAIL/ADMIN_PASSWORD ausentes — pulei a criação'); return; }
    await db.tx(q => createUser(q, email, password, process.env.ADMIN_NAME || ''));
    log(`usuário inicial criado: ${email}`);
    return;
  }
  for (const u of users) await db.tx(q => seedUserDefaults(q, u.id));
}
