import * as XLSX from 'xlsx';
import type { Lancamento, NovoLancamento } from '@/lib/types';

let seq = 1;
export function lanc(p: Partial<Lancamento>): Lancamento {
  return {
    id: seq++, origem: 'cash', natureza: 'despesa', conta: null, data: '2026-01-10', vencimento: p.data ?? '2026-01-10', descricao: 'X',
    parcela: null, parcelas: null, subgrupo: 'Mercado / Limpeza', valor: 100, fonte: 'planilha', external_id: null, revisar: false, ignorado: false, nota: null, ...p,
  };
}
export const novo = (p: Partial<NovoLancamento>): NovoLancamento => { const { id: _id, ...r } = lanc(p); return r; };

const serial = (iso: string) => (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;

/** Planilha SINTÉTICA no layout real do CAIXA 2026 (dados fictícios). */
export function planilhaSintetica(): Buffer {
  const wb = XLSX.utils.book_new();
  const cm: unknown[][] = [
    [null, null, serial('2026-01-01'), null, serial('2026-02-01'), null],
    [null, null, 'PREVISTO', 'REALIZADO', 'PREVISTO', 'REALIZADO'],
    ['TOTAL DE ENTRADAS', null, 0, 0, 0, 0],
    ['CLT', null, 0, 0, 0, 0],
    [null, 'Salário', 5000, 5000, 5000, 5100],
    ['Extras', null, 0, 0, 0, 0],
    [null, 'V4 Company', 2000, 2000, null, null],
    ['TOTAL DE SAÍDAS', null, 0, 0, 0, 0],
    ['Moradia', null, 0, 0, 0, 0],
    [null, 'Aluguel', 800, null, 800, null],
    ['Alimentação', null, 0, 0, 0, 0],
    [null, 'Mercado / Limpeza', 1000, null, 1000, null],
    ['GERAÇÃO DE CAIXA', null],
    ['SALDO INICIAL', null, 1000, 1000],
    ['SALDO FINAL', null],
  ];
  const cash: unknown[][] = [
    ['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR'],
    [null, null, serial('2026-01-05'), serial('2026-01-05'), 'Aluguel', 'Aluguel', 800],
    [null, null, serial('2026-01-01'), serial('2026-01-01'), 'Resgate de poupança', 'Resgate', -300],
    [null, null, serial('2026-02-05'), serial('2026-02-05'), 'Aluguel', 'Aluguel', 800],
  ];
  const car: unknown[][] = [
    ['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'Parcela', 'CARTÃO', 'SUBGRUPO', 'VALOR'],
    [null, null, serial('2025-12-20'), serial('2026-01-10'), 'ZAFFARI CAXIAS', '01/01', 'Itaú Black', 'Mercado / Limpeza', 450.5],
    [null, null, serial('2026-01-15'), serial('2026-02-10'), 'Geladeira', '01/03', 'Nubank', 'Móveis / Eletro / Eletrônicos', 300],
    [null, null, serial('2026-01-15'), serial('2026-03-10'), 'Geladeira', '02/03', 'Nubank', 'Móveis / Eletro / Eletrônicos', 300],
    // Sheets convertendo "03/03" em data (3 de março)
    [null, null, serial('2026-01-15'), serial('2026-04-10'), 'Geladeira', serial('2026-03-03'), 'Nubank', 'Móveis / Eletro / Eletrônicos', 300],
  ];
  const apoio: unknown[][] = [['Categoria', 'Subgrupo', null, 'CARTÃO'], ['Moradia', 'Aluguel', null, 'Itaú Black'], ['Pet', 'Hotelzinho', null, 'Nubank']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cm), 'CAIXA MENSAL');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cash), 'CASH');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(car), 'CARTÃO');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(apoio), 'Apoio');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
