/**
 * Visão de cartões: faturas (total, pago, restante, status), limite utilizado e disponível.
 * Limite utilizado = soma do que ainda não foi pago em todas as faturas, INCLUINDO parcelas futuras
 * (o banco reserva o valor total da compra parcelada). Recorrências previstas não consomem limite.
 */
import { addMonths, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { listCards } from './catalog';
import { dueMonthForPurchase, statementStatus, type StatementStatus } from './statements';
import type { Card, Ctx } from './types';

export interface StatementView {
  id: string; card_id: string; due_month: ISODate; closing_date: ISODate; due_date: ISODate;
  total: number; planned: number; paid: number; remaining: number; reported_total_cents: number | null;
  settled_manually: boolean; status: StatementStatus; count: number;
}

export async function statementViews(ctx: Ctx, cardId: string, from?: ISODate, to?: ISODate): Promise<StatementView[]> {
  const today = todayFn();
  const rows = await ctx.q.query<Omit<StatementView, 'status' | 'paid' | 'remaining'> & { paid_raw: number }>(
    `select s.id, s.card_id, s.due_month, s.closing_date, s.due_date, s.reported_total_cents, s.settled_manually,
       coalesce(sum(-m.amount_cents) filter (where m.kind<>'CARD_PAYMENT' and m.status<>'CANCELLED'), 0) as total,
       coalesce(sum(-m.amount_cents) filter (where m.kind<>'CARD_PAYMENT' and m.status='PLANNED'), 0) as planned,
       count(m.id) filter (where m.kind<>'CARD_PAYMENT')::int as count,
       coalesce((select sum(p.amount_cents) from movements p where p.settles_statement_id=s.id and p.card_id is not null
                  and p.deleted_at is null and p.status='REALIZED'), 0) as paid_raw
     from card_statements s
     left join movements m on m.statement_id=s.id and m.deleted_at is null
     where s.user_id=$1 and s.card_id=$2 and ($3::date is null or s.due_month >= $3) and ($4::date is null or s.due_month <= $4)
     group by s.id order by s.due_month`,
    [ctx.userId, cardId, from ?? null, to ?? null],
  );
  // fatura "atual" = a primeira ainda aberta (fechamento no futuro)
  const currentOpen = rows.find(r => r.closing_date > today)?.id;
  return rows.map(r => {
    const paid = r.settled_manually ? Math.max(r.paid_raw, r.total) : r.paid_raw;
    const remaining = r.total - paid;
    return { ...r, paid, remaining, status: statementStatus(r, r.total, paid, today, r.id === currentOpen) };
  });
}

export interface CardSummary extends Card {
  used: number; available: number; debt_now: number;
  current: StatementView | null;      // fatura aberta (em formação)
  closed: StatementView | null;       // última fechada ainda não paga (a vencer ou vencida)
  upcoming: StatementView[];          // próximas (após a aberta)
  future_total: number;               // soma das faturas após a atual
  /** 2 faturas anteriores, a atual e as 3 próximas (mês de vencimento; fatura inexistente = null) */
  timeline: { due_month: ISODate; statement: StatementView | null; position: 'past' | 'current' | 'next' }[];
}

export async function cardSummaries(ctx: Ctx, onlyActive = true): Promise<CardSummary[]> {
  const cards = await listCards(ctx, onlyActive);
  const today = todayFn();
  const out: CardSummary[] = [];
  for (const c of cards) {
    const sts = await statementViews(ctx, c.id, addMonths(monthStart(today), -24, 1));
    // limite: parcelas previstas contam; recorrências previstas não
    const rec = await ctx.q.query<{ s: number }>(
      `select coalesce(sum(-m.amount_cents),0) as s from movements m
       where m.card_id=$1 and m.deleted_at is null and m.status='PLANNED' and m.source='RECURRING'`,
      [c.id],
    );
    const used = Math.max(0, sts.reduce((s, x) => s + Math.max(0, x.remaining), 0) - rec[0].s);
    const current = sts.find(s => s.status === 'OPEN') ?? null;
    const closed = [...sts].reverse().find(s => s.closing_date <= today && s.remaining > 0 && !s.settled_manually) ?? null;
    const upcoming = sts.filter(s => current ? s.due_month > current.due_month : s.closing_date > today);
    const currentMonth = current?.due_month ?? dueMonthForPurchase(c, today, sts);
    const byMonth = new Map(sts.map(s => [s.due_month, s]));
    const timeline = [-2, -1, 0, 1, 2, 3].map(k => {
      const dm = addMonths(currentMonth, k, 1);
      return { due_month: dm, statement: byMonth.get(dm) ?? null, position: (k < 0 ? 'past' : k === 0 ? 'current' : 'next') as 'past' | 'current' | 'next' };
    });
    out.push({
      ...c, used, available: c.limit_cents - used,
      debt_now: sts.filter(s => s.closing_date <= today).reduce((s, x) => s + Math.max(0, x.remaining), 0),
      current, closed, upcoming, future_total: upcoming.reduce((s, x) => s + x.remaining, 0), timeline,
    });
  }
  return out;
}

/** Compras parceladas em andamento de um cartão. */
export async function activeInstallments(ctx: Ctx, cardId: string) {
  return ctx.q.query<{ group_id: string; description: string; purchase_date: ISODate | null; installment_count: number; installment_amount_cents: number; total_amount_cents: number; remaining_count: number; remaining_cents: number; next_due: ISODate | null }>(
    `select g.id as group_id, g.description, g.purchase_date, g.installment_count, g.installment_amount_cents, g.total_amount_cents,
       count(m.id) filter (where s.due_date >= $3)::int as remaining_count,
       coalesce(sum(-m.amount_cents) filter (where s.due_date >= $3), 0) as remaining_cents,
       min(s.due_date) filter (where s.due_date >= $3) as next_due
     from installment_groups g
     join movements m on m.installment_group_id=g.id and m.deleted_at is null
     join card_statements s on s.id=m.statement_id
     where g.user_id=$1 and g.card_id=$2
     group by g.id having count(m.id) filter (where s.due_date >= $3) > 0
     order by min(s.due_date) filter (where s.due_date >= $3), g.description`,
    [ctx.userId, cardId, todayFn()],
  );
}
