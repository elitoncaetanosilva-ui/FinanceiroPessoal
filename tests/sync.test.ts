import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { setup, account, card, inTx, type TestEnv } from './helpers';
import { batchRows, commitBatch, createBatch, getBatch, setBatchHolder } from '@/server/import/pipeline';
import { accountBalances } from '@/server/domain/balances';

const REAL = path.join(__dirname, 'fixtures/real');
const read = (n: string) => fs.readFileSync(path.join(REAL, n));
const has = ['CAIXA_2026.xlsx', 'CAIXA_2026_v2.xlsx', 'Extrato_Conta_Corrente-250920262155.xls'].every(n => fs.existsSync(path.join(REAL, n)));

async function importFile(env: TestEnv, name: string, bytes: Buffer, holder?: { accountId?: string; cardId?: string }) {
  const id = await inTx(env, ctx => createBatch(ctx, { name, bytes }));
  const b = await getBatch(env.ctx, id);
  if (!b.account_id && !b.card_id && holder) await inTx(env, ctx => setBatchHolder(ctx, id, holder));
  await batchRows(env.ctx, id);
  return inTx(env, ctx => commitBatch(ctx, id));
}
const count = async (env: TestEnv) => (await env.db.query<{ n: number }>('select count(*)::int as n from movements where deleted_at is null'))[0].n;

describe.skipIf(!has)('sincronização com a planilha atualizada (arquivos reais)', () => {
  it('migração antiga + extrato + faturas, depois a planilha nova: só entra o que falta', async () => {
    const { parseCaixa, applyCaixa } = await import('@/server/import/planilha');
    const { planSync, applySync } = await import('@/server/import/planilha-sync');
    const env = await setup();
    const acc = await account(env, 'Itaú', 'CHECKING', -58695, '2026-08-31');
    await env.db.query(`update accounts set branch='7449', number='04594-2' where id=$1`, [acc]);
    const itau = await card(env, 'Itaú Black', 30, 7, 2_000_000, acc, ['FATURA ITAU UNICLASS']);
    await env.db.query(`update credit_cards set last4='5850' where id=$1`, [itau]);
    const nu = await card(env, 'Nubank', 20, 27, 500_000, acc, ['NU PAGAMENT']);
    await env.db.query(`update credit_cards set institution_id=(select id from institutions where user_id=$2 and name='Nubank') where id=$1`, [nu, env.userId]);
    const cardMap = { 'Itaú Black': itau, Nubank: nu };
    await inTx(env, ctx => applyCaixa(ctx, parseCaixa(read('CAIXA_2026.xlsx')), { accountId: acc, cardMap, cashCutoff: '2026-08-01', cardCutoff: '2026-09-01', importHistory: true, importBudgets: true }));
    await importFile(env, 'Extrato_Conta_Corrente-250920262155.xls', read('Extrato_Conta_Corrente-250920262155.xls'));
    await importFile(env, 'fatura-aberta-final_5850-outubro2026.xlsx', read('fatura-aberta-final_5850-outubro2026.xlsx'));
    await importFile(env, 'Nubank_2026-10-27.csv', read('Nubank_2026-10-27.csv'), { cardId: nu });

    const p = parseCaixa(read('CAIXA_2026_v2.xlsx'));
    const opts = { accountId: acc, cardMap, checkpoint: { date: '2026-09-30', balanceCents: 10851 } };
    const plan = await planSync(env.ctx, p, opts);
    const rows = (xs: typeof plan.items, sheet: string) => xs.filter(i => i.sheet === sheet).map(i => i.row).sort((a, b) => a - b);
    // conta: só o que veio depois do extrato (24/09 em diante)
    expect(rows(plan.newItems, 'CASH')).toEqual([288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301]);
    // cartão: compras posteriores à fatura importada; parcelas com diferença de centavos casam com as previstas
    expect(rows(plan.newItems, 'CARTÃO')).toEqual([739, 740, 741, 742, 743, 763, 764]);
    expect(plan.newItems.find(i => i.row === 764)!.future).toBe(true);
    // linhas de setembro sem correspondência no extrato são ignoradas (o extrato confere com o banco)
    expect(rows(plan.ignored, 'CASH')).toEqual(expect.arrayContaining([243, 244, 245, 246, 247, 287]));
    // R$ 237,90 em 23/09 − gastos de 24 a 30/09 = R$ 108,51 informado pelo banco
    expect(plan.balanceCheck).toMatchObject({ computed: 10851, diff: 0 });
    expect(plan.unknownCategories).toEqual([]);
    expect(plan.fills.length).toBeGreaterThan(30);

    const before = await count(env);
    const pend = async () => (await env.db.query<{ n: number }>('select count(*)::int as n from movement_splits where category_id is null'))[0].n;
    const pendBefore = await pend();
    const b = await env.db.query<{ id: string }>(`insert into import_batches(user_id, file_name, file_sha256, file_size, importer_id) values ($1,'x','y',1,'caixa-planilha') returning id`, [env.userId]);
    const st = await inTx(env, ctx => applySync(ctx, b[0].id, p, opts));
    expect(st.created).toBe(21);
    expect(await count(env)).toBe(before + 21);
    expect(await pend()).toBeLessThanOrEqual(pendBefore - st.filled);   // a classificação pode valer para pendentes iguais
    const bal = (await accountBalances(env.ctx)).find(a => a.id === acc)!;
    expect(bal.checkpoint).toMatchObject({ date: '2026-09-30', reported: 10851, diff: 0 });
    // fatura de outubro do Itaú ganha as compras de 25 a 27/09; Lojas Dez 2/2 fica prevista em novembro
    const lojas = await env.db.query<{ status: string; due_month: string }>(
      `select m.status, s.due_month from movements m join card_statements s on s.id=m.statement_id where m.description like 'Lojas Dez%' order by s.due_month`);
    expect(lojas.map(x => x.status)).toEqual(['REALIZED', 'PLANNED']);

    // sincronizar de novo não muda nada
    const again = await planSync(env.ctx, p, opts);
    expect(again.newItems).toHaveLength(0);
    expect(again.fills).toHaveLength(0);
    const st2 = await inTx(env, ctx => applySync(ctx, b[0].id, p, opts));
    expect(st2.created).toBe(0);
    expect(await count(env)).toBe(before + 21);
  });
});

