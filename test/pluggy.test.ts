import { describe, expect, it } from 'vitest';
import { apelidoPadrao, mapTransactions, vencimentoPorData, type ContaCtx } from '@/lib/pluggy-map';

const cartao: ContaCtx = {
  account: { id: 'acc-card', type: 'CREDIT', name: 'Mastercard Black', balance: 0, creditData: { balanceCloseDate: '2026-09-03', balanceDueDate: '2026-09-10' } },
  apelido: 'Itaú Black',
  bills: [{ id: 'b-set', dueDate: '2026-09-10', billClosingDate: '2026-09-03', totalAmount: 1000 }],
};
const conta: ContaCtx = { account: { id: 'acc-bank', type: 'BANK', name: 'Conta corrente', balance: 500 }, apelido: 'Itaú conta' };
const ctx = { regras: [], desde: '2026-08-01' };

describe('Pluggy → lançamentos', () => {
  it('vencimento: fatura conhecida ou regra de fechamento', () => {
    expect(vencimentoPorData('2026-09-02', cartao)).toBe('2026-09-10');
    expect(vencimentoPorData('2026-09-05', cartao)).toBe('2026-10-10'); // depois do fechamento
    expect(vencimentoPorData('2026-12-20', cartao)).toBe('2027-01-10');
  });

  it('cartão: parcela real + projeção das seguintes; pagamento de fatura ignorado; estorno negativo', () => {
    const r = mapTransactions([
      { id: 't1', accountId: 'acc-card', date: '2026-08-20', description: 'MAGAZINE LUIZA 02/05', type: 'DEBIT', amount: 200, status: 'POSTED',
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 5, totalAmount: 1000, purchaseDate: '2026-07-20', billId: 'b-set' } },
      { id: 't2', accountId: 'acc-card', date: '2026-08-25', description: 'PAGAMENTO EFETUADO', type: 'CREDIT', amount: -900, status: 'POSTED' },
      { id: 't3', accountId: 'acc-card', date: '2026-08-26', description: 'ESTORNO LOJA', type: 'CREDIT', amount: -50, status: 'POSTED' },
      { id: 't4', accountId: 'acc-card', date: '2026-08-27', description: 'IFOOD', type: 'DEBIT', amount: 40, status: 'PENDING' },
    ], cartao, ctx);
    expect(r.ignorados).toBe(1);
    const parcelas = r.lancamentos.filter(l => l.descricao === 'MAGAZINE LUIZA');
    expect(parcelas.map(p => [p.parcela, p.vencimento, p.fonte])).toEqual([
      [2, '2026-09-10', 'pluggy'], [3, '2026-10-10', 'projecao'], [4, '2026-11-10', 'projecao'], [5, '2026-12-10', 'projecao'],
    ]);
    expect(parcelas[0]).toMatchObject({ subgrupo: 'Móveis / Eletro / Eletrônicos', data: '2026-07-20', conta: 'Itaú Black' });
    expect(r.lancamentos.find(l => l.descricao === 'ESTORNO LOJA')?.valor).toBe(-50);
    expect(r.lancamentos.some(l => l.descricao === 'IFOOD')).toBe(false); // pendente fica de fora
  });

  it('parcela real e projeção têm a mesma chave (a real substitui a projeção)', () => {
    const base = { accountId: 'acc-card', description: 'LOJA 01/03', type: 'DEBIT', amount: 100, status: 'POSTED' };
    const m1 = mapTransactions([{ ...base, id: 'a', date: '2026-08-20', creditCardMetadata: { installmentNumber: 1, totalInstallments: 3, purchaseDate: '2026-08-20' } }], cartao, ctx);
    const m2 = mapTransactions([{ ...base, id: 'b', description: 'LOJA 02/03', date: '2026-09-20', creditCardMetadata: { installmentNumber: 2, totalInstallments: 3, purchaseDate: '2026-08-20' } }], cartao, ctx);
    const proj2 = m1.lancamentos.find(l => l.parcela === 2)!;
    const real2 = m2.lancamentos.find(l => l.parcela === 2)!;
    expect(proj2.fonte).toBe('projecao');
    expect(real2.fonte).toBe('pluggy');
    expect(real2.external_id).toBe(proj2.external_id);
  });

  it('conta: despesa, receita, resgate e pagamento de fatura', () => {
    const r = mapTransactions([
      { id: 'c1', accountId: 'acc-bank', date: '2026-08-05', description: 'PAGTO SALARIO ACME', type: 'CREDIT', amount: 5000, status: 'POSTED' },
      { id: 'c2', accountId: 'acc-bank', date: '2026-08-06', description: 'PIX QRS RGE SUL', type: 'DEBIT', amount: -180.5, status: 'POSTED' },
      { id: 'c3', accountId: 'acc-bank', date: '2026-08-10', description: 'ITAU MC BLA 1234 FATURA', type: 'DEBIT', amount: -900, status: 'POSTED' },
      { id: 'c4', accountId: 'acc-bank', date: '2026-08-11', description: 'RESGATE CDB', type: 'CREDIT', amount: 300, status: 'POSTED' },
      { id: 'c5', accountId: 'acc-bank', date: '2026-07-11', description: 'ANTIGO', type: 'DEBIT', amount: -1, status: 'POSTED' },
    ], conta, ctx);
    const by = (id: string) => r.lancamentos.find(l => l.external_id === `pt:${id}`)!;
    expect(by('c1')).toMatchObject({ natureza: 'receita', subgrupo: 'Salário', valor: 5000 });
    expect(by('c2')).toMatchObject({ natureza: 'despesa', subgrupo: 'Energia elétrica', valor: 180.5 });
    expect(by('c3')).toMatchObject({ ignorado: true });
    expect(by('c4')).toMatchObject({ natureza: 'despesa', subgrupo: 'Resgate', valor: -300 });
    expect(r.lancamentos.some(l => l.external_id === 'pt:c5')).toBe(false); // antes da data de corte
  });

  it('nome amigável no padrão da planilha', () => {
    expect(apelidoPadrao('Itaú', { type: 'CREDIT', name: 'Visa', marketingName: null })).toBe('Itaú Black');
    expect(apelidoPadrao('MeuPluggy', { type: 'CREDIT', name: 'Nubank Ultravioleta', marketingName: null })).toBe('Nubank');
    expect(apelidoPadrao('Nubank', { type: 'BANK', name: 'Conta', marketingName: null })).toBe('Nubank conta');
  });
});
