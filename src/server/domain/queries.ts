/** Consultas de leitura: lista de movimentos (com filtros e paginação) e agregações por categoria. */
import { addMonths, monthStart, type ISODate } from '@/lib/dates';
import { norm } from '@/lib/text';
import type { Ctx, MovementKind, MovementSource, MovementStatus, Nature } from './types';

export interface MovementFilters {
  month?: ISODate;                 // competência (YYYY-MM-01)
  from?: ISODate; to?: ISODate;    // intervalo de datas (campo `date`)
  text?: string;
  accountId?: string; cardId?: string; statementId?: string;
  categoryId?: string;             // categoria ou subcategoria
  status?: MovementStatus;
  pending?: boolean;
  nature?: Nature;
  kind?: MovementKind;
  source?: MovementSource;
  batchId?: string;
  groupId?: string;
  ruleId?: string;
  planned?: 'only' | 'exclude';
  holderKind?: 'account' | 'card';
}

export interface MovementListItem {
  id: string; date: ISODate; competence: ISODate; description: string; amount_cents: number; category_amount: number | null;
  status: MovementStatus; kind: MovementKind; source: MovementSource; notes: string | null;
  account_id: string | null; account_name: string | null; card_id: string | null; card_name: string | null;
  statement_due: ISODate | null; installment_number: number | null; installment_total: number | null;
  category_id: string | null; category_name: string | null; group_name: string | null; nature: Nature | null;
  split_count: number; pending: boolean; suggested_category_id: string | null; suggestion_confidence: number | null;
  link_id: string | null; recurring_rule_id: string | null; due_date: ISODate | null;
}

function where(f: MovementFilters, params: unknown[]) {
  const w: string[] = ['m.user_id = $1', 'm.deleted_at is null'];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.month) w.push(`m.competence = ${p(monthStart(f.month))}`);
  if (f.from) w.push(`m.date >= ${p(f.from)}`);
  if (f.to) w.push(`m.date <= ${p(f.to)}`);
  if (f.text?.trim()) {
    const t = norm(f.text);
    const cents = /^[\d.,]+$/.test(f.text.trim()) ? Math.round(Number(f.text.trim().replace(/\./g, '').replace(',', '.')) * 100) : null;
    w.push(cents ? `(m.normalized_description like ${p('%' + t + '%')} or abs(m.amount_cents) = ${p(cents)})` : `m.normalized_description like ${p('%' + t + '%')}`);
  }
  if (f.accountId) w.push(`m.account_id = ${p(f.accountId)}`);
  if (f.cardId) w.push(`m.card_id = ${p(f.cardId)}`);
  if (f.statementId) w.push(`m.statement_id = ${p(f.statementId)}`);
  if (f.status) w.push(`m.status = ${p(f.status)}`);
  else w.push(`m.status <> 'CANCELLED'`);
  if (f.planned === 'only') w.push(`m.status = 'PLANNED'`);
  if (f.planned === 'exclude') w.push(`m.status = 'REALIZED'`);
  if (f.kind) w.push(`m.kind = ${p(f.kind)}`);
  if (f.holderKind === 'card') w.push('m.card_id is not null');
  if (f.holderKind === 'account') w.push('m.account_id is not null');
  if (f.source) w.push(`m.source = ${p(f.source)}`);
  if (f.batchId) w.push(`m.import_batch_id = ${p(f.batchId)}`);
  if (f.groupId) w.push(`m.installment_group_id = ${p(f.groupId)}`);
  if (f.ruleId) w.push(`m.recurring_rule_id = ${p(f.ruleId)}`);
  if (f.pending) w.push(`exists (select 1 from movement_splits s where s.movement_id=m.id and s.category_id is null)`);
  if (f.categoryId) w.push(`exists (select 1 from movement_splits s join categories c on c.id=s.category_id where s.movement_id=m.id and (c.id=${p(f.categoryId)} or c.parent_id=$${params.length}))`);
  if (f.nature) w.push(`exists (select 1 from movement_splits s join categories c on c.id=s.category_id where s.movement_id=m.id and c.nature=${p(f.nature)})`);
  return w.join(' and ');
}

