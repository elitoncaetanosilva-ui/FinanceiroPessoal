/** Agregações para a tela de Análises (tudo a partir de categoryTotals — uma consulta por período). */
import { addMonths, monthEnd, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { coreDescription } from '@/lib/text';
import { balanceAt } from './balances';
import { categoryIndex, listAccounts, listCards } from './catalog';
import { categoryTotals, monthRange, summarize, type CatTotal } from './queries';
import type { Ctx } from './types';

export interface AnalyticsFilters { from: ISODate; to: ISODate; accountId?: string; cardId?: string; categoryId?: string }

export async function analytics(ctx: Ctx, f: AnalyticsFilters) {
  const idx = await categoryIndex(ctx);
  const months = monthRange(f.from, f.to);
  const histFrom = addMonths(months[0], -3, 1);
  let rows = await categoryTotals(ctx, histFrom, f.to, { accountId: f.accountId, cardId: f.cardId });
  if (f.categoryId) rows = rows.filter(r => r.category_id === f.categoryId || r.parent_id === f.categoryId);
  const financial = new Set(idx.all.filter(c => c.financial_income).map(c => c.id));
  const byMonth = new Map<string, CatTotal[]>();
  for (const r of rows) byMonth.set(r.competence, [...(byMonth.get(r.competence) ?? []), r]);

  const series = months.map(m => {
    const real = summarize(byMonth.get(m) ?? [], 'REALIZED', financial);
    const plan = summarize(byMonth.get(m) ?? [], 'PLANNED', financial);
    return {
      month: m, income: real.income, expense: real.expense + real.financingOut, plannedIncome: plan.income,
      plannedExpense: plan.expense + plan.financingOut, result: real.income - real.expense - real.financingOut,
      invested: real.investedNet, cardSpend: real.cardSpend,
    };
  });

  // gastos por categoria no período (despesas + dívidas, realizado)
  const cat = new Map<string, { id: string; name: string; total: number; subs: Map<string, number> }>();
  for (const r of rows) {
    if (r.status !== 'REALIZED' || !r.category_id || r.competence < months[0]) continue;
    if (r.nature !== 'EXPENSE' && r.nature !== 'FINANCING') continue;
    if (r.section !== 'OUT') continue;
    const c = idx.byId.get(r.category_id);
    const g = c?.parent_id ? idx.byId.get(c.parent_id) : c;
    if (!g) continue;
    const e = cat.get(g.id) ?? { id: g.id, name: g.name, total: 0, subs: new Map() };
    e.total += -r.amount;
    e.subs.set(r.category_id, (e.subs.get(r.category_id) ?? 0) - r.amount);
    cat.set(g.id, e);
  }
  const byCategory = [...cat.values()].filter(c => c.total > 0).sort((a, b) => b.total - a.total)
    .map(c => ({ ...c, subs: [...c.subs.entries()].map(([id, v]) => ({ id, name: idx.byId.get(id)?.name ?? '?', total: v })).sort((a, b) => b.total - a.total) }));

  // o que está aumentando: último mês do período × média dos 3 anteriores (por categoria)
  const last = months[months.length - 1];
  const prev3 = [addMonths(last, -1, 1), addMonths(last, -2, 1), addMonths(last, -3, 1)];
  const catMonth = (m: string) => {
    const out = new Map<string, number>();
    for (const r of byMonth.get(m) ?? []) {
      if (r.status !== 'REALIZED' || !r.category_id || (r.nature !== 'EXPENSE' && r.nature !== 'FINANCING') || r.section !== 'OUT') continue;
      const c = idx.byId.get(r.category_id);
      const gid = c?.parent_id ?? r.category_id;
      out.set(gid, (out.get(gid) ?? 0) - r.amount);
    }
    return out;
  };
  const lastMap = catMonth(last);
  const prevMaps = prev3.map(catMonth);
  const growth = [...new Set([...lastMap.keys(), ...prevMaps.flatMap(m => [...m.keys()])])].map(id => {
    const avg = Math.round(prevMaps.reduce((s, m) => s + (m.get(id) ?? 0), 0) / 3);
    const cur = lastMap.get(id) ?? 0;
    return { id, name: idx.byId.get(id)?.name ?? '?', current: cur, average: avg, diff: cur - avg };
  }).filter(g => g.current > 0 || g.average > 0).sort((a, b) => b.diff - a.diff);

  return { months, series, byCategory, growth, last };
}

/** Saldo disponível no fim de cada mês (a partir do saldo inicial das contas). */
export async function balanceHistory(ctx: Ctx, months: ISODate[], accountId?: string) {
  const accounts = (await listAccounts(ctx)).filter(a => (accountId ? a.id === accountId : a.is_active && a.in_available_balance));
  const today = todayFn();
  const out: { month: ISODate; balance: number | null }[] = [];
  for (const m of months) {
    const end = monthEnd(m) > today ? today : monthEnd(m);
    if (m > today) { out.push({ month: m, balance: null }); continue; }
    let total = 0, known = false;
    for (const a of accounts) {
      if (end < a.opening_balance_date) continue;
      total += await balanceAt(ctx, a, end);
      known = true;
    }
    out.push({ month: m, balance: known ? total : null });
  }
  return out;
}

/** Gastos por cartão por mês (competência = mês da fatura). */
export async function cardSpendByMonth(ctx: Ctx, months: ISODate[]) {
  const cards = await listCards(ctx, true);
  const rows = await ctx.q.query<{ card_id: string; competence: ISODate; v: number }>(
    `select m.card_id, m.competence, coalesce(-sum(m.amount_cents),0) as v from movements m
     where m.user_id=$1 and m.deleted_at is null and m.card_id is not null and m.kind='NORMAL' and m.status='REALIZED'
       and m.competence between $2 and $3 group by m.card_id, m.competence`,
    [ctx.userId, months[0], months[months.length - 1]]);
  return { cards: cards.map(c => ({ id: c.id, name: c.name })), data: months.map(m => ({ month: m, ...Object.fromEntries(cards.map(c => [c.id, rows.find(r => r.card_id === c.id && r.competence === m)?.v ?? 0])) })) };
}

/** Gastos que se repetem: mesma descrição (núcleo) em pelo menos 3 dos últimos 4 meses. */
export async function detectRecurring(ctx: Ctx) {
  const from = addMonths(monthStart(todayFn()), -4, 1);
  const rows = await ctx.q.query<{ description: string; competence: ISODate; amount_cents: number; recurring_rule_id: string | null }>(
    `select description, competence, amount_cents, recurring_rule_id from movements
     where user_id=$1 and deleted_at is null and status='REALIZED' and kind='NORMAL' and amount_cents<0 and competence >= $2 and installment_group_id is null`,
    [ctx.userId, from]);
  const g = new Map<string, { name: string; months: Set<string>; total: number; n: number; hasRule: boolean }>();
  for (const r of rows) {
    const k = coreDescription(r.description);
    if (k.length < 3) continue;
    const e = g.get(k) ?? { name: k, months: new Set(), total: 0, n: 0, hasRule: false };
    e.months.add(r.competence); e.total += -r.amount_cents; e.n++; e.hasRule ||= !!r.recurring_rule_id;
    g.set(k, e);
  }
  return [...g.values()].filter(x => x.months.size >= 3).map(x => ({ name: x.name, months: x.months.size, average: Math.round(x.total / x.months.size), hasRule: x.hasRule }))
    .sort((a, b) => b.average - a.average).slice(0, 20);
}
