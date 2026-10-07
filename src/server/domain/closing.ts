/**
 * Fechamento de meses a partir dos saldos do controle manual (saldo inicial e final de cada mês).
 *
 * No controle manual (planilha CAIXA), a conta paga a fatura de cada cartão no mês de vencimento e o
 * saldo final = saldo inicial + entradas − saídas (as compras do cartão contam no mês da fatura).
 * No app, a compra fica no cartão e a conta registra o pagamento da fatura (transferência, nunca despesa).
 * Faturas trazidas do histórico ficaram "quitadas" sem o débito na conta; aqui elas ganham o pagamento:
 *   1. saldo inicial da conta = o informado;
 *   2. cada fatura vencida até o último mês, com saldo a pagar, recebe o pagamento pela conta no vencimento
 *      (ou na data/descrição reais informadas, ex.: o débito no extrato) e deixa de ser "quitada à mão";
 *   3. o saldo final de cada mês fica registrado como conferência manual da conta.
 * Devolve, mês a mês, o saldo calculado pelo app e a diferença para o informado. Idempotente.
 */
import { monthEnd, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { norm } from '@/lib/text';
import { audit } from './audit';
import { balanceAt, setCheckpoint } from './balances';
import { createCardPayment } from './movements';
import { DomainError, type Ctx } from './types';

export interface CloseSpec {
  opening: { date: ISODate; cents: number };
  monthEnds: { date: ISODate; cents: number }[];
  /** pagamentos com data/descrição reais (cartão pelo início do nome, mês de vencimento) */
  payments?: { card: string; dueMonth: ISODate; date: ISODate; description?: string }[];
}
export interface CloseResult {
  openingChanged: boolean; paymentsCreated: number; paymentsCents: number;
  months: { date: ISODate; informed: number; computed: number; diff: number }[];
}

export async function closeMonths(ctx: Ctx, accountId: string, spec: CloseSpec): Promise<CloseResult> {
  const acc = (await ctx.q.query<{ id: string; opening_balance_cents: number; opening_balance_date: ISODate }>(
    'select id, opening_balance_cents, opening_balance_date from accounts where id=$1 and user_id=$2', [accountId, ctx.userId]))[0];
  if (!acc) throw new DomainError('Conta inválida.');
  const ends = [...spec.monthEnds].sort((a, b) => a.date.localeCompare(b.date));
  if (!ends.length) throw new DomainError('Informe os saldos finais.');
  const res: CloseResult = { openingChanged: false, paymentsCreated: 0, paymentsCents: 0, months: [] };

  // 1) saldo inicial
  if (acc.opening_balance_cents !== spec.opening.cents || acc.opening_balance_date !== spec.opening.date) {
    await ctx.q.query('update accounts set opening_balance_cents=$2, opening_balance_date=$3, updated_at=now() where id=$1',
      [accountId, spec.opening.cents, spec.opening.date]);
    await audit(ctx, 'account', accountId, 'UPDATE', { field: 'saldo inicial',
      old: { cents: acc.opening_balance_cents, date: acc.opening_balance_date }, new: spec.opening });
    acc.opening_balance_cents = spec.opening.cents; acc.opening_balance_date = spec.opening.date;
    res.openingChanged = true;
  }

  // 2) pagamentos das faturas vencidas até o último mês
  const last = monthStart(ends[ends.length - 1].date);
  const today = todayFn();
  const cards = await ctx.q.query<{ id: string; name: string }>('select id, name from credit_cards where user_id=$1', [ctx.userId]);
  const sts = await ctx.q.query<{ id: string; card_id: string; due_month: ISODate; due_date: ISODate; total: number; paid: number }>(
    `select s.id, s.card_id, s.due_month, s.due_date,
       coalesce((select -sum(m.amount_cents) from movements m where m.statement_id=s.id and m.deleted_at is null
                 and m.status <> 'CANCELLED' and m.kind <> 'CARD_PAYMENT'), 0) as total,
       coalesce((select sum(m.amount_cents) from movements m where m.settles_statement_id=s.id and m.card_id is not null
                 and m.deleted_at is null and m.status <> 'CANCELLED'), 0) as paid
     from card_statements s where s.user_id=$1 and s.due_month >= $2 and s.due_month <= $3 order by s.due_month`,
    [ctx.userId, monthStart(spec.opening.date), last]);
  for (const s of sts) {
    const due = s.total - s.paid;
    if (due <= 0 || s.due_date > today) continue;
    const card = cards.find(c => c.id === s.card_id)!;
    const real = spec.payments?.find(p => monthStart(p.dueMonth) === s.due_month && norm(card.name).startsWith(norm(p.card)));
    const date = real?.date && monthStart(real.date) === s.due_month ? real.date : s.due_date > monthEnd(s.due_month) ? monthEnd(s.due_month) : s.due_date;
    await createCardPayment(ctx, {
      cardId: s.card_id, accountId, amountCents: due, date, statementId: s.id, source: 'MIGRATION',
      description: real?.description || `Pagamento fatura ${card.name}`,
      notes: 'Pagamento conforme o controle manual (planilha CAIXA).',
    });
    await ctx.q.query('update card_statements set settled_manually=false where id=$1', [s.id]);
    res.paymentsCreated++; res.paymentsCents += due;
  }

  // 3) conferências mensais
  for (const e of ends) {
    if (e.date > acc.opening_balance_date) await setCheckpoint(ctx, accountId, e.date, e.cents);
    const computed = await balanceAt(ctx, acc, e.date);
    res.months.push({ date: e.date, informed: e.cents, computed, diff: e.cents - computed });
  }
  return res;
}
