import { createDb, migrate, type Db } from '@/server/db';
import { createUser } from '@/server/bootstrap';
import type { Ctx } from '@/server/domain/types';

export interface TestEnv { db: Db; ctx: Ctx; userId: string; cat(path: string): Promise<string> }

/** Banco novo em memória (PGlite) com migrations + usuário com o seed completo. */
export async function setup(): Promise<TestEnv> {
  const db = await createDb('', 'memory');
  await migrate(db);
  const userId = await db.tx(q => createUser(q, 'teste@local', 'senha-de-teste-123', 'Teste'));
  const ctx: Ctx = { q: db, userId };
  return {
    db, ctx, userId,
    async cat(path: string) {
      const [g, s] = path.split('>').map(x => x.trim());
      const r = await db.query<{ id: string }>(
        `select c.id from categories c join categories p on p.id=c.parent_id where c.user_id=$1 and p.name=$2 and c.name=$3`, [userId, g, s]);
      if (!r[0]) throw new Error('categoria não encontrada: ' + path);
      return r[0].id;
    },
  };
}

export async function account(env: TestEnv, name: string, type = 'CHECKING', opening = 0, date = '2026-01-01', available = true) {
  const r = await env.db.query<{ id: string }>(
    `insert into accounts(user_id, name, type, opening_balance_cents, opening_balance_date, in_available_balance) values ($1,$2,$3,$4,$5,$6) returning id`,
    [env.userId, name, type, opening, date, available]);
  return r[0].id;
}

export async function card(env: TestEnv, name: string, closing = 10, due = 17, limit = 1_000_000, paymentAccount: string | null = null, patterns: string[] = []) {
  const r = await env.db.query<{ id: string }>(
    `insert into credit_cards(user_id, name, closing_day, due_day, limit_cents, payment_account_id, payment_patterns) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [env.userId, name, closing, due, limit, paymentAccount, patterns]);
  return r[0].id;
}

/** Executa numa transação com o ctx da transação. */
export function inTx<T>(env: TestEnv, fn: (ctx: Ctx) => Promise<T>) {
  return env.db.tx(q => fn({ q, userId: env.userId }));
}
