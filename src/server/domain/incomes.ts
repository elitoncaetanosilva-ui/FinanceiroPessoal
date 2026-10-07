/**
 * Conciliação das receitas mensais informadas pelo usuário (ex.: a tabela de entradas da planilha CAIXA MENSAL).
 *
 * Para cada mês e subcategoria de entrada (valor realizado):
 *   1. já existe no app uma parte de rateio com essa subcategoria, competência no mês e mesmo valor → mantém.
 *      Histórico migrado com data no dia 1º passa para o primeiro dia útil do mês;
 *   2. senão, procura no extrato daquele mês um crédito pendente (ou classificado como entrada) cujo valor seja
 *      igual a uma receita ou à soma de várias (ex.: uma TED com salário + rescisão) → classifica / rateia;
 *   3. o que sobrar é lançado no primeiro dia útil do mês. Antes do saldo inicial da conta principal (histórico)
 *      vai para ela; depois, para a conta "Outras contas" — assim a conta principal continua conferindo com o
 *      saldo do banco (o dinheiro não passou por ela). Meses sem extrato importado ficam aguardando.
 * Idempotente: rodar de novo não duplica nem altera nada.
 */
import { firstBusinessDay, monthStart, type ISODate } from '@/lib/dates';
import { norm } from '@/lib/text';
import { categoryIndex } from './catalog';
import { insertMovement, setSplits } from './movements';
import { DomainError, type Ctx } from './types';

export interface IncomeEntry { month: ISODate; group: string; sub: string; cents: number }
export interface IncomeResult { kept: number; redated: number; classified: number; splitMovements: number; createdMain: number; createdOther: number; divergent: number; waiting: number }

export const OTHER_ACCOUNT_NAME = 'Outras contas';

