import { describe, it, expect, beforeAll } from 'vitest';
import { setup, account, card, inTx, type TestEnv } from './helpers';
import * as M from '@/server/domain/movements';
import { computeStatementDates, dueMonthForPurchase } from '@/server/domain/statements';
import { accountBalances, consolidated } from '@/server/domain/balances';
import { categoryTotals, summarize } from '@/server/domain/queries';
import { cardSummaries, statementViews } from '@/server/domain/cards';
import { toCents, splitInstallments } from '@/lib/money';
import { parseDate, addMonths } from '@/lib/dates';

async function econ(env: TestEnv, from = '2026-01-01', to = '2027-12-01') {
  const rows = await categoryTotals(env.ctx, from, to);
  return summarize(rows, 'ALL', new Set());
}

describe('utilitários', () => {
  it('converte valores pt-BR', () => {
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('- 1.693,60')).toBe(-169360);
    expect(toCents('R$ 24,00')).toBe(2400);
    expect(toCents(-6699.92)).toBe(-669992);
    expect(toCents('(10,00)')).toBe(-1000);
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents('abc')).toBeNull();
  });
  it('datas nunca voltam um dia (UTC 00:00 do Excel)', () => {
    expect(parseDate(new Date('2026-09-24T00:00:00.000Z'))).toBe('2026-09-24');
    expect(parseDate('05/09/2026')).toBe('2026-09-05');
    expect(parseDate(46270)).toBe('2026-09-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('parcelas fecham o total, diferença na 1ª', () => {
    expect(splitInstallments(120000, 6)).toEqual([20000, 20000, 20000, 20000, 20000, 20000]);
    expect(splitInstallments(-10000, 3)).toEqual([-3334, -3333, -3333]);
  });
  it('fechamento e vencimento do cartão', () => {
    const c = { closing_day: 10, due_day: 17 };
    expect(dueMonthForPurchase(c, '2026-09-08')).toBe('2026-09-01'); // entra na fatura atual (vence 17/09)
    expect(dueMonthForPurchase(c, '2026-09-12')).toBe('2026-10-01'); // próxima
    expect(dueMonthForPurchase(c, '2026-09-10')).toBe('2026-10-01'); // dia do fechamento → próxima
    const itau = { closing_day: 30, due_day: 7 };                      // fecha no mês anterior
    expect(computeStatementDates(itau, '2026-10-01')).toEqual({ closing_date: '2026-09-30', due_date: '2026-10-07' });
    expect(dueMonthForPurchase(itau, '2026-09-24')).toBe('2026-10-01');
    expect(computeStatementDates(itau, '2026-03-01').closing_date).toBe('2026-02-28');
  });
});

