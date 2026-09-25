import 'server-only';

/**
 * Acesso ao Postgres.
 * - Produção (Vercel): Neon serverless via DATABASE_URL (integração "Neon" do Marketplace da Vercel).
 * - Desenvolvimento/testes sem DATABASE_URL: PGlite (Postgres em WASM) salvo em ./.data/pglite
 *   ou em memória quando PGLITE_DIR=memory.
 */
type Row = Record<string, unknown>;
export type QueryFn = <T = Row>(text: string, params?: unknown[]) => Promise<T[]>;

const SCHEMA = `
create table if not exists categorias (
  natureza text not null,
  grupo text not null,
  subgrupo text not null,
  ordem int not null default 0,
  primary key (natureza, subgrupo)
);
create table if not exists lancamentos (
  id serial primary key,
  origem text not null,
  natureza text not null,
  conta text,
  data date not null,
  vencimento date not null,
  descricao text not null,
  parcela int,
  parcelas int,
  subgrupo text not null,
  valor numeric(14,2) not null,
  fonte text not null,
  external_id text unique,
  revisar boolean not null default false,
  ignorado boolean not null default false,
  subgrupo_manual boolean not null default false,
  nota text,
  criado_em timestamptz not null default now()
);
create index if not exists lancamentos_venc on lancamentos (vencimento);
create table if not exists orcamentos (
  mes text not null,
  natureza text not null,
  subgrupo text not null,
  valor numeric(14,2) not null,
  primary key (mes, natureza, subgrupo)
);
create table if not exists regras (
  id serial primary key,
  padrao text not null,
  tipo text not null,
  natureza text not null,
  subgrupo text not null,
  origem text not null,
  unique (padrao, tipo, natureza)
);
create table if not exists config (
  chave text primary key,
  valor jsonb not null
);
create table if not exists pluggy_items (
  item_id text primary key,
  conector text,
  status text,
  erro text,
  ultimo_sync timestamptz,
  criado_em timestamptz not null default now()
);
create table if not exists contas (
  id text primary key,
  item_id text not null,
  tipo text not null,
  subtipo text,
  nome text,
  apelido text not null,
  saldo numeric(14,2),
  limite numeric(14,2),
  limite_disponivel numeric(14,2),
  fechamento date,
  vencimento date,
  atualizado_em timestamptz
);
create table if not exists sync_log (
  id serial primary key,
  em timestamptz not null default now(),
  item_id text,
  novos int not null default 0,
  atualizados int not null default 0,
  conciliados int not null default 0,
  projetados int not null default 0,
  erro text
);
`;

let queryFn: QueryFn | null = null;
let ready: Promise<void> | null = null;

async function makeQuery(): Promise<QueryFn> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    return (async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as never[]) as QueryFn;
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL não configurada. Conecte um banco Neon ao projeto na Vercel.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR ?? './.data/pglite';
  const db = dir === 'memory' ? new PGlite() : new PGlite(dir);
  return (async (text: string, params: unknown[] = []) => {
    // PGlite não aceita vários comandos com parâmetros; o schema usa exec().
    if (!params.length && text.includes(';')) {
      await db.exec(text);
      return [];
    }
    return (await db.query(text, params)).rows as never[];
  }) as QueryFn;
}

async function init() {
  const q = await makeQuery();
  // Neon HTTP executa um comando por chamada.
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await q(stmt);
  queryFn = q;
}

export async function db(): Promise<QueryFn> {
  if (!ready) ready = init().catch(e => { ready = null; throw e; });
  await ready;
  return queryFn!;
}

/** Atalho: executa uma consulta. */
export async function q<T = Row>(text: string, params?: unknown[]) {
  return (await db())<T>(text, params);
}

/** Só para testes: reinicia a conexão (PGlite em memória). */
export function __resetDb() {
  queryFn = null;
  ready = null;
}
