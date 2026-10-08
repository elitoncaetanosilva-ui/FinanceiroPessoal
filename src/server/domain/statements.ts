/**
 * Faturas de cartão.
 * Regras:
 *  - A fatura do mês M vence no dia `due_day` de M.
 *  - Fecha no dia `closing_day` de M se closing_day < due_day; senão no mês anterior (ex.: Itaú fecha 30, vence 7).
 *  - Uma compra entra na primeira fatura cujo FECHAMENTO é posterior à data da compra
 *    (compra no próprio dia do fechamento vai para a próxima — "melhor dia de compra").
 *  - Datas reais podem ser ajustadas na fatura (feriados etc.) e passam a valer no cálculo.
 *  - Em importações, a fatura informada no arquivo prevalece sobre o cálculo.
 */
import { monthStart, type ISODate } from '@/lib/dates';
import type { Card, Ctx, Statement } from './types';

import { computeStatementDates, dueMonthForPurchase } from '@/lib/card-cycle';
export { computeStatementDates, dueMonthForPurchase };

export async function statementsOf({ q, userId }: Ctx, cardId: string): Promise<Statement[]> {
  return q.query<Statement>(
    `select id, card_id, due_month, closing_date, due_date, reported_total_cents, settled_manually
     from card_statements where user_id=$1 and card_id=$2 order by due_month`,
    [userId, cardId],
  );
}

/** Garante a fatura (cartão, mês de vencimento). `dates` sobrescreve as datas calculadas (ex.: vencimento do arquivo). */
export async function ensureStatement(
  ctx: Ctx, card: Pick<Card, 'id' | 'closing_day' | 'due_day'>, dueMonth: ISODate,
  dates?: { due_date?: ISODate; closing_date?: ISODate },
): Promise<Statement> {
  const { q, userId } = ctx;
  const dm = monthStart(dueMonth);
  const found = await q.query<Statement>(
    `select id, card_id, due_month, closing_date, due_date, reported_total_cents, settled_manually
     from card_statements where card_id=$1 and due_month=$2`,
    [card.id, dm],
  );
  if (found[0]) {
    const s = found[0];
    const nd = dates?.due_date && dates.due_date !== s.due_date ? dates.due_date : null;
    const nc = dates?.closing_date && dates.closing_date !== s.closing_date ? dates.closing_date : null;
    if (nd || nc) {
      const r = await q.query<Statement>(
        `update card_statements set due_date=coalesce($2,due_date), closing_date=coalesce($3,closing_date), updated_at=now()
         where id=$1 returning id, card_id, due_month, closing_date, due_date, reported_total_cents, settled_manually`,
        [s.id, nd, nc],
      );
      return r[0];
    }
    return s;
  }
  const calc = computeStatementDates(card, dm);
  const r = await q.query<Statement>(
    `insert into card_statements(user_id, card_id, due_month, closing_date, due_date) values ($1,$2,$3,$4,$5)
     on conflict (card_id, due_month) do update set updated_at=now()
     returning id, card_id, due_month, closing_date, due_date, reported_total_cents, settled_manually`,
    [userId, card.id, dm, dates?.closing_date ?? calc.closing_date, dates?.due_date ?? calc.due_date],
  );
  return r[0];
}

/** Fatura para uma compra manual no cartão. */
export async function statementForPurchase(ctx: Ctx, card: Pick<Card, 'id' | 'closing_day' | 'due_day'>, date: ISODate) {
  const existing = await statementsOf(ctx, card.id);
  return ensureStatement(ctx, card, dueMonthForPurchase(card, date, existing));
}

export type StatementStatus = 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID' | 'PARTIAL' | 'FUTURE';
export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  OPEN: 'Aberta', CLOSED: 'Fechada', OVERDUE: 'Vencida', PAID: 'Paga', PARTIAL: 'Paga parcialmente', FUTURE: 'Futura',
};

export function statementStatus(s: Pick<Statement, 'closing_date' | 'due_date' | 'settled_manually'>, totalCents: number, paidCents: number, today: ISODate, isCurrentOpen: boolean): StatementStatus {
  const remaining = totalCents - paidCents;
  if (s.settled_manually || (totalCents > 0 && remaining <= 0) || (totalCents <= 0 && today >= s.closing_date)) return 'PAID';
  if (today < s.closing_date) return isCurrentOpen ? 'OPEN' : 'FUTURE';
  if (paidCents > 0) return 'PARTIAL';
  return today > s.due_date ? 'OVERDUE' : 'CLOSED';
}
