/**
 * Acesso ao Postgres.
 * - Produção (Vercel): node-postgres (pg) com o DATABASE_URL da integração Neon.
 * - Desenvolvimento/testes sem DATABASE_URL: PGlite (Postgres em WASM), em ./.data/pglite ou em memória.
 *
 * Toda escrita que envolve mais de uma tabela deve usar `tx()`: os rateios são validados
 * por trigger diferido no COMMIT.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Row = Record<string, unknown>;
export interface Q {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** vários comandos SQL sem parâmetros (usado pelas migrations) */
  exec(sql: string): Promise<void>;
}
export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// int8/numeric → number; date → 'YYYY-MM-DD' (nunca Date, para não sofrer com fuso horário)
const INT8 = 20, NUMERIC = 1700, DATE = 1082;

async function makePg(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(INT8, v => Number(v));
  pg.types.setTypeParser(NUMERIC, v => Number(v));
  pg.types.setTypeParser(DATE, v => v);
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000 });
  if (process.env.VERCEL) {
    try {
      const { attachDatabasePool } = await import('@vercel/functions');
      attachDatabasePool(pool);
    } catch { /* fora da Vercel */ }
  }
  const query = async <T,>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
  return {
    query,
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await fn({
          query: async <T,>(t: string, p: unknown[] = []) => (await client.query(t, p)).rows as T[],
          exec: async (sql: string) => { await client.query(sql); },
        });
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

async function makePglite(dir: string): Promise<Db> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const parsers = {
    [types.INT8]: (v: string) => Number(v),
    [types.NUMERIC]: (v: string) => Number(v),
    [types.DATE]: (v: string) => v,
  };
  if (dir !== 'memory') fs.mkdirSync(dir, { recursive: true });
  const db = dir === 'memory' ? new PGlite({ parsers }) : new PGlite(dir, { parsers });
  // PGlite é single-connection: serializa as transações para não intercalar comandos.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  return {
    query: <T,>(text: string, params: unknown[] = []) => serial(async () => (await db.query<T>(text, params)).rows),
    exec: sql => serial(async () => { await db.exec(sql); }),
    tx: fn => serial(() => db.transaction(async t => fn({
      query: async <T,>(text: string, params: unknown[] = []) => (await t.query<T>(text, params)).rows,
      exec: async (sql: string) => { await t.exec(sql); },
    }))),
    close: () => db.close(),
  };
}

export async function createDb(url = process.env.DATABASE_URL || process.env.POSTGRES_URL, pgliteDir = process.env.PGLITE_DIR ?? './.data/pglite'): Promise<Db> {
  if (url) return makePg(url);
  if (process.env.VERCEL) throw new Error('DATABASE_URL não configurada. Conecte o banco Neon ao projeto na Vercel.');
  return makePglite(pgliteDir);
}

// ---------------------------------------------------------------------
// Migrations: arquivos migrations/NNNN_nome.sql aplicados em ordem, uma vez.
// ---------------------------------------------------------------------
export function migrationFiles(dir = path.join(process.cwd(), 'migrations')) {
  return fs.readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().map(f => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

export async function migrate(db: Db, log: (m: string) => void = () => {}) {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map(r => r.name));
  for (const m of migrationFiles()) {
    if (done.has(m.name)) continue;
    await db.tx(async q => {
      await q.exec(m.sql);
      await q.query('insert into schema_migrations(name) values ($1)', [m.name]);
    });
    log(`migration aplicada: ${m.name}`);
  }
}

// ---------------------------------------------------------------------
// Singleton do app
// ---------------------------------------------------------------------
const g = globalThis as unknown as { __fpDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__fpDb) {
    g.__fpDb = (async () => {
      const db = await createDb();
      // Em desenvolvimento local (PGlite) as migrations e o usuário inicial são aplicados sozinhos.
      if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
        await migrate(db);
        const { ensureAdminUser } = await import('./bootstrap');
        await ensureAdminUser(db);
      }
      return db;
    })().catch(e => { g.__fpDb = undefined; throw e; });
  }
  return g.__fpDb;
}

export async function q<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  return (await getDb()).query<T>(text, params);
}
export async function one<T = Row>(text: string, params?: unknown[]): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await getDb()).tx(fn);
}
