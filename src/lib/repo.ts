import 'server-only';
import { q } from './db';
import { learnRules } from './categorize';
import type { Categoria, Lancamento, Natureza, NovoLancamento, Orcamento, Regra } from './types';
import { DEFAULT_CATEGORIAS, CARTOES_PADRAO } from './taxonomy';
import type { PlanilhaImport } from './planilha';
import { reconciliar } from './reconcile';
import { descKey } from './util';

const LANC_COLS = `id, origem, natureza, conta, data::text as data, vencimento::text as vencimento, descricao, parcela, parcelas,
  subgrupo, valor::float8 as valor, fonte, external_id, revisar, ignorado, nota`;

export async function getLancamentos(opts: { de?: string; ate?: string } = {}): Promise<Lancamento[]> {
  const cond: string[] = [], p: unknown[] = [];
  if (opts.de) { p.push(opts.de); cond.push(`vencimento >= $${p.length}`); }
  if (opts.ate) { p.push(opts.ate); cond.push(`vencimento <= $${p.length}`); }
  return q<Lancamento>(`select ${LANC_COLS} from lancamentos ${cond.length ? 'where ' + cond.join(' and ') : ''} order by vencimento, data, id`, p);
}

export async function getLancamento(id: number) {
  return (await q<Lancamento>(`select ${LANC_COLS} from lancamentos where id = $1`, [id]))[0] ?? null;
}

export async function getCategorias(): Promise<Categoria[]> {
  const rows = await q<Categoria>('select natureza, grupo, subgrupo, ordem from categorias order by ordem, subgrupo');
  return rows.length ? rows : DEFAULT_CATEGORIAS;
}

export async function getOrcamentos(): Promise<Orcamento[]> {
  return q<Orcamento>('select mes, natureza, subgrupo, valor::float8 as valor from orcamentos');
}

export async function getRegras(): Promise<Regra[]> {
  return q<Regra>('select id, padrao, tipo, natureza, subgrupo, origem from regras order by origem desc, padrao');
}

export async function getConfig<T>(chave: string, padrao: T): Promise<T> {
  const r = await q<{ valor: T }>('select valor from config where chave = $1', [chave]);
  return r.length ? r[0].valor : padrao;
}

export async function setConfig(chave: string, valor: unknown) {
  await q('insert into config (chave, valor) values ($1, $2::jsonb) on conflict (chave) do update set valor = excluded.valor', [chave, JSON.stringify(valor)]);
}

export const getSaldoInicial = () => getConfig<{ mes: string; valor: number } | null>('saldo_inicial', null);
export const getCartoes = () => getConfig<string[]>('cartoes', CARTOES_PADRAO);

// ---------- inserção em lote ----------

const INSERT_COLS = ['origem', 'natureza', 'conta', 'data', 'vencimento', 'descricao', 'parcela', 'parcelas', 'subgrupo', 'valor', 'fonte', 'external_id', 'revisar', 'ignorado', 'nota'] as const;
const RECORD_TYPES = `origem text, natureza text, conta text, data date, vencimento date, descricao text, parcela int, parcelas int,
  subgrupo text, valor numeric, fonte text, external_id text, revisar boolean, ignorado boolean, nota text`;

export async function insertLancamentos(ls: NovoLancamento[]) {
  for (let i = 0; i < ls.length; i += 400) {
    const chunk = ls.slice(i, i + 400).map(l => Object.fromEntries(INSERT_COLS.map(c => [c, l[c] ?? null])));
    await q(
      `insert into lancamentos (${INSERT_COLS.join(', ')})
       select ${INSERT_COLS.join(', ')} from jsonb_to_recordset($1::jsonb) as x(${RECORD_TYPES})
       on conflict (external_id) do nothing`,
      [JSON.stringify(chunk)],
    );
  }
}

// ---------- importação da planilha ----------

export async function importarPlanilha(imp: PlanilhaImport) {
  // Categorias
  const cats = JSON.stringify(imp.categorias);
  await q(
    `insert into categorias (natureza, grupo, subgrupo, ordem)
     select natureza, grupo, subgrupo, ordem from jsonb_to_recordset($1::jsonb) as x(natureza text, grupo text, subgrupo text, ordem int)
     on conflict (natureza, subgrupo) do update set grupo = excluded.grupo, ordem = excluded.ordem`,
    [cats],
  );

  // Lançamentos: substitui os que vieram da planilha. Os já conciliados com o banco (Pluggy) ficam,
  // e as linhas equivalentes da planilha são descartadas para não duplicar.
  await q(`delete from lancamentos where fonte = 'planilha'`);
  const existentes = await getLancamentos();
  const { novos } = reconciliar(imp.lancamentos, existentes.filter(l => l.fonte !== 'planilha'), { modo: 'planilha' });
  await insertLancamentos(novos);

  // Previsto (orçamento): substitui os meses presentes na planilha.
  const mesesOrc = [...new Set(imp.orcamentos.map(o => o.mes))];
  if (mesesOrc.length) await q('delete from orcamentos where mes = any($1::text[])', [mesesOrc]);
  if (imp.orcamentos.length) {
    await q(
      `insert into orcamentos (mes, natureza, subgrupo, valor)
       select mes, natureza, subgrupo, sum(valor) from jsonb_to_recordset($1::jsonb) as x(mes text, natureza text, subgrupo text, valor numeric)
       group by mes, natureza, subgrupo
       on conflict (mes, natureza, subgrupo) do update set valor = excluded.valor`,
      [JSON.stringify(imp.orcamentos)],
    );
  }

  if (imp.saldoInicial) await setConfig('saldo_inicial', imp.saldoInicial);
  if (imp.cartoes.length) await setConfig('cartoes', [...new Set([...imp.cartoes])]);
  await reaprenderRegras();
  return { inseridos: novos.length, ignorados: imp.lancamentos.length - novos.length };
}