export async function listMovements(ctx: Ctx, f: MovementFilters, cursor?: { date: ISODate; id: string } | null, limit = 50) {
  const params: unknown[] = [ctx.userId];
  let w = where(f, params);
  if (cursor) {
    params.push(cursor.date, cursor.id);
    w += ` and (m.date, m.id) < ($${params.length - 1}::date, $${params.length}::uuid)`;
  }
  const catParam = f.categoryId ? (params.push(f.categoryId), `$${params.length}`) : null;
  const natParam = f.nature ? (params.push(f.nature), `$${params.length}`) : null;
  params.push(limit + 1);
  const rows = await ctx.q.query<MovementListItem>(
    `select m.id, m.date, m.competence, m.description, m.amount_cents, m.status, m.kind, m.source, m.notes,
       m.account_id, a.name as account_name, m.card_id, cc.name as card_name, st.due_date as statement_due,
       m.installment_number, m.installment_total, m.suggested_category_id, m.suggestion_confidence, m.link_id,
       m.recurring_rule_id, m.due_date,
       sp.category_id, c.name as category_name, g.name as group_name, c.nature,
       sp.n as split_count, sp.pending,
       ${catParam || natParam ? `(select sum(s2.amount_cents) from movement_splits s2 join categories c2 on c2.id=s2.category_id
          where s2.movement_id=m.id ${catParam ? `and (c2.id=${catParam} or c2.parent_id=${catParam})` : ''} ${natParam ? `and c2.nature=${natParam}` : ''})` : 'null'} as category_amount
     from movements m
     left join accounts a on a.id=m.account_id
     left join credit_cards cc on cc.id=m.card_id
     left join card_statements st on st.id=m.statement_id
     left join lateral (
       select (array_agg(s.category_id order by s.sort_order, s.id))[1] as category_id, count(*)::int as n,
              bool_or(s.category_id is null) as pending
       from movement_splits s where s.movement_id=m.id
     ) sp on true
     left join categories c on c.id=sp.category_id
     left join categories g on g.id=c.parent_id
     where ${w}
     order by m.date desc, m.id desc
     limit $${params.length}`,
    params,
  );
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, next: more && last ? { date: last.date, id: last.id } : null };
}

/** Totais do filtro (entradas e saídas, sem transferências internas e pagamentos de fatura). */
export async function sumMovements(ctx: Ctx, f: MovementFilters) {
  const params: unknown[] = [ctx.userId];
  const w = where(f, params);
  const r = await ctx.q.query<{ inflow: number; outflow: number; n: number }>(
    `select coalesce(sum(m.amount_cents) filter (where m.amount_cents > 0 and m.kind in ('NORMAL','ADJUSTMENT')), 0) as inflow,
            coalesce(-sum(m.amount_cents) filter (where m.amount_cents < 0 and m.kind in ('NORMAL','ADJUSTMENT')), 0) as outflow,
            count(*)::int as n
     from movements m where ${w}`,
    params,
  );
  return r[0];
}

export async function countPending(ctx: Ctx) {
  const r = await ctx.q.query<{ n: number }>(
    `select count(distinct s.movement_id)::int as n from movement_splits s join movements m on m.id=s.movement_id
     where s.user_id=$1 and s.category_id is null and m.deleted_at is null and m.status<>'CANCELLED'`,
    [ctx.userId],
  );
  return r[0].n;
}

/** Totais por (competência, categoria, status) — base do orçamento, dashboard e gráficos. */
export interface CatTotal { competence: ISODate; category_id: string | null; parent_id: string | null; nature: Nature | null; section: 'IN' | 'OUT' | null; status: MovementStatus; amount: number; on_card: boolean; available_account: boolean }