describe.skipIf(!has)('receitas mensais informadas (arquivos reais)', () => {
  it('histórico vai para o 1º dia útil, a TED do extrato é rateada e o que não está no extrato vai para "Outras contas"', async () => {
    const { parseCaixa, applyCaixa } = await import('@/server/import/planilha');
    const { reconcileIncomes } = await import('@/server/domain/incomes');
    const env = await setup();
    const acc = await account(env, 'Itaú', 'CHECKING', -58695, '2026-08-31');
    await env.db.query(`update accounts set branch='7449', number='04594-2' where id=$1`, [acc]);
    const old = parseCaixa(read('CAIXA_2026.xlsx'));
    await inTx(env, ctx => applyCaixa(ctx, old, { accountId: acc, cardMap: {}, cashCutoff: '2026-08-01', cardCutoff: '2026-09-01', importHistory: true, importBudgets: false }));
    await importFile(env, 'Extrato_Conta_Corrente-250920262155.xls', read('Extrato_Conta_Corrente-250920262155.xls'));
    const balance = async () => (await accountBalances(env.ctx)).find(a => a.id === acc)!.balance_cents;
    const before = await balance();
    // a tabela de receitas que o usuário enviou = REALIZADO das entradas da planilha (jan a set)
    const entries = old.incomes.map(i => ({ month: i.month, group: i.group, sub: i.sub, cents: i.valueCents }));
    const sep = entries.filter(e => e.month === '2026-09-01');
    expect(sep).toHaveLength(4);

    const r = await inTx(env, ctx => reconcileIncomes(ctx, acc, entries));
    expect(r).toMatchObject({ kept: entries.length - 4, redated: entries.filter(e => ['01', '02', '03', '05', '08'].includes(e.month.slice(5, 7))).length, classified: 2, splitMovements: 1, createdMain: 0, createdOther: 2, divergent: 0 });
    // jan/fev/mar/mai/ago começam em feriado ou fim de semana
    const dates = await env.db.query<{ date: string }>(`select distinct date::text from movements where dedup_key like 'mig|inc|%' order by 1`);
    expect(dates.map(d => d.date)).toEqual(['2026-01-02', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-04', '2026-06-01', '2026-07-01', '2026-08-03']);
    // TED de 03/09 = salário + rescisão
    const ted = await env.db.query<{ name: string; amount_cents: number }>(
      `select c.name, x.amount_cents from movement_splits x join movements m on m.id=x.movement_id join categories c on c.id=x.category_id
       where m.description like 'TED 001.3220%' order by x.amount_cents`);
    expect(ted).toEqual([{ name: 'Salário', amount_cents: 650000 }, { name: 'Rescisão', amount_cents: 702435 }]);
    expect(await balance()).toBe(before);                       // a conta principal continua conferindo com o banco
    const other = (await accountBalances(env.ctx)).find(a => a.name === 'Outras contas')!;
    expect(other.balance_cents).toBe(211768);
    // entradas de setembro completas no orçamento
    const { budgetView } = await import('@/server/domain/budget');
    const v = await budgetView(env.ctx, '2026-09-01');
    expect(v.sections.find(s => s.section === 'IN')!.total.realized).toBe(sep.reduce((s, e) => s + e.cents, 0));

    const n = await count(env);
    const again = await inTx(env, ctx => reconcileIncomes(ctx, acc, entries));
    expect(again).toMatchObject({ kept: entries.length, redated: 0, classified: 0, createdMain: 0, createdOther: 0 });
    expect(await count(env)).toBe(n);
  });
});

describe.skipIf(!has)('receitas mensais sem extrato importado (app guiado pela planilha)', () => {
  it('lança na conta principal (TED na data real, com rateio); o extrato importado depois reconhece e não duplica', async () => {
    const { parseCaixa, applyCaixa } = await import('@/server/import/planilha');
    const { reconcileIncomes } = await import('@/server/domain/incomes');
    const env = await setup();
    const acc = await account(env, 'Itaú Conta Corrente', 'CHECKING', 0, '2025-12-31');
    await env.db.query(`update accounts set branch='7449', number='04594-2' where id=$1`, [acc]);
    const old = parseCaixa(read('CAIXA_2026.xlsx'));
    await inTx(env, ctx => applyCaixa(ctx, old, { accountId: acc, cardMap: {}, cashCutoff: '2026-08-01', cardCutoff: '2026-09-01', importHistory: true, importBudgets: false }));
    const ref = 'TED 001.3220.ELITON C D';
    const entries = old.incomes.map(i => ({ month: i.month, group: i.group, sub: i.sub, cents: i.valueCents,
      ...(i.month === '2026-09-01' && ['Salário', 'Rescisão'].includes(i.sub) ? { date: '2026-09-03', ref } : {}) }));
    const r = await inTx(env, ctx => reconcileIncomes(ctx, acc, entries));
    expect(r).toMatchObject({ kept: entries.length - 4, createdMain: 4, createdOther: 0, splitMovements: 1, divergent: 0 });
    const sep = await env.db.query<{ date: string; amount_cents: number; n: number }>(
      `select m.date::text, m.amount_cents, (select count(*)::int from movement_splits x where x.movement_id=m.id) as n
       from movements m where m.account_id=$1 and m.amount_cents > 0 and m.competence='2026-09-01' order by m.date, m.amount_cents`, [acc]);
    expect(sep).toEqual([{ date: '2026-09-01', amount_cents: 11768, n: 1 }, { date: '2026-09-01', amount_cents: 200000, n: 1 }, { date: '2026-09-03', amount_cents: 1352435, n: 2 }]);
    const again = await inTx(env, ctx => reconcileIncomes(ctx, acc, entries));
    expect(again).toMatchObject({ kept: entries.length, createdMain: 0, splitMovements: 0 });

    const id = await inTx(env, ctx => createBatch(ctx, { name: 'e.xls', bytes: read('Extrato_Conta_Corrente-250920262155.xls') }));
    const ted = (await batchRows(env.ctx, id)).find(x => x.description.startsWith('TED 001.3220'))!;
    expect(ted.status).toBe('POSSIBLE_DUPLICATE');
    await inTx(env, ctx => commitBatch(ctx, id));
    const n = await env.db.query<{ n: number }>(`select count(*)::int as n from movements where account_id=$1 and amount_cents=1352435 and deleted_at is null`, [acc]);
    expect(n[0].n).toBe(1);
  });
});
