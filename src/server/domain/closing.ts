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
import { createCardPayment, deleteMovement, insertMovement, newLink, systemCategoryId } from './movements';
import { DomainError, type Ctx } from './types';

export interface CloseSpec {
  opening: { date: ISODate; cents: number };
  monthEnds: { date: ISODate; cents: number }[];
  /** pagamentos com data/descrição reais (cartão pelo início do nome, mês de vencimento) */
  payments?: { card: string; dueMonth: ISODate; date: ISODate; description?: string }[];
}
export interface CloseResult {
  openingChanged: boolean; paymentsCreated: number; paymentsCents: number; accountSidesCreated: number;
  months: { date: ISODate; informed: number; computed: number; diff: number }[];
}

export async function closeMonths(ctx: Ctx, accountId: string, spec: CloseSpec): Promise<CloseResult> {
  const acc = (await ctx.q.query<{ id: string; opening_balance_cents: number; opening_balance_date: ISODate }>(
    'select id, opening_balance_cents, opening_balance_date from accounts where id=$1 and user_id=$2', [accountId, ctx.userId]))[0];
  if (!acc) throw new DomainError('Conta inválida.');
  const ends = [...spec.monthEnds].sort((a, b) => a.date.localeCompare(b.date));
  if (!ends.length) throw new DomainError('Informe os saldos finais.');
  const res: CloseResult = { openingChanged: false, paymentsCreated: 0, paymentsCents: 0, accountSidesCreated: 0, months: [] };

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
  const payCat = await systemCategoryId(ctx, 'CARD_PAYMENT');
  for (const s of sts) {
    const card = cards.find(c => c.id === s.card_id)!;
    const real = spec.payments?.find(p => monthStart(p.dueMonth) === s.due_month && norm(card.name).startsWith(norm(p.card)));
    // pagamento que só existe do lado do cartão (ex.: veio da fatura importada): a conta ganha o débito correspondente
    const orphan = await ctx.q.query<{ id: string; link_id: string | null; amount_cents: number; date: ISODate; description: string }>(
      `select m.id, m.link_id, m.amount_cents, m.date, m.description from movements m
       where m.settles_statement_id=$1 and m.card_id is not null and m.deleted_at is null and m.status='REALIZED' and m.kind='CARD_PAYMENT'
         and not exists (select 1 from movements x where x.link_id=m.link_id and x.account_id is not null and x.deleted_at is null)`, [s.id]);
    for (const o of orphan) {
      if (s.due_month > last || o.date > today) continue;
      const link = o.link_id ?? await newLink(ctx, 'CARD_PAYMENT');
      if (!o.link_id) await ctx.q.query('update movements set link_id=$2 where id=$1', [o.id, link]);
      await insertMovement(ctx, {
        accountId, kind: 'CARD_PAYMENT', amountCents: -o.amount_cents, date: real?.date ?? o.date, description: real?.description || o.description,
        status: 'REALIZED', source: 'MIGRATION', categoryId: payCat, linkId: link, paysCardId: card.id, settlesStatementId: s.id,
      }, { audit: false });
      res.accountSidesCreated++;
    }
    const due = s.total - s.paid;
    if (due <= 0 || s.due_date > today) continue;
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

/**
 * Junta numa conta só o histórico que ficou repartido entre duas (ex.: migração e extrato numa conta antiga,
 * controle manual completo na conta nova). A conta nova (`toId`) vale:
 *   - lotes de extrato da conta antiga são desfeitos (o controle manual da conta nova já cobre o período);
 *   - receitas do histórico (mig|inc) vão para a conta nova;
 *   - gastos do histórico (mig|cash) que a conta nova já tem (mesma data e valor) são excluídos; os demais vão para ela;
 *   - qualquer outro lançamento restante vai para a conta nova; dados bancários (agência/conta) também,
 *     para os próximos extratos caírem nela.
 */
export async function consolidateAccounts(ctx: Ctx, fromId: string, toId: string) {
  const { revertBatch } = await import('../import/pipeline');
  const r = { revertedBatches: 0, movedIncomes: 0, removedDuplicates: 0, moved: 0 };
  const batches = await ctx.q.query<{ id: string }>(
    `select id from import_batches where user_id=$1 and account_id=$2 and status='COMMITTED' order by created_at desc`, [ctx.userId, fromId]);
  for (const b of batches) { await revertBatch(ctx, b.id); r.revertedBatches++; }

  const keyTaken = async (key: string | null) => !!key && !!(await ctx.q.query(
    'select 1 from movements where account_id=$1 and dedup_key=$2 and deleted_at is null', [toId, key]))[0];
  const move = async (id: string, key: string | null) => {
    await ctx.q.query('update movements set account_id=$2, dedup_key=$3, updated_at=now() where id=$1', [id, toId, (await keyTaken(key)) ? null : key]);
  };
  const rest = await ctx.q.query<{ id: string; dedup_key: string | null; date: ISODate; amount_cents: number; link_id: string | null }>(
    'select id, dedup_key, date, amount_cents, link_id from movements where account_id=$1 and user_id=$2 and deleted_at is null order by date, id', [fromId, ctx.userId]);
  const used = new Set<string>();
  for (const m of rest) {
    if (m.dedup_key?.startsWith('mig|inc|')) { await move(m.id, m.dedup_key); r.movedIncomes++; continue; }
    if (m.dedup_key?.startsWith('mig|cash|')) {
      const twin = (await ctx.q.query<{ id: string }>(
        `select id from movements where account_id=$1 and deleted_at is null and date=$2 and amount_cents=$3 and kind='NORMAL' and dedup_key not like 'mig|%' order by id`,
        [toId, m.date, m.amount_cents])).find(x => !used.has(x.id));
      if (twin) { used.add(twin.id); await deleteMovement(ctx, m.id, 'one'); r.removedDuplicates++; continue; }
    }
    await move(m.id, m.dedup_key); r.moved++;
  }
  const from = (await ctx.q.query<{ branch: string | null; number: string | null; institution_id: string | null }>(
    'select branch, number, institution_id from accounts where id=$1', [fromId]))[0];
  await ctx.q.query(
    `update accounts set branch=coalesce(branch, $2), number=coalesce(number, $3), institution_id=coalesce(institution_id, $4), updated_at=now() where id=$1`,
    [toId, from.branch, from.number, from.institution_id]);
  await ctx.q.query('update accounts set branch=null, number=null, is_active=false, updated_at=now() where id=$1', [fromId]);
  await ctx.q.query('delete from balance_checkpoints where account_id=$1', [fromId]);
  await audit(ctx, 'account', toId, 'CONSOLIDATE', null, { from: fromId, ...r });
  return r;
}
