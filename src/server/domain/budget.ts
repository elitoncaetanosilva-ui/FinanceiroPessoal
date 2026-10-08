/**
 * Orçamento anual e as quatro visões: Orçado, Realizado, Previsto e Realizado + Previsto.
 * Valores exibidos no "sentido natural" da seção: Entradas positivas quando entram; Saídas positivas quando saem.
 * Orçamento de categoria = valor da própria categoria, se definido; senão a soma das subcategorias.
 */
import { monthStart, parts, type ISODate } from '@/lib/dates';
import { categoryIndex } from './catalog';
import { categoryTotals, type CatTotal } from './queries';
import type { Category, Ctx } from './types';

export async function ensureBudget(ctx: Ctx, year: number) {
  const r = await ctx.q.query<{ id: string }>(
    'insert into budgets(user_id, year) values ($1,$2) on conflict (user_id, year) do update set year=excluded.year returning id',
    [ctx.userId, year],
  );
  return r[0].id;
}

/** Itens do orçamento do ano: categoria → 12 valores (centavos). */
export async function budgetItems(ctx: Ctx, year: number) {
  const rows = await ctx.q.query<{ category_id: string; month: number; amount_cents: number }>(
    `select i.category_id, i.month, i.amount_cents from budget_items i join budgets b on b.id=i.budget_id
     where b.user_id=$1 and b.year=$2`,
    [ctx.userId, year],
  );
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const arr = map.get(r.category_id) ?? Array(12).fill(0);
    arr[r.month - 1] = r.amount_cents;
    map.set(r.category_id, arr);
  }
  return map;
}

export async function setBudgetValues(ctx: Ctx, year: number, categoryId: string, months: number[], amountCents: number) {
  if (!Number.isInteger(amountCents)) throw new Error('Valor de orçamento inválido.');
  const cat = await ctx.q.query('select 1 from categories where id=$1 and user_id=$2', [categoryId, ctx.userId]);
  if (!cat[0]) throw new Error('Categoria inválida.');
  const budgetId = await ensureBudget(ctx, year);
  for (const m of months) {
    if (m < 1 || m > 12) continue;
    if (amountCents === 0) {
      await ctx.q.query('delete from budget_items where budget_id=$1 and category_id=$2 and month=$3', [budgetId, categoryId, m]);
    } else {
      await ctx.q.query(
        `insert into budget_items(budget_id, category_id, month, amount_cents) values ($1,$2,$3,$4)
         on conflict (budget_id, category_id, month) do update set amount_cents=excluded.amount_cents`,
        [budgetId, categoryId, m, amountCents],
      );
    }
  }
}

/** Copia o orçamento de um ano para outro (sobrescreve apenas as categorias/meses copiados). */
export async function copyBudgetYear(ctx: Ctx, fromYear: number, toYear: number) {
  const src = await budgetItems(ctx, fromYear);
  const budgetId = await ensureBudget(ctx, toYear);
  let n = 0;
  for (const [cat, months] of src) {
    for (let i = 0; i < 12; i++) {
      if (!months[i]) continue;
      await ctx.q.query(
        `insert into budget_items(budget_id, category_id, month, amount_cents) values ($1,$2,$3,$4)
         on conflict (budget_id, category_id, month) do update set amount_cents=excluded.amount_cents`,
        [budgetId, cat, i + 1, months[i]],
      );
      n++;
    }
  }
  return n;
}

export interface BudgetLine {
  category: Category; isGroup: boolean;
  budget: number; realized: number; planned: number; projected: number; deviation: number;
  children?: BudgetLine[];
}
export interface BudgetView {
  month: ISODate;
  sections: { section: 'IN' | 'OUT'; label: string; lines: BudgetLine[]; total: Omit<BudgetLine, 'category' | 'isGroup' | 'children'> }[];
  spending: { budget: number; realized: number; planned: number; projected: number; deviation: number }; // despesas + dívidas
  unclassified: { realized: number; planned: number; outflow: number; inflow: number };
}

