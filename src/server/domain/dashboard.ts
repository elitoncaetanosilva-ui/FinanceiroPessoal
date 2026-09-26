import { addMonths, monthEnd, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { consolidated } from './balances';
import { budgetView } from './budget';
import { cardSummaries } from './cards';
import { autoRealizeInstallments } from './movements';
import { projectCash } from './projection';
import { cashFlow, categoryTotals, countPending, summarize } from './queries';
import type { Ctx } from './types';

export async function dashboardData(ctx: Ctx, month?: ISODate) {
  const today = todayFn();
  const m = monthStart(month ?? today);
  await autoRealizeInstallments(ctx, today);
  const [cons, totals, budget, cards, pending, cash] = await Promise.all([
    consolidated(ctx),
    categoryTotals(ctx, m, m),
    budgetView(ctx, m),
    cardSummaries(ctx),
    countPending(ctx),
    cashFlow(ctx, m, monthEnd(m)),
  ]);
  const financial = new Set(totals.filter(t => t.category_id).map(t => t.category_id!));
  const realized = summarize(totals, 'REALIZED', financial);
  const planned = summarize(totals, 'PLANNED', financial);
  const projection = await projectCash(ctx, { days: 365, estimate: true, today });

  // comprometimento da renda: dívidas + recorrentes + parcelas do mês / entradas (realizado + previsto)
  const commit = await ctx.q.query<{ v: number }>(
    `select coalesce(-sum(s.amount_cents),0) as v from movement_splits s join movements m on m.id=s.movement_id
     join categories c on c.id=s.category_id
     where m.user_id=$1 and m.deleted_at is null and m.status in ('PLANNED','REALIZED') and m.competence=$2
       and c.section='OUT' and c.nature in ('EXPENSE','FINANCING')
       and (m.recurring_rule_id is not null or m.installment_group_id is not null or c.nature='FINANCING')`,
    [ctx.userId, m],
  );
  const incomeRP = realized.income + planned.income;
  const commitment = { amount: commit[0].v, income: incomeRP, ratio: incomeRP > 0 ? commit[0].v / incomeRP : null };

  const next = cards.flatMap(c => c.upcoming).reduce((s, x) => s + Math.max(0, x.remaining), 0);
  return {
    month: m, today, cons, realized, planned, budget, cards, pending, cash, projection, commitment,
    futureStatements: next,
    result: realized.income - realized.expense - realized.financingOut,
    resultProjected: realized.income + planned.income - realized.expense - planned.expense - realized.financingOut - planned.financingOut,
    prevMonth: addMonths(m, -1, 1), nextMonth: addMonths(m, 1, 1),
  };
}
