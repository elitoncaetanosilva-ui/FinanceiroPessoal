import { beforeAll, describe, expect, it } from 'vitest';
import { parsePlanilha } from '@/lib/planilha';
import { atualizarCategoria, getLancamentos, getRegras, importarPlanilha, getSaldoInicial } from '@/lib/repo';
import { persistirEntrantes } from '@/lib/sync';
import { mapTransactions, type ContaCtx } from '@/lib/pluggy-map';
import { planilhaSintetica } from './fixtures';

process.env.PGLITE_DIR = 'memory';

const nubank: ContaCtx = {
  account: { id: 'nu-card', type: 'CREDIT', name: 'Nubank', balance: 0, creditData: { balanceCloseDate: '2026-03-03', balanceDueDate: '2026-03-10' } },
  apelido: 'Nubank',
};
const conta: ContaCtx = { account: { id: 'itau', type: 'BANK', name: 'Conta', balance: 0 }, apelido: 'Itaú conta' };
const desde = '2026-02-01';

const txsBanco = [
  // Mesma linha da planilha (Aluguel 05/02, R$ 800) → deve conciliar, não duplicar
  { id: 'b1', accountId: 'itau', date: '2026-02-06', description: 'TOMASI IMOVEIS', type: 'DEBIT', amount: -800, status: 'POSTED' },
  { id: 'b2', accountId: 'itau', date: '2026-02-07', description: 'LOJA NOVA', type: 'DEBIT', amount: -55.9, status: 'POSTED' },
];
// 2ª parcela da geladeira (já na planilha com vencimento em mar/26) + nova compra parcelada
const txsCartao = [
  { id: 'c1', accountId: 'nu-card', date: '2026-02-15', description: 'Geladeira 02/03', type: 'DEBIT', amount: 300, status: 'POSTED',
    creditCardMetadata: { installmentNumber: 2, totalInstallments: 3, purchaseDate: '2026-01-15' } },
  { id: 'c2', accountId: 'nu-card', date: '2026-02-20', description: 'NETSHOES 01/02', type: 'DEBIT', amount: 120, status: 'POSTED',
    creditCardMetadata: { installmentNumber: 1, totalInstallments: 2, purchaseDate: '2026-02-20' } },
];

async function sync() {
  const regras = await getRegras();
  const ent = [
    ...mapTransactions(txsBanco, conta, { regras, desde }).lancamentos,
    ...mapTransactions(txsCartao, nubank, { regras, desde }).lancamentos,
  ];
  return persistirEntrantes(ent, desde);
}

describe('banco de dados (PGlite)', () => {
  beforeAll(async () => {
    await importarPlanilha(parsePlanilha(planilhaSintetica()));
  });

  it('importa a planilha', async () => {
    const ls = await getLancamentos();
    expect(ls).toHaveLength(10);
    expect(await getSaldoInicial()).toEqual({ mes: '2026-01', valor: 1000 });
  });

  it('1ª sincronização concilia com a planilha e projeta parcelas', async () => {
    const r = await sync();
    // b1 casa com o aluguel; c1 casa com a geladeira 2/3 e sua projeção 3/3 com a 3/3 da planilha
    expect(r).toEqual({ novos: 2, atualizados: 0, conciliados: 3, projetados: 1 });
    const ls = await getLancamentos();
    expect(ls.filter(l => l.descricao === 'Aluguel' && l.data.startsWith('2026-02'))).toHaveLength(1);
    expect(ls.find(l => l.descricao === 'Aluguel' && l.data.startsWith('2026-02'))?.fonte).toBe('pluggy');
    expect(ls.filter(l => l.descricao.startsWith('Geladeira'))).toHaveLength(3);
    const net = ls.filter(l => l.descricao === 'NETSHOES');
    expect(net.map(l => [l.parcela, l.vencimento, l.fonte])).toEqual([[1, '2026-03-10', 'pluggy'], [2, '2026-04-10', 'projecao']]);
    expect(net[0].subgrupo).toBe('Roupas');
  });

  it('2ª sincronização é idempotente', async () => {
    const antes = (await getLancamentos()).length;
    const r = await sync();
    expect(r.novos + r.projetados + r.conciliados).toBe(0);
    expect((await getLancamentos()).length).toBe(antes);
  });

  it('recategorizar com "lembrar" cria regra e vale na próxima sincronização', async () => {
    const loja = (await getLancamentos()).find(l => l.descricao === 'LOJA NOVA')!;
    expect(loja.revisar).toBe(true);
    await atualizarCategoria(loja.id, 'despesa', 'Presentes / Doações', true);
    expect((await getRegras()).some(r => r.padrao === 'LOJA NOVA' && r.origem === 'usuario')).toBe(true);
    await sync();
    const depois = (await getLancamentos()).find(l => l.descricao === 'LOJA NOVA')!;
    expect(depois).toMatchObject({ subgrupo: 'Presentes / Doações', revisar: false });
  });

  it('reimportar a planilha não duplica o que veio do banco', async () => {
    await importarPlanilha(parsePlanilha(planilhaSintetica()));
    const ls = await getLancamentos();
    expect(ls.filter(l => l.valor === 800 && l.data.startsWith('2026-02'))).toHaveLength(1);
    expect(ls.filter(l => l.descricao.startsWith('Geladeira') && l.parcela === 2)).toHaveLength(1);
    expect(ls).toHaveLength(13); // 10 da planilha + LOJA NOVA + NETSHOES 1/2 e 2/2
  });
});
