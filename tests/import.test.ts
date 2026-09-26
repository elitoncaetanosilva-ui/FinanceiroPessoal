import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { setup, account, card, inTx, type TestEnv } from './helpers';
import { itauExtrato, itauFatura, nubankCsv } from './fixtures';
import { batchRows, commitBatch, createBatch, getBatch, revertBatch, setBatchHolder, setRowDecision } from '@/server/import/pipeline';
import { accountBalances } from '@/server/domain/balances';
import { statementViews } from '@/server/domain/cards';
import { categoryTotals, summarize } from '@/server/domain/queries';
import * as M from '@/server/domain/movements';

async function importFile(env: TestEnv, name: string, bytes: Buffer, holder?: { accountId?: string; cardId?: string }) {
  const id = await inTx(env, ctx => createBatch(ctx, { name, bytes }));
  const b = await getBatch(env.ctx, id);
  if (!b.account_id && !b.card_id) {
    if (!holder) throw new Error('lote sem portador');
    await inTx(env, ctx => setBatchHolder(ctx, id, holder));
  }
  const before = await batchRows(env.ctx, id);
  const result = await inTx(env, ctx => commitBatch(ctx, id));
  return { id, rows: before, result };
}
const count = async (env: TestEnv, where = 'true', params: unknown[] = []) =>
  (await env.db.query<{ n: number }>(`select count(*)::int as n from movements where deleted_at is null and ${where}`, params))[0].n;

describe('importação — deduplicação', () => {
  let env: TestEnv; let acc: string;
  beforeAll(async () => {
    env = await setup();
    acc = await account(env, 'Itaú', 'CHECKING', -58695, '2026-08-31');
    await env.db.query(`update accounts set branch='1234', number='01234-5' where id=$1`, [acc]);
  });

  it('identifica a conta pelo número e importa com conferência de saldo', async () => {
    const f = itauExtrato([
      ['01/09/2026', 'PIX QRS SERRA DIESE01/09', -20], ['02/09/2026', 'PAY MINI 02/09', -17], ['02/09/2026', 'PAY MINI 02/09', -17],
      ['03/09/2026', 'TED 001.3220.TITULAR', 13524.35], ['04/09/2026', 'PIX TRANSF MARIA 04/09', -150],
    ], -586.95);
    const r = await importFile(env, 'extrato.xls', f.bytes);
    expect(r.rows).toHaveLength(5);
    expect(r.result.imported).toBe(5);                           // as 2 compras iguais no mesmo dia entram
    const bal = (await accountBalances(env.ctx)).find(a => a.id === acc)!;
    expect(bal.balance_cents).toBe(Math.round(f.finalBalance * 100));
    expect(bal.checkpoint?.diff).toBe(0);                         // confere com o saldo do banco
    const serra = r.rows.find(x => x.description.startsWith('PIX QRS SERRA'))!;
    expect(serra.category_id).toBeTruthy();                       // Combustível (regra do sistema)
    const maria = r.rows.find(x => x.description.includes('MARIA'))!;
    expect(maria.category_id).toBeNull();                         // incerto → Pendentes
    const ted = r.rows.find(x => x.description.startsWith('TED'))!;
    expect(ted.category_id).toBeNull();                           // entrada genérica nunca é classificada no chute
  });

  it('importar o MESMO arquivo de novo não duplica nada', async () => {
    const f = itauExtrato([
      ['01/09/2026', 'PIX QRS SERRA DIESE01/09', -20], ['02/09/2026', 'PAY MINI 02/09', -17], ['02/09/2026', 'PAY MINI 02/09', -17],
      ['03/09/2026', 'TED 001.3220.TITULAR', 13524.35], ['04/09/2026', 'PIX TRANSF MARIA 04/09', -150],
    ], -586.95);
    const before = await count(env);
    const r = await importFile(env, 'extrato.xls', f.bytes);
    expect(r.rows.every(x => x.status === 'DUPLICATE')).toBe(true);
    expect(r.result.imported).toBe(0);
    expect(await count(env)).toBe(before);
  });

  it('períodos sobrepostos: só entram os lançamentos novos (inclusive uma 3ª compra igual)', async () => {
    const f = itauExtrato([
      ['02/09/2026', 'PAY MINI 02/09', -17], ['02/09/2026', 'PAY MINI 02/09', -17], ['02/09/2026', 'PAY MINI 02/09', -17],
      ['03/09/2026', 'TED 001.3220.TITULAR', 13524.35], ['04/09/2026', 'PIX TRANSF MARIA 04/09', -150], ['05/09/2026', 'DA CLARO CELULAR 5', -38.9],
    ], -606.95, { dataAnterior: '01/09/2026' });
    const before = await count(env);
    const r = await importFile(env, 'extrato2.xls', f.bytes);
    expect(r.result.imported).toBe(2);                           // 3ª PAY MINI + CLARO
    expect(await count(env)).toBe(before + 2);
    const bal = (await accountBalances(env.ctx)).find(a => a.id === acc)!;
    expect(bal.checkpoint?.diff).toBe(0);
  });

  it('lançamento manual + importação do mesmo gasto: vira vínculo, não duplica', async () => {
    const manual = await inTx(env, ctx => M.createSimple(ctx, { accountId: acc, amountCents: -4500, date: '2026-09-06', description: 'Almoço', categoryId: null }));
    const f = itauExtrato([['07/09/2026', 'PAY RESTAUR 06/09', -45]], -645.85, { dataAnterior: '05/09/2026' });
    const r = await importFile(env, 'extrato3.xls', f.bytes);
    expect(r.rows[0].status).toBe('POSSIBLE_DUPLICATE');
    expect(r.rows[0].matched_movement_id).toBe(manual);
    expect(r.result.linked).toBe(1);
    expect(await count(env, 'amount_cents=-4500')).toBe(1);
  });

  it('desfazer lote remove o que ele criou', async () => {
    const f = itauExtrato([['10/09/2026', 'PIX QRS PADARIA 10/09', -12.5]], 0, { dataAnterior: '09/09/2026' });
    const r = await importFile(env, 'extrato4.xls', f.bytes);
    expect(await count(env, 'import_batch_id=$1', [r.id])).toBe(1);
    await inTx(env, ctx => revertBatch(ctx, r.id));
    expect(await count(env, 'import_batch_id=$1', [r.id])).toBe(0);
    const again = await importFile(env, 'extrato4.xls', f.bytes);   // pode importar de novo depois de desfazer
    expect(again.result.imported).toBe(1);
  });
});