/** Valor de uma linha no sentido da seção (entradas +, saídas +). Pernas em contas de investimento não contam para transferências/aportes. */
function contribution(r: CatTotal) {
  if ((r.nature === 'TRANSFER' || r.nature === 'INVESTMENT') && !r.available_account && !r.on_card) return 0;
  return r.section === 'IN' ? r.amount : -r.amount;
}

export async function budgetView(ctx: Ctx, month: ISODate, filters: { accountId?: string; cardId?: string } = {}): Promise<BudgetView> {
  const m = monthStart(month);
  const { y, m: mo } = parts(m);
  const [idx, items, totals] = await Promise.all([categoryIndex(ctx), budgetItems(ctx, y), categoryTotals(ctx, m, m, filters)]);
  const real = new Map<string, number>(), plan = new Map<string, number>();
  let unR = 0, unP = 0, unOut = 0, unIn = 0;
  for (const r of totals) {
    if (!r.category_id) {
      if (r.status === 'REALIZED') unR += -r.amount; else unP += -r.amount;
      if (r.amount < 0) unOut += -r.amount; else unIn += r.amount;
      continue;
    }
    const target = r.status === 'REALIZED' ? real : plan;
    target.set(r.category_id, (target.get(r.category_id) ?? 0) + contribution(r));
  }
  const b = (id: string) => items.get(id)?.[mo - 1] ?? 0;
  const line = (c: Category, isGroup: boolean, budget: number, realized: number, planned: number, children?: BudgetLine[]): BudgetLine => {
    const projected = realized + planned;
    return { category: c, isGroup, budget, realized, planned, projected, deviation: projected - budget, children };
  };
  const sections: BudgetView['sections'] = [];
  const spending = { budget: 0, realized: 0, planned: 0, projected: 0, deviation: 0 };
  for (const section of ['IN', 'OUT'] as const) {
    const lines: BudgetLine[] = [];
    for (const g of idx.groups.filter(g => g.section === section && !g.is_hidden)) {
      const kids = (idx.children.get(g.id) ?? []).filter(c => !c.is_hidden);
      const childLines = kids.map(c => line(c, false, b(c.id), real.get(c.id) ?? 0, plan.get(c.id) ?? 0));
      const hasActivity = (x: BudgetLine) => x.budget || x.realized || x.planned;
      const visibleKids = childLines.filter(x => hasActivity(x) || x.category.is_active);
      const groupBudget = b(g.id) || childLines.reduce((s, x) => s + x.budget, 0);
      const gl = line(g, true, groupBudget,
        childLines.reduce((s, x) => s + x.realized, 0) + (real.get(g.id) ?? 0),
        childLines.reduce((s, x) => s + x.planned, 0) + (plan.get(g.id) ?? 0), visibleKids);
      if (!g.is_active && !hasActivity(gl)) continue;
      lines.push(gl);
      if (section === 'OUT') for (const c of childLines) {
        if (c.category.nature === 'EXPENSE' || c.category.nature === 'FINANCING') {
          spending.budget += c.budget; spending.realized += c.realized; spending.planned += c.planned;
        }
      }
      if (section === 'OUT' && b(g.id) && (g.nature === 'EXPENSE' || g.nature === 'FINANCING')) {
        // orçamento definido no nível da categoria substitui a soma das subcategorias
        spending.budget += b(g.id) - childLines.reduce((s, x) => s + x.budget, 0);
      }
    }
    const total = lines.reduce((t, l) => ({ budget: t.budget + l.budget, realized: t.realized + l.realized, planned: t.planned + l.planned, projected: t.projected + l.projected, deviation: t.deviation + l.deviation }),
      { budget: 0, realized: 0, planned: 0, projected: 0, deviation: 0 });
    sections.push({ section, label: section === 'IN' ? 'Total de entradas' : 'Total de saídas', lines, total });
  }
  spending.projected = spending.realized + spending.planned;
  spending.deviation = spending.projected - spending.budget;
  return { month: m, sections, spending, unclassified: { realized: unR, planned: unP, outflow: unOut, inflow: unIn } };
}
