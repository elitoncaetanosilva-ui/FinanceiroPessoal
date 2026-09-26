/**
 * Projeção de caixa: saldo disponível hoje + movimentos futuros conhecidos.
 *  - previstos em contas disponíveis (recorrências, parcelas em conta, lançamentos futuros);
 *    previstos vencidos e não realizados entram "hoje";
 *  - faturas de cartão: o que falta pagar de cada fatura sai na data de vencimento;
 *  - opcional: estimativa dos gastos/entradas variáveis pelo orçamento restante de cada mês
 *    (categorias sem recorrência, como mercado e combustível, deixariam a projeção otimista demais).
 */
import { addDays, addMonths, monthEnd, monthStart, parts, today as todayFn, type ISODate } from '@/lib/dates';
import { consolidated } from './balances';
import { budgetItems } from './budget';
import { categoryIndex, listCards } from './catalog';
import { statementViews } from './cards';
import { categoryTotals, monthRange } from './queries';
import type { Ctx } from './types';

export interface ProjectionEvent { date: ISODate; amount: number; label: string; kind: 'planned' | 'statement' | 'estimate' | 'overdue' }
export interface Projection {
  today: ISODate; start: number; horizon: ISODate;
  events: ProjectionEvent[];
  series: { date: ISODate; balance: number }[];
  checkpoints: { days: number; date: ISODate; balance: number }[];
  min: { date: ISODate; balance: number };
  months: { month: ISODate; inflow: number; outflow: number; end: number }[];
}

export async function projectCash(ctx: Ctx, opts: { days?: number; estimate?: boolean; today?: ISODate } = {}): Promise<Projection> {
  const today = opts.today ?? todayFn();
  const horizon = addDays(today, opts.days ?? 365);
  const cons = await consolidated(ctx);
  const available = cons.accounts.filter(a => a.is_active && a.in_available_balance);
  const availableIds = available.map(a => a.id);
  const events: ProjectionEvent[] = [];

  // 1) previstos em contas disponíveis (pagamentos de fatura previstos ficam por conta da fatura)
  if (availableIds.length) {
    const planned = await ctx.q.query<{ date: ISODate; amount_cents: number; description: string }>(
      `select date, amount_cents, description from movements
       where user_id=$1 and deleted_at is null and status='PLANNED' and account_id = any($2::uuid[])
         and kind <> 'CARD_PAYMENT' and date <= $3 and date >= $4`,
      [ctx.userId, availableIds, horizon, addDays(today, -60)],
    );
    for (const p of planned) {
      const overdue = p.date < today;
      events.push({ date: overdue ? today : p.date, amount: p.amount_cents, label: p.description, kind: overdue ? 'overdue' : 'planned' });
    }
  }

  // 2) faturas a pagar
  const cards = await listCards(ctx, true);
  for (const c of cards) {
    if (c.payment_account_id && !availableIds.includes(c.payment_account_id)) continue;
    const sts = await statementViews(ctx, c.id, addMonths(monthStart(today), -2, 1), monthStart(horizon));
    for (const s of sts) {
      if (s.remaining <= 0 || s.due_date > horizon) continue;
      if (s.due_date < addDays(today, -60)) continue;
      events.push({ date: s.due_date < today ? today : s.due_date, amount: -s.remaining, label: `Fatura ${c.name}`, kind: s.due_date < today ? 'overdue' : 'statement' });
    }
  }

  // 3) estimativa pelo orçamento restante
  if (opts.estimate) {
    const idx = await categoryIndex(ctx);
    const months = monthRange(monthStart(today), monthStart(horizon));
    const totals = await categoryTotals(ctx, months[0], months[months.length - 1]);
    const used = new Map<string, number>();
    for (const t of totals) {
      if (!t.category_id) continue;
      const cat = idx.byId.get(t.category_id);
      if (!cat) continue;
      const k = `${t.competence}|${cat.id}`;
      used.set(k, (used.get(k) ?? 0) + (cat.section === 'IN' ? t.amount : -t.amount));
      if (cat.parent_id) {
        const gk = `${t.competence}|${cat.parent_id}`;
        used.set(gk, (used.get(gk) ?? 0) + (cat.section === 'IN' ? t.amount : -t.amount));
      }
    }
    const byYear = new Map<number, Map<string, number[]>>();
    for (const m of months) {
      const { y, m: mo } = parts(m);
      if (!byYear.has(y)) byYear.set(y, await budgetItems(ctx, y));
      const items = byYear.get(y)!;
      let inflow = 0, outflow = 0;
      for (const [catId, vals] of items) {
        const cat = idx.byId.get(catId);
        if (!cat || cat.is_hidden || cat.nature === 'TRANSFER' || cat.nature === 'ADJUSTMENT') continue;
        // orçamento de categoria só vale se as subcategorias não tiverem orçamento próprio
        if (!cat.parent_id && (idx.children.get(cat.id) ?? []).some(k => (items.get(k.id)?.[mo - 1] ?? 0) > 0)) continue;
        const remaining = (vals[mo - 1] ?? 0) - (used.get(`${m}|${cat.id}`) ?? 0);
        if (remaining <= 0) continue;
        if (cat.section === 'IN') inflow += remaining; else outflow += remaining;
      }
      if (!inflow && !outflow) continue;
      const mid = m === monthStart(today) ? (today > addDays(m, 14) ? today : addDays(m, 14)) : addDays(m, 14);
      const date = mid > monthEnd(m) ? monthEnd(m) : mid;
      if (date > horizon) continue;
      if (inflow) events.push({ date, amount: inflow, label: 'Entradas estimadas (orçamento restante)', kind: 'estimate' });
      if (outflow) events.push({ date, amount: -outflow, label: 'Gastos estimados (orçamento restante)', kind: 'estimate' });
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  let bal = cons.available;
  const series: Projection['series'] = [{ date: today, balance: bal }];
  let min = { date: today, balance: bal };
  for (const e of events) {
    bal += e.amount;
    const last = series[series.length - 1];
    if (last.date === e.date) last.balance = bal; else series.push({ date: e.date, balance: bal });
    if (bal < min.balance) min = { date: e.date, balance: bal };
  }
  const at = (d: ISODate) => { let b = cons.available; for (const e of events) { if (e.date > d) break; b += e.amount; } return b; };
  const checkpoints = [30, 60, 90, 180, 365].filter(d => d <= (opts.days ?? 365)).map(d => ({ days: d, date: addDays(today, d), balance: at(addDays(today, d)) }));
  const months = monthRange(monthStart(today), monthStart(horizon)).map(m => {
    const ev = events.filter(e => monthStart(e.date) === m);
    return { month: m, inflow: ev.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0), outflow: -ev.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0), end: at(monthEnd(m)) };
  });
  return { today, start: cons.available, horizon, events, series, checkpoints, min, months };
}
