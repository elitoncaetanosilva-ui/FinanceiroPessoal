import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { categorize, learnRules, isPagamentoFaturaNaConta } from '@/lib/categorize';
import { calcFluxo, parceladasEmAberto, projetar } from '@/lib/finance';
import { exportPlanilha, parsePlanilha } from '@/lib/planilha';
import { mesmoMovimento, reconciliar } from '@/lib/reconcile';
import { addMonths, descKey, parseParcela, toNum } from '@/lib/util';
import { DEFAULT_CATEGORIAS } from '@/lib/taxonomy';
import type { Lancamento } from '@/lib/types';
import { lanc, novo, planilhaSintetica } from './fixtures';

describe('util', () => {
  it('datas e números', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10');
    expect(toNum('R$ 1.234,56')).toBe(1234.56);
    expect(toNum('(10,00)')).toBe(-10);
    expect(parseParcela('05/09')).toEqual({ k: 5, n: 9 });
    expect(parseParcela('2 de 3')).toEqual({ k: 2, n: 3 });
    expect(descKey('SAMS CAXIAS DO SUL 404 02/05')).toBe('SAMS CAXIAS DO SUL');
  });
});

describe('categorização', () => {
  const regras = learnRules([
    { descricao: 'Andreazza', natureza: 'despesa', subgrupo: 'Mercado / Limpeza' },
    { descricao: 'ANDREAZZA 12', natureza: 'despesa', subgrupo: 'Mercado / Limpeza' },
    { descricao: 'Almoço', natureza: 'despesa', subgrupo: 'Lanches / Delivery' },
    { descricao: 'Almoço', natureza: 'despesa', subgrupo: 'Mercado / Limpeza' },
  ]);
  it('aprende só quando um subgrupo domina', () => {
    expect(regras.find(r => r.padrao === 'ANDREAZZA')?.subgrupo).toBe('Mercado / Limpeza');
    expect(regras.find(r => r.padrao === 'ALMOCO')).toBeUndefined();
  });
  it('prioriza regra do usuário, depois aprendida, dicionário e Pluggy', () => {
    const r = [...regras, { padrao: 'PANVEL', tipo: 'contem' as const, natureza: 'despesa' as const, subgrupo: 'Presentes / Doações', origem: 'usuario' as const }];
    expect(categorize({ descricao: 'PANVEL FILIAL 3', origem: 'cartao', direcao: 'saida' }, r).subgrupo).toBe('Presentes / Doações');
    expect(categorize({ descricao: 'Andreazza 99', origem: 'cartao', direcao: 'saida' }, r).motivo).toBe('regra');
    expect(categorize({ descricao: 'DROGA RAIA', origem: 'cartao', direcao: 'saida' }, []).subgrupo).toBe('Medicamentos');
    expect(categorize({ descricao: 'LOJA XYZ', origem: 'cartao', direcao: 'saida', pluggyCategory: 'Pharmacy' }, [])).toMatchObject({ subgrupo: 'Medicamentos', motivo: 'pluggy' });
    expect(categorize({ descricao: 'LOJA XYZ', origem: 'cartao', direcao: 'saida' }, [])).toMatchObject({ subgrupo: 'Despesa não identificada', revisar: true });
  });
  it('entradas: receita ou despesa negativa (resgate)', () => {
    expect(categorize({ descricao: 'PAGTO SALARIO EMPRESA', origem: 'cash', direcao: 'entrada' }, [])).toMatchObject({ natureza: 'receita', subgrupo: 'Salário' });
    expect(categorize({ descricao: 'RESGATE POUPANCA', origem: 'cash', direcao: 'entrada' }, [])).toMatchObject({ natureza: 'despesa', subgrupo: 'Resgate' });
    expect(categorize({ descricao: 'PIX RECEBIDO FULANO', origem: 'cash', direcao: 'entrada' }, [])).toMatchObject({ natureza: 'receita', subgrupo: 'Outros', revisar: true });
  });
  it('detecta pagamento de fatura no extrato', () => {
    expect(isPagamentoFaturaNaConta('ITAU MC BLA 1234 FATURA')).toBe(true);
    expect(isPagamentoFaturaNaConta('NU PAGAMENTOS SA')).toBe(true);
    expect(isPagamentoFaturaNaConta('PIX MERCADO')).toBe(false);
  });
});

describe('conciliação', () => {
  it('conta: mesmo valor e data ±3 dias ou dia 1º da planilha no mesmo mês', () => {
    expect(mesmoMovimento(lanc({ data: '2026-01-10', valor: 50 }), lanc({ data: '2026-01-12', valor: 50 }))).toBe(true);
    expect(mesmoMovimento(lanc({ data: '2026-01-20', valor: 50 }), lanc({ data: '2026-01-01', valor: 50 }))).toBe(true);
    expect(mesmoMovimento(lanc({ data: '2026-01-20', valor: 50 }), lanc({ data: '2026-01-10', valor: 50 }))).toBe(false);
  });
  it('cartão: cartão + valor + parcela + mês de vencimento', () => {
    const a = lanc({ origem: 'cartao', conta: 'Nubank', vencimento: '2026-03-22', parcela: 2, parcelas: 3, valor: 30 });
    expect(mesmoMovimento(a, lanc({ ...a, vencimento: '2026-03-10', data: '2026-01-01' }))).toBe(true);
    expect(mesmoMovimento(a, lanc({ ...a, parcela: 3 }))).toBe(false);
    expect(mesmoMovimento(a, lanc({ ...a, conta: 'Itaú Black' }))).toBe(false);
  });
  it('pluggy: atualiza por external_id, vincula à planilha e insere o resto', () => {
    const existentes = [
      lanc({ id: 1, external_id: 'pt:1', fonte: 'pluggy', valor: 10 }),
      lanc({ id: 2, data: '2026-01-05', valor: 80, fonte: 'planilha' }),
    ];
    const r = reconciliar([
      novo({ external_id: 'pt:1', valor: 10, fonte: 'pluggy' }),
      novo({ external_id: 'pt:2', data: '2026-01-06', valor: 80, fonte: 'pluggy' }),
      novo({ external_id: 'pt:3', data: '2026-01-06', valor: 80, fonte: 'pluggy' }),
    ], existentes, { modo: 'pluggy' });
    expect(r.atualizar.map(x => x.id)).toEqual([1]);
    expect(r.vincular.map(x => x.id)).toEqual([2]);
    expect(r.novos.map(x => x.external_id)).toEqual(['pt:3']);
  });
});

