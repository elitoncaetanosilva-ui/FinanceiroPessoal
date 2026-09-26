/**
 * Ciclo da fatura (funções puras, usadas no servidor e no navegador).
 *  - A fatura do mês M vence no dia `due_day` de M.
 *  - Fecha no dia `closing_day` de M se closing_day < due_day; senão no mês anterior (ex.: fecha 30, vence 7).
 *  - Compra entra na primeira fatura cujo fechamento é POSTERIOR à data da compra
 *    (compra no próprio dia do fechamento vai para a próxima — "melhor dia de compra").
 */
import { addMonths, dayOfMonth, monthStart, parts, type ISODate } from './dates';

export interface CardDays { closing_day: number; due_day: number }

export function computeStatementDates(card: CardDays, dueMonth: ISODate) {
  const { y, m } = parts(dueMonth);
  const due_date = dayOfMonth(y, m, card.due_day);
  const closingMonth = card.closing_day < card.due_day ? monthStart(dueMonth) : addMonths(monthStart(dueMonth), -1, 1);
  const cp = parts(closingMonth);
  const closing_date = dayOfMonth(cp.y, cp.m, card.closing_day);
  return { closing_date, due_date };
}

export function dueMonthForPurchase(card: CardDays, date: ISODate, existing: { due_month: ISODate; closing_date: ISODate }[] = []): ISODate {
  const byMonth = new Map(existing.map(s => [s.due_month, s.closing_date]));
  for (let k = -1; k <= 3; k++) {
    const dm = addMonths(monthStart(date), k, 1);
    const closing = byMonth.get(dm) ?? computeStatementDates(card, dm).closing_date;
    if (closing > date) return dm;
  }
  return addMonths(monthStart(date), 1, 1);
}