/** Recalcula as regras aprendidas a partir de todo o histórico classificado. */
export async function reaprenderRegras() {
  const hist = await q<{ descricao: string; natureza: Natureza; subgrupo: string }>(
    `select descricao, natureza, subgrupo from lancamentos where not revisar and not ignorado`,
  );
  const regras = learnRules(hist);
  await q(`delete from regras where origem = 'aprendida'`);
  if (regras.length) {
    await q(
      `insert into regras (padrao, tipo, natureza, subgrupo, origem)
       select padrao, tipo, natureza, subgrupo, origem from jsonb_to_recordset($1::jsonb) as x(padrao text, tipo text, natureza text, subgrupo text, origem text)
       on conflict (padrao, tipo, natureza) do nothing`,
      [JSON.stringify(regras)],
    );
  }
  return regras.length;
}

// ---------- edição ----------

export async function atualizarCategoria(id: number, natureza: Natureza, subgrupo: string, lembrar: boolean) {
  const l = await getLancamento(id);
  if (!l) throw new Error('Lançamento não encontrado');
  await q(`update lancamentos set natureza = $2, subgrupo = $3, revisar = false, subgrupo_manual = true where id = $1`, [id, natureza, subgrupo]);
  let aplicados = 0;
  if (lembrar) {
    const padrao = descKey(l.descricao);
    if (padrao.length >= 3) {
      await q(
        `insert into regras (padrao, tipo, natureza, subgrupo, origem) values ($1, 'exata', $2, $3, 'usuario')
         on conflict (padrao, tipo, natureza) do update set subgrupo = excluded.subgrupo, origem = 'usuario'`,
        [padrao, natureza, subgrupo],
      );
      // Aplica a regra aos pendentes com a mesma descrição normalizada.
      const pend = await q<{ id: number; descricao: string }>(`select id, descricao from lancamentos where revisar and natureza = $1`, [natureza]);
      const ids = pend.filter(p => descKey(p.descricao) === padrao).map(p => p.id);
      if (ids.length) {
        await q(`update lancamentos set subgrupo = $2, revisar = false where id = any($1::int[])`, [ids, subgrupo]);
        aplicados = ids.length;
      }
    }
  }
  // Propaga para as demais parcelas da mesma compra.
  if (l.origem === 'cartao' && l.parcelas && l.parcelas > 1) {
    await q(
      `update lancamentos set subgrupo = $1, natureza = $2, revisar = false, subgrupo_manual = true
       where origem = 'cartao' and conta is not distinct from $3 and descricao = $4 and parcelas = $5 and valor = $6 and data = $7::date`,
      [subgrupo, natureza, l.conta, l.descricao, l.parcelas, l.valor, l.data],
    );
  }
  return { aplicados };
}

export async function atualizarLancamento(id: number, p: Partial<Pick<Lancamento, 'descricao' | 'valor' | 'data' | 'vencimento' | 'ignorado' | 'nota' | 'revisar'>>) {
  const sets: string[] = [], vals: unknown[] = [id];
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (sets.length) await q(`update lancamentos set ${sets.join(', ')} where id = $1`, vals);
}

export async function excluirLancamento(id: number) {
  await q('delete from lancamentos where id = $1', [id]);
}

export async function salvarOrcamento(mes: string, natureza: Natureza, subgrupo: string, valor: number | null) {
  if (valor == null) await q('delete from orcamentos where mes = $1 and natureza = $2 and subgrupo = $3', [mes, natureza, subgrupo]);
  else
    await q(
      `insert into orcamentos (mes, natureza, subgrupo, valor) values ($1, $2, $3, $4)
       on conflict (mes, natureza, subgrupo) do update set valor = excluded.valor`,
      [mes, natureza, subgrupo, valor],
    );
}

export async function excluirRegra(id: number) {
  await q('delete from regras where id = $1', [id]);
}

export async function contarPendentes() {
  const r = await q<{ n: number }>('select count(*)::int as n from lancamentos where revisar and not ignorado');
  return r[0]?.n ?? 0;
}

export async function apagarTudo() {
  for (const t of ['lancamentos', 'orcamentos', 'regras', 'config', 'pluggy_items', 'contas', 'sync_log', 'categorias']) await q(`delete from ${t}`);
}

export interface ContaBanco {
  id: string; item_id: string; tipo: string; subtipo: string | null; nome: string | null; apelido: string;
  saldo: number | null; limite: number | null; limite_disponivel: number | null; fechamento: string | null; vencimento: string | null; atualizado_em: string | null;
}
export async function getContas() {
  return q<ContaBanco>(`select id, item_id, tipo, subtipo, nome, apelido, saldo::float8 as saldo, limite::float8 as limite,
    limite_disponivel::float8 as limite_disponivel, fechamento::text as fechamento, vencimento::text as vencimento, atualizado_em::text as atualizado_em
    from contas order by tipo, apelido`);
}
export async function getItens() {
  return q<{ item_id: string; conector: string; status: string | null; erro: string | null; ultimo_sync: string | null }>(
    `select item_id, conector, status, erro, ultimo_sync::text as ultimo_sync from pluggy_items order by criado_em`);
}
export async function getSyncLog(limite = 8) {
  return q<{ em: string; item_id: string; novos: number; atualizados: number; conciliados: number; projetados: number; erro: string | null }>(
    `select em::text as em, item_id, novos, atualizados, conciliados, projetados, erro from sync_log order by em desc limit $1`, [limite]);
}