describe('regras financeiras (seção 49)', () => {
  let env: TestEnv; let cc: string; let sic: string; let pou: string; let cardId: string;
  beforeAll(async () => {
    env = await setup();
    cc = await account(env, 'Itaú', 'CHECKING', 1_500_000, '2026-01-01');
    sic = await account(env, 'Sicredi', 'CHECKING', 500_000, '2026-01-01');
    pou = await account(env, 'Poupança', 'SAVINGS', 0, '2026-01-01', false);
    cardId = await card(env, 'Cartão', 10, 17, 1_000_000, cc);
  });

  it('parcelamento: R$ 1.200 em 6x gera 6 parcelas ligadas, uma por fatura', async () => {
    const cat = await env.cat('Moradia > Móveis / Eletro / Eletrônicos');
    const { groupId, ids } = await inTx(env, ctx => M.createInstallmentPurchase(ctx, { cardId, date: '2026-01-05', totalCents: -120000, installments: 6, description: 'TV', categoryId: cat }));
    expect(ids).toHaveLength(6);
    const rows = await env.db.query<{ installment_number: number; amount_cents: number; competence: string; due_date: string }>(
      `select m.installment_number, m.amount_cents, m.competence, s.due_date from movements m join card_statements s on s.id=m.statement_id where installment_group_id=$1 order by installment_number`, [groupId]);
    expect(rows.map(r => r.amount_cents)).toEqual([-20000, -20000, -20000, -20000, -20000, -20000]);
    expect(rows.map(r => r.competence)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(rows[0].due_date).toBe('2026-01-17');
    const g = await env.db.query<{ total_amount_cents: number; installment_count: number }>('select * from installment_groups where id=$1', [groupId]);
    expect(g[0]).toMatchObject({ total_amount_cents: -120000, installment_count: 6 });
  });

  it('cartão: compra e pagamento da fatura contam a despesa uma única vez', async () => {
    const env2 = await setup();
    const acc = await account(env2, 'Conta', 'CHECKING', 100_000, '2026-01-01');
    const c = await card(env2, 'Cartão', 10, 17, 500_000, acc);
    const mercado = await env2.cat('Alimentação > Mercado / Limpeza');
    await inTx(env2, ctx => M.createSimple(ctx, { cardId: c, amountCents: -30000, date: '2026-03-02', description: 'MERCADO', categoryId: mercado }));
    const before = await econ(env2);
    expect(before.expense).toBe(30000);
    const [st] = await statementViews(env2.ctx, c);
    expect(st.total).toBe(30000);
    await inTx(env2, ctx => M.createCardPayment(ctx, { cardId: c, accountId: acc, amountCents: 30000, date: '2026-03-17' }));
    const after = await econ(env2);
    expect(after.expense).toBe(30000);            // não duplicou
    const [st2] = await statementViews(env2.ctx, c);
    expect(st2.paid).toBe(30000);
    expect(st2.status).toBe('PAID');
    const bal = await accountBalances(env2.ctx);
    expect(bal.find(b => b.id === acc)!.balance_cents).toBe(70000); // caixa saiu uma vez
    const [sum] = await cardSummaries(env2.ctx);
    expect(sum.used).toBe(0);
    // Soma econômica × caixa: pagamento é TRANSFER, fica fora de despesa
    const pay = await env2.db.query<{ nature: string }>(`select c.nature from movement_splits s join categories c on c.id=s.category_id join movements m on m.id=s.movement_id where m.kind='CARD_PAYMENT'`);
    expect(pay.every(p => p.nature === 'TRANSFER')).toBe(true);
  });

  it('transferência entre contas próprias não altera o patrimônio', async () => {
    const before = await consolidated(env.ctx);
    const e0 = await econ(env);
    await inTx(env, ctx => M.createTransfer(ctx, { fromAccountId: sic, toAccountId: cc, amountCents: 100000, date: '2026-04-01' }));
    const after = await consolidated(env.ctx);
    expect(after.total).toBe(before.total);
    expect(after.available).toBe(before.available);
    const e1 = await econ(env);
    expect(e1.income).toBe(e0.income);
    expect(e1.expense).toBe(e0.expense);
  });

  it('aporte de R$ 1.000 não é despesa de consumo; resgate não é renda', async () => {
    const e0 = await econ(env);
    await inTx(env, ctx => M.createTransfer(ctx, { fromAccountId: cc, toAccountId: pou, amountCents: 100000, date: '2026-04-05' }));
    const e1 = await econ(env);
    expect(e1.expense).toBe(e0.expense);
    expect(e1.investedNet - e0.investedNet).toBe(100000);   // aparece como valor poupado
    await inTx(env, ctx => M.createTransfer(ctx, { fromAccountId: pou, toAccountId: cc, amountCents: 100000, date: '2026-04-10' }));
    const e2 = await econ(env);
    expect(e2.income).toBe(e0.income);
    expect(e2.investedNet).toBe(e0.investedNet);
    // aporte/resgate sem conta de investimento controlada (movimento único)
    const aporte = await env.cat('Poupança > Aporte');
    await inTx(env, ctx => M.createSimple(ctx, { accountId: cc, amountCents: -50000, date: '2026-04-11', description: 'APLICACAO', categoryId: aporte }));
    const e3 = await econ(env);
    expect(e3.expense).toBe(e0.expense);
    expect(e3.investedNet - e0.investedNet).toBe(50000);
  });

  it('empréstimo recebido não é renda', async () => {
    const e0 = await econ(env);
    const emp = await env.cat('Bancário > Empréstimo');
    await inTx(env, ctx => M.createSimple(ctx, { accountId: cc, amountCents: 414718, date: '2026-07-01', description: 'CREDITO EMPRESTIMO', categoryId: emp }));
    const e1 = await econ(env);
    expect(e1.income).toBe(e0.income);
    expect(e1.financingIn - e0.financingIn).toBe(414718);
  });

  it('rateio: R$ 500 = 350 + 100 + 50, e o banco recusa soma diferente', async () => {
    const id = await inTx(env, ctx => M.createSimple(ctx, { accountId: cc, amountCents: -50000, date: '2026-05-02', description: 'SUPERMERCADO' }));
    const [a, b, c] = [await env.cat('Alimentação > Mercado / Limpeza'), await env.cat('Outros > Despesa não identificada'), await env.cat('Pet > Ração / Alimentação')];
    await inTx(env, ctx => M.setSplits(ctx, id, [{ categoryId: a, amountCents: -35000 }, { categoryId: b, amountCents: -10000 }, { categoryId: c, amountCents: -5000 }]));
    const s = await env.db.query<{ total: number; n: number }>('select sum(amount_cents) as total, count(*)::int as n from movement_splits where movement_id=$1', [id]);
    expect(s[0]).toEqual({ total: -50000, n: 3 });
    await expect(inTx(env, ctx => M.setSplits(ctx, id, [{ categoryId: a, amountCents: -35000 }]))).rejects.toThrow();
    // movimento continua único (rateio não duplica o movimento)
    const n = await env.db.query<{ n: number }>(`select count(*)::int as n from movements where description='SUPERMERCADO'`);
    expect(n[0].n).toBe(1);
  });

  it('ajuste de saldo corrige a conta mas não é consumo', async () => {
    const e0 = await econ(env);
    const b0 = (await accountBalances(env.ctx)).find(b => b.id === cc)!.balance_cents;
    await inTx(env, ctx => M.createAdjustment(ctx, { accountId: cc, amountCents: -5000, date: '2026-05-10', reason: 'Diferença com o banco' }));
    const b1 = (await accountBalances(env.ctx)).find(b => b.id === cc)!.balance_cents;
    expect(b1 - b0).toBe(-5000);
    const e1 = await econ(env);
    expect(e1.expense).toBe(e0.expense);
    expect(e1.adjustments - e0.adjustments).toBe(-5000);
  });

  it('edição registra histórico e mantém rateio consistente', async () => {
    const id = await inTx(env, ctx => M.createSimple(ctx, { accountId: cc, amountCents: -1000, date: '2026-05-03', description: 'CAFE' }));
    await inTx(env, ctx => M.updateMovement(ctx, id, { amountCents: -1500, description: 'CAFÉ DA MANHÃ' }));
    const h = await env.db.query<{ field: string; old_value: string; new_value: string }>(`select field, old_value, new_value from audit_events where entity_id=$1 and action='UPDATE' order by id`, [id]);
    expect(h.map(x => x.field)).toEqual(['descrição', 'valor']);
    expect(h[1]).toMatchObject({ old_value: '-1000', new_value: '-1500' });
    const s = await env.db.query<{ amount_cents: number }>('select amount_cents from movement_splits where movement_id=$1', [id]);
    expect(s[0].amount_cents).toBe(-1500);
  });

  it('classificar como transferência liga os dois lados', async () => {
    const t = await env.cat('Poupança > Transferência entre contas');
    const out = await inTx(env, ctx => M.createSimple(ctx, { accountId: sic, amountCents: -20000, date: '2026-06-01', description: 'PIX TRANSF ELITON' }));
    const inn = await inTx(env, ctx => M.createSimple(ctx, { accountId: cc, amountCents: 20000, date: '2026-06-02', description: 'PIX RECEBIDO ELITON' }));
    await inTx(env, ctx => M.classifyMovement(ctx, out, t));
    const r = await env.db.query<{ id: string; link_id: string; kind: string }>('select id, link_id, kind from movements where id = any($1::uuid[])', [[out, inn]]);
    expect(r[0].link_id).toBeTruthy();
    expect(r[0].link_id).toBe(r[1].link_id);
    expect(r.every(x => x.kind === 'TRANSFER')).toBe(true);
  });
});