describe('importação — cartão, parcelas e pagamento de fatura', () => {
  let env: TestEnv; let acc: string; let itau: string; let nu: string;
  beforeAll(async () => {
    env = await setup();
    acc = await account(env, 'Itaú CC', 'CHECKING', 0, '2026-08-31');
    await env.db.query(`update accounts set branch='1234', number='01234-5' where id=$1`, [acc]);
    itau = await card(env, 'Itaú Black', 30, 7, 2_000_000, acc, ['FATURA ITAU UNICLASS']);
    await env.db.query(`update credit_cards set last4='1111', institution_id=(select id from institutions where user_id=$2 and name='Itaú') where id=$1`, [itau, env.userId]);
    nu = await card(env, 'Nubank', 20, 27, 500_000, acc, ['NU PAGAMENT']);
    await env.db.query(`update credit_cards set institution_id=(select id from institutions where user_id=$2 and name='Nubank') where id=$1`, [nu, env.userId]);
  });

  it('fatura com "Parcela 3 de 10" gera a parcela realizada e as previstas; a próxima fatura realiza em vez de duplicar', async () => {
    const out = itauFatura([
      ['2026-09-08', 'Pagamento Debito Automatico', null, -6699.92],
      ['2026-09-17', 'Cea Modas 0563 Rio Grade Do Sulbra', 'Parcela 1 de 3', 53.33],
      ['2026-07-04', 'Rennercabreuvabra', 'Parcela 3 de 10', 87.94, '8706'],
      ['2026-09-19', 'Panvel Filial 173caxias Do Sulbra', null, 62.92],
      ['2026-09-19', 'Panvel Filial 173caxias Do Sulbra', null, 62.92],
    ], '2026-10-07');
    const r = await importFile(env, 'fatura-out.xlsx', out);
    expect((await getBatch(env.ctx, r.id)).card_id).toBe(itau);
    expect(r.result.imported).toBe(4);
    expect(r.result.planned).toBe(2 + 7);                          // Cea 2..3 + Renner 4..10
    const [oct] = (await statementViews(env.ctx, itau)).filter(s => s.due_month === '2026-10-01');
    expect(oct.total).toBe(5333 + 8794 + 6292 * 2);                // pagamento não entra no total
    expect(oct.reported_total_cents).toBe(oct.total);
    const renner = await env.db.query<{ installment_number: number; status: string; competence: string }>(
      `select installment_number, status, competence from movements where description like 'Renner%' and deleted_at is null order by installment_number`);
    expect(renner.map(x => x.installment_number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(renner[1]).toMatchObject({ status: 'PLANNED', competence: '2026-11-01' });

    // próxima fatura: parcela 4 (com 1 centavo de diferença) e parcela 2 da Cea
    const nov = itauFatura([
      ['2026-07-04', 'Rennercabreuvabra', 'Parcela 4 de 10', 87.94, '8706'],
      ['2026-09-17', 'Cea Modas 0563 Rio Grade Do Sulbra', 'Parcela 2 de 3', 53.34],
      ['2026-10-02', 'Zaffari Caxiascaxias Do Sulbra', null, 100],
    ], '2026-11-07');
    const before = await count(env, 'card_id=$1', [itau]);
    const r2 = await importFile(env, 'fatura-nov.xlsx', nov);
    expect(r2.rows.filter(x => x.status === 'MATCHED')).toHaveLength(2);
    expect(r2.result.linked).toBe(2);
    expect(r2.result.imported).toBe(1);
    expect(await count(env, 'card_id=$1', [itau])).toBe(before + 1);
    const cea2 = await env.db.query<{ status: string; amount_cents: number }>(`select status, amount_cents from movements where description like 'Cea%' and installment_number=2 and deleted_at is null`);
    expect(cea2).toEqual([{ status: 'REALIZED', amount_cents: -5334 }]);
  });

  it('pagamento da fatura no extrato e na fatura é UM evento, nunca despesa', async () => {
    const e0 = summarize(await categoryTotals(env.ctx, '2026-01-01', '2027-12-01'), 'ALL', new Set());
    const f = itauExtrato([
      ['08/09/2026', 'FATURA ITAU UNICLASS MC BLA', -6699.92],
      ['21/09/2026', 'PIX QRS NU PAGAMENT20/09', -1693.6],
    ], 10000, { dataAnterior: '31/08/2026' });
    const r = await importFile(env, 'extrato.xls', f.bytes);
    expect(r.rows.every(x => x.row_kind === 'CARD_PAYMENT')).toBe(true);
    expect(r.rows.find(x => x.description.startsWith('FATURA'))!.target_card_id).toBe(itau);
    expect(r.rows.find(x => x.description.startsWith('PIX QRS NU'))!.target_card_id).toBe(nu);
    // o crédito "Pagamento Debito Automatico" da fatura já importada foi ligado ao débito do extrato
    const pay = await env.db.query<{ link_id: string; n: number }>(
      `select link_id, count(*)::int as n from movements where kind='CARD_PAYMENT' and abs(amount_cents)=669992 and deleted_at is null group by link_id`);
    expect(pay).toHaveLength(1);
    expect(pay[0].n).toBe(2);
    // Nubank: extrato primeiro; ao importar a fatura, o "Pagamento recebido" vincula ao lado do cartão já criado
    const csv = nubankCsv([['2026-09-20', 'Pagamento recebido', '- 1.693,60'], ['2026-09-20', 'Panvel*Digital - Parcela 3/4', '44,79']]);
    const rn = await importFile(env, 'Nubank_2026-10-27.csv', csv);
    expect((await getBatch(env.ctx, rn.id)).card_id).toBe(nu);
    const payRow = rn.rows.find(x => x.description.startsWith('Pagamento'))!;
    expect(payRow.status).toBe('POSSIBLE_DUPLICATE');
    expect(await count(env, `kind='CARD_PAYMENT' and abs(amount_cents)=169360`)).toBe(2);   // conta + cartão, não 3
    const e1 = summarize(await categoryTotals(env.ctx, '2026-01-01', '2027-12-01'), 'ALL', new Set());
    expect(e1.expense - e0.expense).toBe(4479 + 4479);             // só a parcela 3 (+ prevista 4) da Panvel; pagamentos fora
    const bal = (await accountBalances(env.ctx)).find(a => a.id === acc)!;
    expect(bal.balance_cents).toBe(0 - 669992 - 169360);           // saldo inicial 0: saíram só os dois pagamentos
  });

  it('reimportar a fatura do Nubank não duplica', async () => {
    const csv = nubankCsv([['2026-09-20', 'Pagamento recebido', '- 1.693,60'], ['2026-09-20', 'Panvel*Digital - Parcela 3/4', '44,79']]);
    const before = await count(env);
    const r = await importFile(env, 'Nubank_2026-10-27.csv', csv);
    expect(r.result.imported + r.result.payments).toBe(0);
    expect(await count(env)).toBe(before);
  });

  it('decisão do usuário: marcar linha para não importar', async () => {
    const csv = nubankCsv([['2026-10-21', 'Loja X', '10,00']]);
    const id = await inTx(env, ctx => createBatch(ctx, { name: 'Nubank_2026-11-27.csv', bytes: csv }));
    const [row] = await batchRows(env.ctx, id);
    await inTx(env, ctx => setRowDecision(ctx, row.id, { action: 'SKIP' }));
    const res = await inTx(env, ctx => commitBatch(ctx, id));
    expect(res.imported).toBe(0);
    await expect(inTx(env, ctx => commitBatch(ctx, id))).rejects.toThrow(/já foi confirmado/);   // duplo clique
  });
});

// ------------------------------------------------------------------ arquivos reais (opcional, fora do git)
const REAL = path.join(__dirname, 'fixtures/real');
const hasReal = fs.existsSync(path.join(REAL, 'Extrato_Conta_Corrente-250920262155.xls'));
describe.skipIf(!hasReal)('arquivos reais', () => {
  it('extrato, fatura Itaú e Nubank: saldo confere, total da fatura confere, reimportação não duplica', async () => {
    const env = await setup();
    const acc = await account(env, 'Itaú', 'CHECKING', -58695, '2026-08-31');
    await env.db.query(`update accounts set branch='7449', number='04594-2' where id=$1`, [acc]);
    const itau = await card(env, 'Itaú Black', 30, 7, 2_000_000, acc, ['FATURA ITAU UNICLASS']);
    await env.db.query(`update credit_cards set last4='5850' where id=$1`, [itau]);
    const nu = await card(env, 'Nubank', 20, 27, 500_000, acc, ['NU PAGAMENT']);
    await env.db.query(`update credit_cards set institution_id=(select id from institutions where user_id=$2 and name='Nubank') where id=$1`, [nu, env.userId]);
    const read = (n: string) => fs.readFileSync(path.join(REAL, n));

    const e = await importFile(env, 'Extrato_Conta_Corrente-250920262155.xls', read('Extrato_Conta_Corrente-250920262155.xls'));
    expect(e.rows).toHaveLength(51);
    const bal = (await accountBalances(env.ctx)).find(a => a.id === acc)!;
    expect(bal.balance_cents).toBe(23790);                       // R$ 237,90 em 23/09, igual ao banco
    expect(bal.checkpoint?.diff).toBe(0);
    expect(e.rows.filter(r => r.row_kind === 'CARD_PAYMENT').map(r => r.description).sort()).toEqual(['FATURA ITAU UNICLASS MC BLA', 'PIX QRS NU PAGAMENT20/09']);

    const f = await importFile(env, 'fatura-aberta-final_5850-outubro2026.xlsx', read('fatura-aberta-final_5850-outubro2026.xlsx'));
    const oct = (await statementViews(env.ctx, itau)).find(s => s.due_month === '2026-10-01')!;
    expect(oct.total).toBe(472891);                               // = "Valor (parcial)" do banco
    expect(f.rows.find(r => r.row_kind === 'CARD_PAYMENT')!.status).toBe('POSSIBLE_DUPLICATE'); // liga ao débito do extrato

    await importFile(env, 'Nubank_2026-10-27.csv', read('Nubank_2026-10-27.csv'));
    const payments = await env.db.query<{ n: number }>(`select count(distinct link_id)::int as n from movements where kind='CARD_PAYMENT' and deleted_at is null`);
    expect(payments[0].n).toBe(2);

    const total = await count(env);
    for (const n of ['Extrato_Conta_Corrente-250920262155.xls', 'fatura-aberta-final_5850-outubro2026.xlsx', 'Nubank_2026-10-27.csv']) {
      const again = await importFile(env, n, read(n));
      expect(again.result.imported + again.result.payments).toBe(0);
    }
    expect(await count(env)).toBe(total);
  });
});
