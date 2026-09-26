/**
 * Serviços de escrita de movimentos. Todas as funções recebem um Ctx cujo `q` deve ser uma
 * transação (`tx`): o trigger diferido do banco valida no COMMIT que a soma dos rateios
 * é igual ao valor de cada movimento.
 */
import { addDays, addMonths, diffDays, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { splitInstallments, sum } from '@/lib/money';
import { norm } from '@/lib/text';
import { audit } from './audit';
import { computeStatementDates, ensureStatement, statementForPurchase, statementsOf } from './statements';
import type { Card, Ctx, MovementKind, MovementSource, MovementStatus, SplitInput, Statement } from './types';
import { DomainError } from './types';

export interface NewMovement {
  accountId?: string | null;
  cardId?: string | null;
  statementId?: string | null;
  kind?: MovementKind;
  amountCents: number;            // sinal do ponto de vista do portador
  date: ISODate;
  competence?: ISODate;
  dueDate?: ISODate | null;
  paidDate?: ISODate | null;
  description: string;
  notes?: string | null;
  status?: MovementStatus;
  source?: MovementSource;
  categoryId?: string | null;
  splits?: SplitInput[];
  importBatchId?: string | null;
  externalId?: string | null;
  dedupKey?: string | null;
  installmentGroupId?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  recurringRuleId?: string | null;
  linkId?: string | null;
  paysCardId?: string | null;
  settlesStatementId?: string | null;
  suggestedCategoryId?: string | null;
  suggestionConfidence?: number | null;
  suggestionSource?: string | null;
  adjustmentReason?: string | null;
}

type CardDays = Pick<Card, 'id' | 'closing_day' | 'due_day'>;

async function loadCard(ctx: Ctx, cardId: string): Promise<CardDays> {
  const r = await ctx.q.query<CardDays>('select id, closing_day, due_day from credit_cards where id=$1 and user_id=$2', [cardId, ctx.userId]);
  if (!r[0]) throw new DomainError('Cartão não encontrado.');
  return r[0];
}
async function assertAccount(ctx: Ctx, accountId: string) {
  const r = await ctx.q.query('select 1 from accounts where id=$1 and user_id=$2', [accountId, ctx.userId]);
  if (!r[0]) throw new DomainError('Conta não encontrada.');
}
async function assertCategories(ctx: Ctx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return;
  const r = await ctx.q.query<{ n: number }>('select count(*)::int as n from categories where user_id=$1 and id = any($2::uuid[])', [ctx.userId, list]);
  if (r[0].n !== list.length) throw new DomainError('Categoria inválida.');
}

export async function systemCategoryId(ctx: Ctx, key: string): Promise<string> {
  const r = await ctx.q.query<{ id: string }>('select id from categories where user_id=$1 and system_key=$2', [ctx.userId, key]);
  if (!r[0]) throw new Error(`Categoria de sistema ausente: ${key}`);
  return r[0].id;
}

/**
 * Insere um movimento com seus rateios. Com `dedupKey`, uma duplicata (mesmo portador + chave)
 * é ignorada e a função devolve null — a garantia vem do índice único do banco.
 */
export async function insertMovement(ctx: Ctx, m: NewMovement, opts: { audit?: boolean } = {}): Promise<string | null> {
  const { q, userId } = ctx;
  if (!!m.accountId === !!m.cardId) throw new DomainError('Informe uma conta ou um cartão.');
  if (!Number.isInteger(m.amountCents)) throw new DomainError('Valor inválido.');
  if (!m.description?.trim()) throw new DomainError('Descrição obrigatória.');

  let statementId = m.statementId ?? null;
  let competence = m.competence ? monthStart(m.competence) : null;
  if (m.cardId) {
    const card = await loadCard(ctx, m.cardId);
    if (!statementId) statementId = (await statementForPurchase(ctx, card, m.date)).id;
    if (!competence) {
      const s = await q.query<{ due_month: ISODate }>('select due_month from card_statements where id=$1 and card_id=$2', [statementId, card.id]);
      if (!s[0]) throw new DomainError('Fatura inválida para o cartão.');
      competence = s[0].due_month;
    }
  } else {
    await assertAccount(ctx, m.accountId!);
    if (statementId) throw new DomainError('Fatura só se aplica a cartão.');
  }
  competence ??= monthStart(m.date);

  const splits = m.splits?.length ? m.splits : [{ categoryId: m.categoryId ?? null, amountCents: m.amountCents }];
  if (sum(splits.map(s => s.amountCents)) !== m.amountCents) throw new DomainError('A soma do rateio precisa ser igual ao valor do movimento.');
  await assertCategories(ctx, [...splits.map(s => s.categoryId), m.suggestedCategoryId]);

  const r = await q.query<{ id: string }>(
    `insert into movements(user_id, account_id, card_id, statement_id, kind, amount_cents, date, competence, due_date, paid_date,
       description, normalized_description, notes, status, source, import_batch_id, external_id, dedup_key,
       installment_group_id, installment_number, installment_total, recurring_rule_id, link_id, pays_card_id,
       settles_statement_id, suggested_category_id, suggestion_confidence, suggestion_source, adjustment_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     on conflict ((coalesce(account_id, card_id)), dedup_key) where dedup_key is not null and deleted_at is null do nothing
     returning id`,
    [
      userId, m.accountId ?? null, m.cardId ?? null, statementId, m.kind ?? 'NORMAL', m.amountCents, m.date, competence,
      m.dueDate ?? null, m.paidDate ?? ((m.status ?? 'REALIZED') === 'REALIZED' && m.accountId ? m.date : null),
      m.description.trim(), norm(m.description), m.notes ?? null, m.status ?? 'REALIZED', m.source ?? 'MANUAL',
      m.importBatchId ?? null, m.externalId ?? null, m.dedupKey ?? null, m.installmentGroupId ?? null,
      m.installmentNumber ?? null, m.installmentTotal ?? null, m.recurringRuleId ?? null, m.linkId ?? null,
      m.paysCardId ?? null, m.settlesStatementId ?? null, m.suggestedCategoryId ?? null, m.suggestionConfidence ?? null,
      m.suggestionSource ?? null, m.adjustmentReason ?? null,
    ],
  );
  if (!r[0]) return null;
  const id = r[0].id;
  await insertSplits(ctx, id, splits);
  if (opts.audit !== false) await audit(ctx, 'movement', id, 'CREATE', null, { source: m.source ?? 'MANUAL' });
  return id;
}

async function insertSplits(ctx: Ctx, movementId: string, splits: SplitInput[]) {
  let i = 0;
  for (const s of splits) {
    await ctx.q.query(
      'insert into movement_splits(user_id, movement_id, category_id, amount_cents, person_id, notes, sort_order) values ($1,$2,$3,$4,$5,$6,$7)',
      [ctx.userId, movementId, s.categoryId ?? null, s.amountCents, s.personId ?? null, s.notes ?? null, i++],
    );
  }
}

export async function newLink(ctx: Ctx, kind: 'TRANSFER' | 'CARD_PAYMENT') {
  const r = await ctx.q.query<{ id: string }>('insert into movement_links(user_id, kind) values ($1,$2) returning id', [ctx.userId, kind]);
  return r[0].id;
}

// ---------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------

/** Receita ou despesa simples em conta ou cartão (valor com sinal). */
export async function createSimple(ctx: Ctx, m: NewMovement) {
  const status = m.status ?? (m.date > todayFn() ? 'PLANNED' : 'REALIZED');
  const id = await insertMovement(ctx, { ...m, status, kind: 'NORMAL' });
  return id!;
}

/**
 * Compra parcelada (cartão ou conta). Gera o grupo e N parcelas:
 * parcela k na fatura (ou mês) k−1 após a primeira. Parcelas cujas faturas ainda não fecharam ficam PREVISTAS.
 * O total é dividido em centavos exatos; a diferença fica na 1ª parcela.
 */
export async function createInstallmentPurchase(ctx: Ctx, p: {
  accountId?: string | null; cardId?: string | null; date: ISODate; totalCents: number; installments: number;
  description: string; categoryId?: string | null; notes?: string | null; source?: MovementSource;
}) {
  const n = Math.trunc(p.installments);
  if (n < 1 || n > 120) throw new DomainError('Número de parcelas inválido.');
  const amounts = splitInstallments(p.totalCents, n);
  const g = await ctx.q.query<{ id: string }>(
    `insert into installment_groups(user_id, account_id, card_id, description, purchase_date, installment_count, installment_amount_cents, total_amount_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.userId, p.accountId ?? null, p.cardId ?? null, p.description.trim(), p.date, n, amounts[n - 1], p.totalCents],
  );
  const groupId = g[0].id;
  const today = todayFn();
  const ids: string[] = [];
  if (p.cardId) {
    const card = await loadCard(ctx, p.cardId);
    const first = await statementForPurchase(ctx, card, p.date);
    for (let k = 1; k <= n; k++) {
      const st = k === 1 ? first : await ensureStatement(ctx, card, addMonths(first.due_month, k - 1, 1));
      const status: MovementStatus = k === 1 ? (p.date <= today ? 'REALIZED' : 'PLANNED') : (st.closing_date <= today ? 'REALIZED' : 'PLANNED');
      ids.push((await insertMovement(ctx, {
        cardId: card.id, statementId: st.id, amountCents: amounts[k - 1], date: addMonths(p.date, k - 1),
        description: p.description, notes: p.notes, status, source: k === 1 ? p.source ?? 'MANUAL' : 'INSTALLMENT',
        categoryId: p.categoryId, installmentGroupId: groupId, installmentNumber: k, installmentTotal: n,
      }, { audit: k === 1 }))!);
    }
  } else {
    for (let k = 1; k <= n; k++) {
      const date = addMonths(p.date, k - 1);
      ids.push((await insertMovement(ctx, {
        accountId: p.accountId, amountCents: amounts[k - 1], date, dueDate: date, description: p.description, notes: p.notes,
        status: date <= today ? 'REALIZED' : 'PLANNED', source: k === 1 ? p.source ?? 'MANUAL' : 'INSTALLMENT',
        categoryId: p.categoryId, installmentGroupId: groupId, installmentNumber: k, installmentTotal: n,
      }, { audit: k === 1 }))!);
    }
  }
  return { groupId, ids };
}

/** Categoria de sistema adequada a uma transferência entre duas contas. */
async function transferCategory(ctx: Ctx, fromId: string, toId: string) {
  const r = await ctx.q.query<{ id: string; type: string }>('select id, type from accounts where id = any($1::uuid[]) and user_id=$2', [[fromId, toId], ctx.userId]);
  const t = new Map(r.map(x => [x.id, x.type]));
  if (!t.has(fromId) || !t.has(toId)) throw new DomainError('Conta não encontrada.');
  const inv = (x?: string) => x === 'INVESTMENT' || x === 'SAVINGS';
  if (inv(t.get(toId)) && !inv(t.get(fromId))) return systemCategoryId(ctx, 'INVESTMENT_IN');   // aporte
  if (inv(t.get(fromId)) && !inv(t.get(toId))) return systemCategoryId(ctx, 'INVESTMENT_OUT');  // resgate
  return systemCategoryId(ctx, 'TRANSFER');
}

/** Transferência entre contas próprias: dois lados ligados; patrimônio consolidado não muda. */
export async function createTransfer(ctx: Ctx, t: {
  fromAccountId: string; toAccountId: string; amountCents: number; date: ISODate; description?: string; notes?: string | null;
}) {
  if (t.fromAccountId === t.toAccountId) throw new DomainError('Escolha contas diferentes.');
  if (t.amountCents <= 0) throw new DomainError('Valor precisa ser positivo.');
  const cat = await transferCategory(ctx, t.fromAccountId, t.toAccountId);
  const link = await newLink(ctx, 'TRANSFER');
  const status: MovementStatus = t.date > todayFn() ? 'PLANNED' : 'REALIZED';
  const desc = t.description?.trim() || 'Transferência entre contas';
  const out = await insertMovement(ctx, { accountId: t.fromAccountId, kind: 'TRANSFER', amountCents: -t.amountCents, date: t.date, description: desc, notes: t.notes, status, categoryId: cat, linkId: link });
  const inn = await insertMovement(ctx, { accountId: t.toAccountId, kind: 'TRANSFER', amountCents: t.amountCents, date: t.date, description: desc, notes: t.notes, status, categoryId: cat, linkId: link });
  return { linkId: link, outId: out!, inId: inn! };
}

/** Ajuste de saldo: correção excepcional, fora de receitas/despesas. */
export async function createAdjustment(ctx: Ctx, a: { accountId: string; amountCents: number; date: ISODate; reason: string; notes?: string | null }) {
  if (!a.reason?.trim()) throw new DomainError('Informe o motivo do ajuste.');
  if (!a.amountCents) throw new DomainError('O ajuste não pode ser zero.');
  const cat = await systemCategoryId(ctx, 'ADJUSTMENT');
  return (await insertMovement(ctx, {
    accountId: a.accountId, kind: 'ADJUSTMENT', amountCents: a.amountCents, date: a.date, description: `Ajuste de saldo — ${a.reason.trim()}`,
    notes: a.notes, status: 'REALIZED', categoryId: cat, adjustmentReason: a.reason.trim(),
  }))!;
}

// ---------------------------------------------------------------------
// Pagamento de fatura
// ---------------------------------------------------------------------

/** Fatura que um pagamento feito em `date` quita: a fechada mais próxima do vencimento (prefere valor igual ao saldo). */
export async function statementToSettle(ctx: Ctx, card: CardDays, date: ISODate, amountCents: number): Promise<Statement> {
  const all = await statementsOf(ctx, card.id);
  const totals = await statementBalances(ctx, all.map(s => s.id));
  const closed = all.filter(s => s.closing_date <= date && diffDays(date, s.due_date) <= 45);
  const exact = closed.filter(s => Math.abs((totals.get(s.id)?.remaining ?? 0) - amountCents) <= 1);
  if (exact.length) return exact[exact.length - 1];
  const unpaid = closed.filter(s => (totals.get(s.id)?.remaining ?? 0) > 0 && !s.settled_manually);
  if (unpaid.length) return unpaid[unpaid.length - 1];
  // nenhuma fatura fechada conhecida: a de vencimento mais próximo cujo fechamento já passou
  let best: { dm: ISODate; dist: number } | null = null;
  for (let k = -1; k <= 1; k++) {
    const dm = addMonths(monthStart(date), k, 1);
    const d = computeStatementDates(card, dm);
    if (d.closing_date > date) continue;
    const dist = Math.abs(diffDays(d.due_date, date));
    if (!best || dist < best.dist) best = { dm, dist };
  }
  return ensureStatement(ctx, card, best?.dm ?? monthStart(date));
}

/** Totais por fatura: total (compras − estornos), pago e restante. */
export async function statementBalances(ctx: Ctx, statementIds: string[]) {
  const out = new Map<string, { total: number; paid: number; remaining: number; planned: number }>();
  if (!statementIds.length) return out;
  const rows = await ctx.q.query<{ id: string; total: number; planned: number; paid: number; settled: boolean }>(
    `select s.id, s.settled_manually as settled,
       coalesce((select -sum(m.amount_cents) from movements m where m.statement_id=s.id and m.deleted_at is null
                 and m.status <> 'CANCELLED' and m.kind <> 'CARD_PAYMENT'), 0) as total,
       coalesce((select -sum(m.amount_cents) from movements m where m.statement_id=s.id and m.deleted_at is null
                 and m.status = 'PLANNED' and m.kind <> 'CARD_PAYMENT'), 0) as planned,
       coalesce((select sum(m.amount_cents) from movements m where m.settles_statement_id=s.id and m.card_id is not null
                 and m.deleted_at is null and m.status='REALIZED'), 0) as paid
     from card_statements s where s.id = any($1::uuid[]) and s.user_id=$2`,
    [statementIds, ctx.userId],
  );
  for (const r of rows) {
    const paid = r.settled ? Math.max(r.paid, r.total) : r.paid;
    out.set(r.id, { total: r.total, planned: r.planned, paid, remaining: r.total - paid });
  }
  return out;
}

/**
 * Pagamento de fatura: SEMPRE existe o lado do cartão (crédito que quita a fatura); o lado da conta
 * existe quando a conta é controlada no app. Os dois ficam ligados. Nunca é despesa.
 */
export async function createCardPayment(ctx: Ctx, p: {
  cardId: string; accountId?: string | null; amountCents: number; date: ISODate; statementId?: string | null;
  description?: string; notes?: string | null; source?: MovementSource;
}) {
  if (p.amountCents <= 0) throw new DomainError('Valor do pagamento precisa ser positivo.');
  const card = await loadCard(ctx, p.cardId);
  const settles = p.statementId
    ? (await ctx.q.query<Statement>('select * from card_statements where id=$1 and card_id=$2', [p.statementId, card.id]))[0]
    : await statementToSettle(ctx, card, p.date, p.amountCents);
  if (!settles) throw new DomainError('Fatura inválida.');
  const cat = await systemCategoryId(ctx, 'CARD_PAYMENT');
  const link = await newLink(ctx, 'CARD_PAYMENT');
  const status: MovementStatus = p.date > todayFn() ? 'PLANNED' : 'REALIZED';
  const desc = p.description?.trim() || 'Pagamento de fatura';
  const cardSide = await insertMovement(ctx, {
    cardId: card.id, kind: 'CARD_PAYMENT', amountCents: p.amountCents, date: p.date, description: desc, notes: p.notes,
    status, source: p.source ?? 'MANUAL', categoryId: cat, linkId: link, settlesStatementId: settles.id,
  });
  let accountSide: string | null = null;
  if (p.accountId) {
    accountSide = await insertMovement(ctx, {
      accountId: p.accountId, kind: 'CARD_PAYMENT', amountCents: -p.amountCents, date: p.date, description: desc, notes: p.notes,
      status, source: p.source ?? 'MANUAL', categoryId: cat, linkId: link, paysCardId: card.id, settlesStatementId: settles.id,
    });
  }
  return { linkId: link, cardSideId: cardSide!, accountSideId: accountSide, statementId: settles.id };
}

/**
 * Converte um movimento de CONTA em pagamento de fatura do cartão (ex.: linha "FATURA ITAU..." do extrato)
 * e liga ao lado do cartão: reaproveita um crédito de pagamento já existente (vindo da fatura importada)
 * ou cria o lado do cartão.
 */
export async function makeAccountMovementCardPayment(ctx: Ctx, movementId: string, cardId: string, statementId?: string | null) {
  const m = await getMovementRow(ctx, movementId);
  if (!m.account_id) throw new DomainError('Só um lançamento de conta pode ser pagamento de fatura.');
  if (m.amount_cents >= 0) throw new DomainError('Pagamento de fatura é uma saída da conta.');
  const card = await loadCard(ctx, cardId);
  const amount = -m.amount_cents;
  const cat = await systemCategoryId(ctx, 'CARD_PAYMENT');
  await unlink(ctx, m);

  // lado do cartão já importado e ainda sem par?
  const cand = await ctx.q.query<{ id: string; settles_statement_id: string | null; link_id: string | null }>(
    `select id, settles_statement_id, link_id from movements
     where user_id=$1 and card_id=$2 and kind='CARD_PAYMENT' and amount_cents=$3 and deleted_at is null
       and abs(date - $4::date) <= 7
       and (link_id is null or not exists (select 1 from movements o where o.link_id=movements.link_id and o.account_id is not null and o.deleted_at is null))
     order by abs(date - $4::date) limit 1`,
    [ctx.userId, card.id, amount, m.date],
  );
  const settles = statementId ?? cand[0]?.settles_statement_id ?? (await statementToSettle(ctx, card, m.date, amount)).id;
  let link = cand[0]?.link_id ?? null;
  if (!link) link = await newLink(ctx, 'CARD_PAYMENT');
  await ctx.q.query(
    `update movements set kind='CARD_PAYMENT', link_id=$2, pays_card_id=$3, settles_statement_id=$4,
       suggested_category_id=null, suggestion_confidence=null, suggestion_source=null, updated_at=now(), version=version+1 where id=$1`,
    [m.id, link, card.id, settles],
  );
  await replaceSplits(ctx, m.id, [{ categoryId: cat, amountCents: m.amount_cents }]);
  if (cand[0]) {
    await ctx.q.query('update movements set link_id=$2, settles_statement_id=$3, updated_at=now() where id=$1', [cand[0].id, link, settles]);
  } else {
    await insertMovement(ctx, {
      cardId: card.id, kind: 'CARD_PAYMENT', amountCents: amount, date: m.date, description: m.description,
      status: m.status === 'PLANNED' ? 'PLANNED' : 'REALIZED', source: 'SYSTEM', categoryId: cat, linkId: link, settlesStatementId: settles,
    }, { audit: false });
  }
  await audit(ctx, 'movement', m.id, 'CARD_PAYMENT', { field: 'tipo', old: m.kind, new: 'CARD_PAYMENT' }, { cardId });
}

/** Converte um crédito de CARTÃO (linha "Pagamento recebido" da fatura) em pagamento e liga ao lado da conta, se existir. */
export async function makeCardMovementPayment(ctx: Ctx, movementId: string) {
  const m = await getMovementRow(ctx, movementId);
  if (!m.card_id) throw new DomainError('Movimento não é de cartão.');
  if (m.amount_cents <= 0) throw new DomainError('Pagamento no cartão é um crédito (valor positivo).');
  const card = await loadCard(ctx, m.card_id);
  const cat = await systemCategoryId(ctx, 'CARD_PAYMENT');
  const cand = await ctx.q.query<{ id: string; settles_statement_id: string | null; link_id: string | null }>(
    `select id, settles_statement_id, link_id from movements
     where user_id=$1 and account_id is not null and kind='CARD_PAYMENT' and (pays_card_id=$2 or pays_card_id is null)
       and amount_cents=$3 and deleted_at is null and abs(date - $4::date) <= 7
       and (link_id is null or not exists (select 1 from movements o where o.link_id=movements.link_id and o.card_id is not null and o.deleted_at is null and o.id<>$5))
     order by abs(date - $4::date) limit 1`,
    [ctx.userId, card.id, -m.amount_cents, m.date, m.id],
  );
  const settles = cand[0]?.settles_statement_id ?? m.settles_statement_id ?? (await statementToSettle(ctx, card, m.date, m.amount_cents)).id;
  const link = cand[0]?.link_id ?? m.link_id ?? (await newLink(ctx, 'CARD_PAYMENT'));
  await ctx.q.query(
    `update movements set kind='CARD_PAYMENT', link_id=$2, settles_statement_id=$3, suggested_category_id=null,
       suggestion_confidence=null, suggestion_source=null, updated_at=now() where id=$1`,
    [m.id, link, settles],
  );
  await replaceSplits(ctx, m.id, [{ categoryId: cat, amountCents: m.amount_cents }]);
  if (cand[0]) await ctx.q.query('update movements set link_id=$2, pays_card_id=$3, settles_statement_id=$4 where id=$1', [cand[0].id, link, card.id, settles]);
}

// ---------------------------------------------------------------------
// Leitura, edição, classificação, exclusão
// ---------------------------------------------------------------------
export interface MovementRow {
  id: string; account_id: string | null; card_id: string | null; statement_id: string | null; kind: MovementKind;
  amount_cents: number; date: ISODate; competence: ISODate; due_date: ISODate | null; paid_date: ISODate | null;
  description: string; notes: string | null; status: MovementStatus; source: MovementSource; link_id: string | null;
  installment_group_id: string | null; installment_number: number | null; installment_total: number | null;
  recurring_rule_id: string | null; settles_statement_id: string | null; pays_card_id: string | null; version: number;
  import_batch_id: string | null; dedup_key: string | null; suggested_category_id: string | null; adjustment_reason: string | null;
}

export async function getMovementRow(ctx: Ctx, id: string): Promise<MovementRow> {
  const r = await ctx.q.query<MovementRow>('select * from movements where id=$1 and user_id=$2 and deleted_at is null', [id, ctx.userId]);
  if (!r[0]) throw new DomainError('Movimento não encontrado.');
  return r[0];
}

export async function getSplits(ctx: Ctx, movementId: string) {
  return ctx.q.query<{ id: string; category_id: string | null; amount_cents: number; person_id: string | null; notes: string | null }>(
    'select id, category_id, amount_cents, person_id, notes from movement_splits where movement_id=$1 and user_id=$2 order by sort_order, id',
    [movementId, ctx.userId],
  );
}

async function replaceSplits(ctx: Ctx, movementId: string, splits: SplitInput[]) {
  await ctx.q.query('delete from movement_splits where movement_id=$1 and user_id=$2', [movementId, ctx.userId]);
  await insertSplits(ctx, movementId, splits);
}

/** Desfaz o vínculo de um movimento (e do seu par). */
async function unlink(ctx: Ctx, m: Pick<MovementRow, 'id' | 'link_id'>) {
  if (!m.link_id) return;
  await ctx.q.query(`update movements set link_id=null, kind=case when kind in ('TRANSFER','CARD_PAYMENT') then 'NORMAL' else kind end,
    settles_statement_id=null, pays_card_id=null, updated_at=now() where link_id=$1 and user_id=$2 and id<>$3`, [m.link_id, ctx.userId, m.id]);
  await ctx.q.query('update movements set link_id=null where id=$1', [m.id]);
}

/** Define o rateio (1..n partes). A soma precisa fechar com o valor do movimento. */
export async function setSplits(ctx: Ctx, movementId: string, splits: SplitInput[]) {
  const m = await getMovementRow(ctx, movementId);
  if (!splits.length) throw new DomainError('Informe pelo menos uma classificação.');
  if (splits.some(s => !Number.isInteger(s.amountCents) || s.amountCents === 0)) throw new DomainError('Valores do rateio inválidos.');
  if (sum(splits.map(s => s.amountCents)) !== m.amount_cents) throw new DomainError('A soma do rateio precisa ser igual ao valor do movimento.');
  await assertCategories(ctx, splits.map(s => s.categoryId));
  const before = await getSplits(ctx, movementId);
  await replaceSplits(ctx, movementId, splits);
  await ctx.q.query('update movements set suggested_category_id=null, updated_at=now(), version=version+1 where id=$1', [movementId]);
  await audit(ctx, 'movement', movementId, 'UPDATE', {
    field: 'rateio',
    old: before.map(s => ({ c: s.category_id, v: s.amount_cents })),
    new: splits.map(s => ({ c: s.categoryId, v: s.amountCents })),
  });
}

/**
 * Classifica um movimento. Com um único rateio, troca a categoria; com vários, preenche só os pendentes.
 * Em compras parceladas, propaga para as demais parcelas do grupo que ainda estão com a mesma categoria.
 * Classificar como "Transferência entre contas" tenta ligar o outro lado automaticamente.
 */
export async function classifyMovement(ctx: Ctx, movementId: string, categoryId: string, opts: { propagate?: boolean; via?: string } = {}) {
  const m = await getMovementRow(ctx, movementId);
  const cat = (await ctx.q.query<{ id: string; system_key: string | null; nature: string; parent_id: string | null }>(
    'select id, system_key, nature, parent_id from categories where id=$1 and user_id=$2', [categoryId, ctx.userId]))[0];
  if (!cat) throw new DomainError('Categoria inválida.');
  if (!cat.parent_id) throw new DomainError('Escolha uma subcategoria.');
  if (cat.system_key === 'CARD_PAYMENT') throw new DomainError('Use "É pagamento de fatura" para indicar o cartão.');
  const splits = await getSplits(ctx, movementId);
  const old = splits.length === 1 ? splits[0].category_id : splits.map(s => s.category_id);
  if (splits.length === 1) {
    await ctx.q.query('update movement_splits set category_id=$2 where id=$1', [splits[0].id, categoryId]);
  } else {
    await ctx.q.query('update movement_splits set category_id=$2 where movement_id=$1 and category_id is null', [movementId, categoryId]);
  }
  const isTransfer = cat.system_key === 'TRANSFER' || cat.system_key === 'INVESTMENT_IN' || cat.system_key === 'INVESTMENT_OUT';
  let kind: MovementKind = m.kind;
  if (m.kind === 'CARD_PAYMENT') { await unlink(ctx, m); kind = 'NORMAL'; }
  if (isTransfer && m.account_id) kind = 'TRANSFER';
  else if (m.kind === 'TRANSFER' && !isTransfer) { await unlink(ctx, m); kind = 'NORMAL'; }
  if (m.kind === 'ADJUSTMENT' && cat.system_key !== 'ADJUSTMENT') kind = 'NORMAL';
  if (cat.system_key === 'ADJUSTMENT') kind = 'ADJUSTMENT';
  await ctx.q.query(
    `update movements set kind=$2, suggested_category_id=null, suggestion_confidence=null, suggestion_source=null,
       updated_at=now(), version=version+1 where id=$1`,
    [movementId, kind],
  );
  await audit(ctx, 'movement', movementId, 'CLASSIFY', { field: 'categoria', old, new: categoryId }, { via: opts.via ?? 'manual' });

  if (m.installment_group_id && opts.propagate !== false && splits.length === 1) {
    await ctx.q.query(
      `update movement_splits s set category_id=$3 from movements m
       where m.id=s.movement_id and m.installment_group_id=$1 and m.id<>$2 and m.deleted_at is null
         and (s.category_id is not distinct from $4)
         and (select count(*) from movement_splits x where x.movement_id=m.id) = 1`,
      [m.installment_group_id, movementId, categoryId, splits[0].category_id],
    );
    await ctx.q.query('update movements set suggested_category_id=null where installment_group_id=$1', [m.installment_group_id]);
  }
  if (kind === 'TRANSFER' && !m.link_id) await linkTransferCounterpart(ctx, movementId);
}

/** Procura o outro lado de uma transferência (conta própria, valor oposto, até 3 dias) e liga os dois. */
export async function linkTransferCounterpart(ctx: Ctx, movementId: string): Promise<string | null> {
  const m = await getMovementRow(ctx, movementId);
  if (!m.account_id || m.link_id) return null;
  const cands = await ctx.q.query<{ id: string }>(
    `select m.id from movements m
     where m.user_id=$1 and m.account_id is not null and m.account_id<>$2 and m.amount_cents=$3 and m.link_id is null
       and m.deleted_at is null and abs(m.date - $4::date) <= 3 and m.kind in ('NORMAL','TRANSFER')
       and (m.kind='TRANSFER' or exists (select 1 from movement_splits s where s.movement_id=m.id and s.category_id is null))
     order by abs(m.date - $4::date) limit 2`,
    [ctx.userId, m.account_id, -m.amount_cents, m.date],
  );
  if (cands.length !== 1) return null;
  const other = cands[0].id;
  const [outId, inId] = m.amount_cents < 0 ? [m.id, other] : [other, m.id];
  const out = await getMovementRow(ctx, outId), inn = await getMovementRow(ctx, inId);
  const cat = await transferCategory(ctx, out.account_id!, inn.account_id!);
  const link = await newLink(ctx, 'TRANSFER');
  for (const x of [out, inn]) {
    await ctx.q.query(`update movements set kind='TRANSFER', link_id=$2, suggested_category_id=null, updated_at=now() where id=$1`, [x.id, link]);
    await replaceSplits(ctx, x.id, [{ categoryId: cat, amountCents: x.amount_cents }]);
  }
  await audit(ctx, 'movement', m.id, 'LINK', { field: 'transferência', old: null, new: other });
  return link;
}

export interface MovementPatch {
  date?: ISODate; description?: string; amountCents?: number; categoryId?: string | null; accountId?: string | null;
  cardId?: string | null; competence?: ISODate; dueDate?: ISODate | null; notes?: string | null; status?: MovementStatus;
  statementId?: string | null;
}

/** Edita um movimento registrando cada alteração relevante no histórico. */
export async function updateMovement(ctx: Ctx, id: string, patch: MovementPatch, expectedVersion?: number) {
  const m = await getMovementRow(ctx, id);
  if (expectedVersion != null && expectedVersion !== m.version) throw new DomainError('Este lançamento foi alterado em outra tela. Recarregue e tente de novo.');
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const set: Record<string, unknown> = {};
  const push = (field: string, col: string, oldV: unknown, newV: unknown) => {
    if (newV === undefined || newV === oldV) return;
    changes.push({ field, old: oldV, new: newV });
    set[col] = newV;
  };
  if (patch.description !== undefined && !patch.description.trim()) throw new DomainError('Descrição obrigatória.');
  push('descrição', 'description', m.description, patch.description?.trim());
  if (set.description) set.normalized_description = norm(String(set.description));
  push('data', 'date', m.date, patch.date);
  push('observação', 'notes', m.notes, patch.notes === undefined ? undefined : (patch.notes?.trim() || null));
  push('vencimento', 'due_date', m.due_date, patch.dueDate);
  push('status', 'status', m.status, patch.status);
  if (patch.status === 'REALIZED' && m.account_id && !m.paid_date) set.paid_date = patch.date ?? m.date;

  // portador (conta/cartão) e fatura
  const newAccount = patch.accountId !== undefined ? patch.accountId : m.account_id;
  const newCard = patch.cardId !== undefined ? patch.cardId : m.card_id;
  if (!!newAccount === !!newCard) throw new DomainError('Informe uma conta ou um cartão.');
  if (newAccount !== m.account_id || newCard !== m.card_id) {
    if (m.link_id) throw new DomainError('Transferências e pagamentos de fatura não podem mudar de conta; exclua e lance de novo.');
    if (newAccount) await assertAccount(ctx, newAccount);
    changes.push({ field: m.account_id ? 'conta' : 'cartão', old: m.account_id ?? m.card_id, new: newAccount ?? newCard });
    set.account_id = newAccount ?? null;
    set.card_id = newCard ?? null;
  }
  let statementId: string | null = newCard ? (patch.statementId ?? m.statement_id) : null;
  if (newCard && (newCard !== m.card_id || (patch.date && patch.date !== m.date && !patch.statementId) || !statementId)) {
    const card = await loadCard(ctx, newCard);
    statementId = (await statementForPurchase(ctx, card, patch.date ?? m.date)).id;
  }
  if (statementId !== m.statement_id) {
    changes.push({ field: 'fatura', old: m.statement_id, new: statementId });
    set.statement_id = statementId;
  }
  // competência: explícita, ou recalculada quando a fatura/data mudou
  let competence = patch.competence ? monthStart(patch.competence) : undefined;
  if (!competence && set.statement_id !== undefined && statementId) {
    competence = (await ctx.q.query<{ due_month: ISODate }>('select due_month from card_statements where id=$1', [statementId]))[0].due_month;
  } else if (!competence && !newCard && (set.date !== undefined || set.account_id !== undefined) && m.competence === monthStart(m.date)) {
    competence = monthStart(String(set.date ?? m.date));
  }
  push('competência', 'competence', m.competence, competence);

  // valor e categoria (movimentos com um único rateio)
  const splits = await getSplits(ctx, id);
  if (patch.amountCents !== undefined && patch.amountCents !== m.amount_cents) {
    if (!Number.isInteger(patch.amountCents) || patch.amountCents === 0) throw new DomainError('Valor inválido.');
    if (splits.length > 1) throw new DomainError('Este lançamento tem rateio: ajuste o rateio junto com o valor.');
    changes.push({ field: 'valor', old: m.amount_cents, new: patch.amountCents });
    set.amount_cents = patch.amountCents;
    await ctx.q.query('update movement_splits set amount_cents=$2 where id=$1', [splits[0].id, patch.amountCents]);
  }
  if (Object.keys(set).length) {
    const cols = Object.keys(set);
    await ctx.q.query(
      `update movements set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now(), version=version+1 where id=$1`,
      [id, ...cols.map(c => set[c])],
    );
    for (const c of changes) await audit(ctx, 'movement', id, 'UPDATE', c);
  }
  // mantém o par (transferência/pagamento) consistente
  if (m.link_id && (set.amount_cents !== undefined || set.date !== undefined)) {
    const others = await ctx.q.query<{ id: string; amount_cents: number }>('select id, amount_cents from movements where link_id=$1 and id<>$2 and deleted_at is null', [m.link_id, id]);
    for (const o of others) {
      const amount = set.amount_cents !== undefined ? -Number(set.amount_cents) : o.amount_cents;
      await ctx.q.query('update movements set amount_cents=$2, date=coalesce($3,date), updated_at=now(), version=version+1 where id=$1', [o.id, amount, set.date ?? null]);
      await ctx.q.query('update movement_splits set amount_cents=$2 where movement_id=$1', [o.id, amount]);
    }
  }
  if (patch.categoryId !== undefined && patch.categoryId && (splits.length === 1 && splits[0].category_id !== patch.categoryId)) {
    await classifyMovement(ctx, id, patch.categoryId);
  }
  return changes.length;
}

/** Exclusão lógica (com o par, quando houver). scope='future' exclui também as parcelas/ocorrências seguintes. */
export async function deleteMovement(ctx: Ctx, id: string, scope: 'one' | 'future' = 'one') {
  const m = await getMovementRow(ctx, id);
  const ids = new Set([id]);
  if (m.link_id) {
    const o = await ctx.q.query<{ id: string }>('select id from movements where link_id=$1 and deleted_at is null', [m.link_id]);
    o.forEach(x => ids.add(x.id));
  }
  if (scope === 'future' && m.installment_group_id) {
    const o = await ctx.q.query<{ id: string }>('select id from movements where installment_group_id=$1 and installment_number>=$2 and deleted_at is null', [m.installment_group_id, m.installment_number]);
    o.forEach(x => ids.add(x.id));
  }
  if (scope === 'future' && m.recurring_rule_id) {
    const o = await ctx.q.query<{ id: string }>(`select id from movements where recurring_rule_id=$1 and date>=$2 and status='PLANNED' and deleted_at is null`, [m.recurring_rule_id, m.date]);
    o.forEach(x => ids.add(x.id));
  }
  await ctx.q.query('update movements set deleted_at=now(), updated_at=now() where id = any($1::uuid[]) and user_id=$2', [[...ids], ctx.userId]);
  for (const x of ids) await audit(ctx, 'movement', x, 'DELETE', null, { via: x === id ? 'manual' : 'vinculado' });
  return ids.size;
}

/** Confirma um previsto como realizado (ex.: conta paga sem importar extrato). */
export async function realizePlanned(ctx: Ctx, id: string, p: { date?: ISODate; amountCents?: number } = {}) {
  const m = await getMovementRow(ctx, id);
  if (m.status !== 'PLANNED') throw new DomainError('Este lançamento já está realizado.');
  await updateMovement(ctx, id, { status: 'REALIZED', date: p.date ?? m.date, amountCents: p.amountCents });
}

/** Parcelas previstas de cartão cujas faturas já fecharam passam a realizadas (idempotente). */
export async function autoRealizeInstallments(ctx: Ctx, today = todayFn()) {
  await ctx.q.query(
    `update movements m set status='REALIZED', updated_at=now() from card_statements s
     where m.user_id=$1 and m.status='PLANNED' and m.source='INSTALLMENT' and m.statement_id=s.id
       and s.closing_date <= $2 and m.deleted_at is null`,
    [ctx.userId, today],
  );
}

export { addDays };