describe('planilha', () => {
  const imp = parsePlanilha(planilhaSintetica());
  it('lê CASH, CARTÃO, Apoio e CAIXA MENSAL', () => {
    expect(imp.stats).toEqual({ cash: 3, cartao: 4, receitas: 3, orcamentos: 7 });
    expect(imp.saldoInicial).toEqual({ mes: '2026-01', valor: 1000 });
    expect(imp.cartoes).toEqual(['Itaú Black', 'Nubank']);
    expect(imp.categorias.some(c => c.subgrupo === 'Hotelzinho' && c.grupo === 'Pet')).toBe(true);
    const ult = imp.lancamentos.find(l => l.descricao === 'Geladeira' && l.vencimento === '2026-04-10');
    expect(ult).toMatchObject({ parcela: 3, parcelas: 3 }); // parcela convertida em data pelo Sheets
  });
  it('fluxo: caixa pelo vencimento, saldo encadeado', () => {
    const ls = imp.lancamentos.map((l, i) => ({ ...l, id: i + 1 })) as Lancamento[];
    const f = calcFluxo(ls, imp.categorias, imp.orcamentos, imp.saldoInicial, ['2026-01', '2026-02']);
    // jan: entradas 7000; saídas 800 − 300 (resgate) + 450,50 = 950,50
    expect(f.resumo[0]).toMatchObject({ entradas: 7000, saidas: 950.5, geracao: 6049.5, saldoInicial: 1000, saldoFinal: 7049.5 });
    expect(f.resumo[1]).toMatchObject({ entradas: 5100, saidas: 1100, saldoInicial: 7049.5, saldoFinal: 11049.5, saidasPrev: 1800 });
  });
  it('exporta no layout da planilha e reimporta igual', () => {
    const ls = imp.lancamentos.map((l, i) => ({ ...l, id: i + 1 })) as Lancamento[];
    const buf = exportPlanilha({ lancamentos: ls, categorias: DEFAULT_CATEGORIAS, cartoes: imp.cartoes });
    const wb = XLSX.read(buf);
    expect(wb.SheetNames).toEqual(['CASH', 'CARTÃO', 'ENTRADAS', 'Apoio']);
    expect(XLSX.read(buf, { cellFormula: true }).Sheets['CASH'].A2.f).toBe('DATE(YEAR(C2),MONTH(C2),1)');
    const re = parsePlanilha(buf);
    expect(re.stats.cash).toBe(3);
    expect(re.stats.cartao).toBe(4);
  });
});

describe('cartões e projeção', () => {
  const ls = [
    lanc({ origem: 'cartao', conta: 'Nubank', descricao: 'TV 01/03', data: '2026-01-15', vencimento: '2026-02-10', parcela: 1, parcelas: 3, valor: 300 }),
    lanc({ origem: 'cartao', conta: 'Nubank', descricao: 'TV 02/03', data: '2026-02-15', vencimento: '2026-03-10', parcela: 2, parcelas: 3, valor: 300 }),
    lanc({ origem: 'cartao', conta: 'Nubank', descricao: 'TV 03/03', data: '2026-03-15', vencimento: '2026-04-10', parcela: 3, parcelas: 3, valor: 300 }),
  ];
  it('agrupa parcelas da mesma compra mesmo com descrição "NN/MM" e datas diferentes', () => {
    const a = parceladasEmAberto(ls, '2026-02');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ descricao: 'TV', restante: 600, pagas: 1, ultimaParcela: '2026-04' });
  });
  it('projeção soma parcelas contratadas e médias', () => {
    const hist = [
      ...['2026-01', '2026-02', '2026-03'].flatMap(m => [
        lanc({ natureza: 'receita', subgrupo: 'Salário', data: `${m}-05`, vencimento: `${m}-05`, valor: 5000 }),
        lanc({ data: `${m}-10`, vencimento: `${m}-10`, valor: 3000 }),
      ]),
      lanc({ origem: 'cartao', conta: 'Nubank', vencimento: '2026-05-10', parcela: 2, parcelas: 2, valor: 400 }),
    ];
    const p = projetar(hist, [], '2026-04', 1000, 2);
    expect(p[0]).toMatchObject({ mes: '2026-05', entradas: 5000, saidasConta: 3000, parcelasCartao: 400, saldoFinal: 2600 });
    expect(p[1].saldoFinal).toBe(4600);
  });
});
