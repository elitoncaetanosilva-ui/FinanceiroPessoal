/**
 * Movimentos recorrentes (salário, aluguel, escola...). Cada regra gera ocorrências PREVISTAS
 * até ~13 meses à frente. O dia da ocorrência fica em `due_date` (a "vaga" da ocorrência): se uma
 * ocorrência for excluída ou realizada por importação, a vaga não é gerada de novo.
 */
import { addDays, addMonths, dayOfMonth, parts, today as todayFn, type ISODate } from '@/lib/dates';
import { audit } from './audit';
import { insertMovement } from './movements';
import type { Ctx } from './types';
import { DomainError } from './types';

export interface RecurringRule {
  id: string; description: string; amount_cents: number; account_id: string | null; card_id: string | null;
  category_id: string | null; frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';
  interval_count: number; interval_unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'; start_date: ISODate; end_date: ISODate | null;
  day_of_month: number | null; match_pattern: string | null; amount_tolerance_pct: number; is_active: boolean;
}

export const FREQUENCY_LABEL = { WEEKLY: 'Semanal', BIWEEKLY: 'Quinzenal', MONTHLY: 'Mensal', YEARLY: 'Anual', CUSTOM: 'Personalizada' };

/** Datas das ocorrências da regra dentro de [from, to]. */
export function occurrences(r: Pick<RecurringRule, 'frequency' | 'interval_count' | 'interval_unit' | 'start_date' | 'end_date' | 'day_of_month'>, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const end = r.end_date && r.end_date < to ? r.end_date : to;
  const step = (d: ISODate, k: number): ISODate => {
    switch (r.frequency) {
      case 'WEEKLY': return addDays(r.start_date, 7 * k);
      case 'BIWEEKLY': return addDays(r.start_date, 14 * k);
      case 'MONTHLY': return addMonths(r.start_date, k, r.day_of_month ?? parts(r.start_date).d);
      case 'YEARLY': return addMonths(r.start_date, 12 * k);
      case 'CUSTOM': {
        const n = r.interval_count * k;
        if (r.interval_unit === 'DAY') return addDays(r.start_date, n);
        if (r.interval_unit === 'WEEK') return addDays(r.start_date, 7 * n);
        if (r.interval_unit === 'YEAR') return addMonths(r.start_date, 12 * n);
        return addMonths(r.start_date, n, r.day_of_month ?? parts(r.start_date).d);
      }
    }
    return d;
  };
  for (let k = 0; k < 2000; k++) {
    let d = step(r.start_date, k);
    if (k === 0 && r.frequency === 'MONTHLY' && r.day_of_month) {
      const p = parts(r.start_date);
      d = dayOfMonth(p.y, p.m, r.day_of_month);
      if (d < r.start_date) continue;
    }
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export async function listRules(ctx: Ctx) {
  return ctx.q.query<RecurringRule & { holder_name: string | null; category_label: string | null; next_date: ISODate | null }>(
    `select r.*, coalesce(a.name, c.name) as holder_name,
       (select p.name || ' › ' || k.name from categories k left join categories p on p.id=k.parent_id where k.id=r.category_id) as category_label,
       (select min(m.date) from movements m where m.recurring_rule_id=r.id and m.status='PLANNED' and m.deleted_at is null) as next_date
     from recurring_rules r left join accounts a on a.id=r.account_id left join credit_cards c on c.id=r.card_id
     where r.user_id=$1 order by r.is_active desc, r.description`,
    [ctx.userId],
  );
}

export async function getRule(ctx: Ctx, id: string) {
  const r = await ctx.q.query<RecurringRule>('select * from recurring_rules where id=$1 and user_id=$2', [id, ctx.userId]);
  if (!r[0]) throw new DomainError('Recorrência não encontrada.');
  return r[0];
}

export type RuleInput = Omit<RecurringRule, 'id' | 'is_active'> & { is_active?: boolean };

function validate(r: RuleInput) {
  if (!r.description.trim()) throw new DomainError('Descrição obrigatória.');
  if (!r.amount_cents) throw new DomainError('Informe o valor.');
  if (!!r.account_id === !!r.card_id) throw new DomainError('Informe uma conta ou um cartão.');
  if (r.end_date && r.end_date < r.start_date) throw new DomainError('O fim precisa ser depois do início.');
}

export async function saveRule(ctx: Ctx, input: RuleInput, id?: string) {
  validate(input);
  const vals = [input.description.trim(), input.amount_cents, input.account_id, input.card_id, input.category_id, input.frequency,
    input.interval_count || 1, input.interval_unit || 'MONTH', input.start_date, input.end_date, input.day_of_month,
    input.match_pattern?.trim() || null, input.amount_tolerance_pct ?? 10, input.is_active ?? true];
  let ruleId = id;
  if (id) {
    await ctx.q.query(
      `update recurring_rules set description=$3, amount_cents=$4, account_id=$5, card_id=$6, category_id=$7, frequency=$8,
         interval_count=$9, interval_unit=$10, start_date=$11, end_date=$12, day_of_month=$13, match_pattern=$14,
         amount_tolerance_pct=$15, is_active=$16, updated_at=now() where id=$1 and user_id=$2`,
      [id, ctx.userId, ...vals],
    );
    await audit(ctx, 'recurring_rule', id, 'UPDATE');
  } else {
    const r = await ctx.q.query<{ id: string }>(
      `insert into recurring_rules(user_id, description, amount_cents, account_id, card_id, category_id, frequency, interval_count,
         interval_unit, start_date, end_date, day_of_month, match_pattern, amount_tolerance_pct, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [ctx.userId, ...vals],
    );
    ruleId = r[0].id;
    await audit(ctx, 'recurring_rule', ruleId, 'CREATE');
  }
  await regenerate(ctx, ruleId!);
  return ruleId!;
}

/** Remove as ocorrências previstas futuras e gera de novo (após editar a regra). */
export async function regenerate(ctx: Ctx, ruleId: string) {
  const today = todayFn();
  await ctx.q.query(
    `delete from movements where recurring_rule_id=$1 and user_id=$2 and status='PLANNED' and source='RECURRING'
       and due_date >= $3 and link_id is null`,
    [ruleId, ctx.userId, today],
  );
  await generate(ctx, ruleId);
}

/** Gera as ocorrências previstas que faltam até o horizonte (idempotente). */
export async function generate(ctx: Ctx, ruleId: string, horizon = addDays(todayFn(), 400)) {
  const r = await getRule(ctx, ruleId);
  if (!r.is_active) return 0;
  const from = addDays(todayFn(), -45);                           // ocorrências recentes ainda não realizadas
  const dates = occurrences(r, r.start_date > from ? r.start_date : from, horizon);
  if (!dates.length) return 0;
  const taken = new Set((await ctx.q.query<{ due_date: ISODate }>(
    'select due_date from movements where recurring_rule_id=$1 and due_date is not null', [ruleId],
  )).map(x => x.due_date));
  let n = 0;
  for (const d of dates) {
    if (taken.has(d)) continue;
    await insertMovement(ctx, {
      accountId: r.account_id, cardId: r.card_id, amountCents: r.amount_cents, date: d, dueDate: d,
      description: r.description, status: 'PLANNED', source: 'RECURRING', categoryId: r.category_id,
      recurringRuleId: r.id, dedupKey: `rec:${r.id}:${d}`,
    }, { audit: false });
    n++;
  }
  return n;
}

export async function generateAll(ctx: Ctx) {
  const rules = await ctx.q.query<{ id: string }>('select id from recurring_rules where user_id=$1 and is_active', [ctx.userId]);
  let n = 0;
  for (const r of rules) n += await generate(ctx, r.id);
  return n;
}

/** Desativa a regra e remove as ocorrências previstas futuras. */
export async function deactivateRule(ctx: Ctx, ruleId: string) {
  await ctx.q.query('update recurring_rules set is_active=false, updated_at=now() where id=$1 and user_id=$2', [ruleId, ctx.userId]);
  await ctx.q.query(
    `update movements set deleted_at=now() where recurring_rule_id=$1 and user_id=$2 and status='PLANNED' and date >= $3 and deleted_at is null`,
    [ruleId, ctx.userId, todayFn()],
  );
  await audit(ctx, 'recurring_rule', ruleId, 'DEACTIVATE');
}