export async function categoryTotals(ctx: Ctx, fromMonth: ISODate, toMonth: ISODate, f: { accountId?: string; cardId?: string } = {}): Promise<CatTotal[]> {
  return ctx.q.query<CatTotal>(
    `select m.competence, s.category_id, c.parent_id, c.nature, c.section, m.status,
       sum(s.amount_cents) as amount, (m.card_id is not null) as on_card,
       coalesce(a.in_available_balance, true) as available_account
     from movement_splits s
     join movements m on m.id=s.movement_id
     left join categories c on c.id=s.category_id
     left join accounts a on a.id=m.account_id
     where m.user_id=$1 and m.deleted_at is null and m.status in ('PLANNED','REALIZED')
       and m.competence between $2 and $3
       and ($4::uuid is null or m.account_id=$4) and ($5::uuid is null or m.card_id=$5)
     group by m.competence, s.category_id, c.parent_id, c.nature, c.section, m.status, (m.card_id is not null), coalesce(a.in_available_balance, true)`,
    [ctx.userId, monthStart(fromMonth), monthStart(toMonth), f.accountId ?? null, f.cardId ?? null],
  );
}

export interface EconomicSummary {
  income: number; expense: number; financingOut: number; financingIn: number; investedNet: number;
  adjustments: number; unclassified: number; cardSpend: number; financialIncome: number;
}
const emptySummary = (): EconomicSummary => ({ income: 0, expense: 0, financingOut: 0, financingIn: 0, investedNet: 0, adjustments: 0, unclassified: 0, cardSpend: 0, financialIncome: 0 });

/**
 * Visão econômica (competência): receitas e despesas de verdade. Transferências, pagamentos de fatura,
 * aportes/resgates, empréstimos e ajustes ficam fora de receita/despesa.
 */
export function summarize(rows: CatTotal[], status: MovementStatus | 'ALL', financialIds: Set<string>): EconomicSummary {
  const s = emptySummary();
  for (const r of rows) {
    if (status !== 'ALL' && r.status !== status) continue;
    const a = r.amount;
    if (!r.category_id) { s.unclassified += -a; continue; }
    switch (r.nature) {
      case 'INCOME': s.income += a; if (financialIds.has(r.category_id)) s.financialIncome += a; break;
      case 'EXPENSE': s.expense += -a; if (r.on_card) s.cardSpend += -a; break;
      case 'FINANCING': if (r.section === 'IN') s.financingIn += a; else s.financingOut += -a; break;
      case 'INVESTMENT': if (r.available_account || r.on_card) s.investedNet += -a; break;
      case 'ADJUSTMENT': s.adjustments += a; break;
      default: break;
    }
  }
  return s;
}

/** Visão de caixa: tudo que entrou/saiu das contas, pela data. Transferências internas (ligadas) são neutras. */
export async function cashFlow(ctx: Ctx, from: ISODate, to: ISODate, accountId?: string) {
  const r = await ctx.q.query<{ inflow: number; outflow: number; internal: number }>(
    `select coalesce(sum(m.amount_cents) filter (where m.amount_cents > 0 and not internal), 0) as inflow,
            coalesce(-sum(m.amount_cents) filter (where m.amount_cents < 0 and not internal), 0) as outflow,
            coalesce(sum(abs(m.amount_cents)) filter (where internal), 0) as internal
     from (select m.*, (m.kind='TRANSFER' and m.link_id is not null and $4::uuid is null) as internal
           from movements m join accounts a on a.id=m.account_id
           where m.user_id=$1 and m.deleted_at is null and m.status='REALIZED' and m.date between $2 and $3
             and ($4::uuid is null or m.account_id=$4) and ($4::uuid is not null or a.in_available_balance)) m`,
    [ctx.userId, from, to, accountId ?? null],
  );
  return r[0];
}

/** Meses [from..to] em ordem. */
export function monthRange(from: ISODate, to: ISODate) {
  const out: ISODate[] = [];
  for (let m = monthStart(from); m <= monthStart(to); m = addMonths(m, 1, 1)) out.push(m);
  return out;
}