export async function reconcileIncomes(ctx: Ctx, accountId: string, entries: IncomeEntry[]): Promise<IncomeResult> {
  const acc = (await ctx.q.query<{ id: string; opening_balance_date: ISODate }>(
    'select id, opening_balance_date from accounts where id=$1 and user_id=$2', [accountId, ctx.userId]))[0];
  if (!acc) throw new DomainError('Conta inválida.');
  const idx = await categoryIndex(ctx);
  const catOf = (group: string, sub: string) => {
    const cands = idx.all.filter(c => c.parent_id && c.section === 'IN' && norm(c.name) === norm(sub));
    const c = cands.find(x => norm(idx.byId.get(x.parent_id!)?.name ?? '') === norm(group)) ?? cands[0];
    if (!c) throw new DomainError(`Subcategoria de entrada não encontrada: ${sub}`);
    return c.id;
  };
  const inCats = new Set(idx.all.filter(c => c.section === 'IN').map(c => c.id));
  const res: IncomeResult = { kept: 0, redated: 0, classified: 0, splitMovements: 0, createdMain: 0, createdOther: 0, divergent: 0, waiting: 0 };

  const byMonth = new Map<ISODate, (IncomeEntry & { cat: string })[]>();
  for (const e of entries) {
    if (!Number.isInteger(e.cents) || e.cents <= 0) throw new DomainError('Valor de receita inválido.');
    const m = monthStart(e.month);
    byMonth.set(m, [...(byMonth.get(m) ?? []), { ...e, month: m, cat: catOf(e.group, e.sub) }]);
  }

  for (const [month, list] of [...byMonth].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fbd = firstBusinessDay(month);
    const usedSplits = new Set<string>();
    const left: typeof list = [];
    // 1) já no app
    for (const e of list) {
      const found = (await ctx.q.query<{ split_id: string; id: string; date: ISODate; source: string; dedup_key: string | null; n: number }>(
        `select x.id as split_id, m.id, m.date, m.source, m.dedup_key, (select count(*)::int from movement_splits y where y.movement_id=m.id) as n
         from movement_splits x join movements m on m.id=x.movement_id
         where m.user_id=$1 and m.deleted_at is null and m.status='REALIZED' and x.category_id=$2 and x.amount_cents=$3
           and date_trunc('month', m.competence)::date=$4
         order by m.date`, [ctx.userId, e.cat, e.cents, month])).find(f => !usedSplits.has(f.split_id));
      if (!found) { left.push(e); continue; }
      usedSplits.add(found.split_id);
      res.kept++;
      if (found.source === 'MIGRATION' && found.n === 1 && found.date === month && fbd !== month) {
        await ctx.q.query('update movements set date=$2, paid_date=case when account_id is not null then $2::date end, updated_at=now() where id=$1', [found.id, fbd]);
        res.redated++;
      }
    }
    if (!left.length) continue;

    // 2) créditos do extrato no mês (pendentes ou classificados como entrada), valor = uma receita ou soma de várias
    const credits = await ctx.q.query<{ id: string; amount_cents: number; cats: (string | null)[]; splits: string[] }>(
      `select m.id, m.amount_cents, array_agg(x.category_id) as cats, array_agg(x.id) as splits
       from movements m join movement_splits x on x.movement_id=m.id
       where m.user_id=$1 and m.account_id=$2 and m.deleted_at is null and m.status='REALIZED' and m.kind='NORMAL'
         and m.amount_cents > 0 and m.source='IMPORT' and date_trunc('month', m.date)::date=$3
       group by m.id order by m.date`, [ctx.userId, accountId, month]);
    for (const c of credits) {
      if (!left.length) break;
      if (!c.cats.every(x => x === null || inCats.has(x))) continue;   // ex.: reembolso classificado como despesa
      if (c.splits.some(x => usedSplits.has(x))) continue;              // já é de outra receita deste mês
      const pick = subsetSum(left.map(e => e.cents), c.amount_cents);
      if (!pick) continue;
      const parts = pick.map(i => left[i]);
      await setSplits(ctx, c.id, parts.map(e => ({ categoryId: e.cat, amountCents: e.cents })));
      res.classified += parts.length;
      if (parts.length > 1) res.splitMovements++;
      for (const i of [...pick].sort((a, b) => b - a)) left.splice(i, 1);
    }

    // 3) lança o que faltou no primeiro dia útil (depois do saldo inicial, só com o extrato do mês já importado:
    //    sem ele a receita pode ainda chegar pelo extrato e seria contada duas vezes)
    const historic = fbd <= acc.opening_balance_date;
    if (!historic && !credits.length) {
      const imported = await ctx.q.query('select 1 from movements where account_id=$1 and source=\'IMPORT\' and deleted_at is null and date_trunc(\'month\', date)::date=$2 limit 1', [accountId, month]);
      if (!imported[0]) { res.waiting += left.length; continue; }
    }
    for (const e of left) {
      const target = historic ? accountId : await otherAccount(ctx, acc.opening_balance_date);
      const key = historic ? `mig|inc|${norm(e.group)}|${norm(e.sub)}|${month}` : `inc|${norm(e.group)}|${norm(e.sub)}|${month}`;
      const dup = await ctx.q.query<{ id: string }>(
        'select id from movements where account_id=$1 and dedup_key=$2 and deleted_at is null', [target, key]);
      if (dup[0]) { res.divergent++; continue; }   // já lançado com outro valor/categoria: não mexe
      await insertMovement(ctx, {
        accountId: target, amountCents: e.cents, date: fbd, competence: month, description: e.sub,
        categoryId: e.cat, source: 'MIGRATION', dedupKey: key, status: 'REALIZED',
        notes: historic ? null : 'Receita informada na planilha; não aparece no extrato da conta principal.',
      }, { audit: false });
      if (historic) res.createdMain++; else res.createdOther++;
    }
  }
  return res;
}

async function otherAccount(ctx: Ctx, opening: ISODate) {
  const r = await ctx.q.query<{ id: string }>('select id from accounts where user_id=$1 and name=$2', [ctx.userId, OTHER_ACCOUNT_NAME]);
  if (r[0]) return r[0].id;
  const n = await ctx.q.query<{ id: string }>(
    `insert into accounts(user_id, name, type, opening_balance_cents, opening_balance_date, in_available_balance)
     values ($1,$2,'OTHER',0,$3,true) returning id`, [ctx.userId, OTHER_ACCOUNT_NAME, opening]);
  return n[0].id;
}

/** Índices de um subconjunto (o menor possível) cuja soma é `target`; null se não houver. */
export function subsetSum(values: number[], target: number): number[] | null {
  const n = Math.min(values.length, 16);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += values[i]; idx.push(i); }
    if (s === target && (!best || idx.length < best.length)) best = idx;
  }
  return best;
}
