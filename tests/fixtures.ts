/** Geradores de arquivos SINTÉTICOS no layout real dos bancos (dados fictícios). */
import * as XLSX from '@e965/xlsx';

type Mov = [string, string, number];   // [dd/mm/aaaa, descrição, valor]

/** Extrato Itaú (.xls BIFF8) com SALDO ANTERIOR e SALDO TOTAL DISPONÍVEL DIA após cada dia. */
export function itauExtrato(movs: Mov[], saldoAnterior: number, opts: { agencia?: string; conta?: string; dataAnterior?: string } = {}) {
  const rows: unknown[][] = [
    ['Logotipo Itaú'], ['Atualização:', '25/09/2026 às 21:54:57'], ['Nome:', 'TITULAR TESTE'],
    ['Agência:', Number(opts.agencia ?? '1234')], ['Conta:', opts.conta ?? '01234-5'], [], ['Lançamentos'], [],
    ['data', 'lançamento', 'ag./origem', 'valor (R$)', 'saldos (R$)'], ['lançamentos', '', '', '', ''],
    [opts.dataAnterior ?? '31/08/2026', 'SALDO ANTERIOR', '', '', saldoAnterior],
  ];
  let saldo = saldoAnterior;
  const days = [...new Set(movs.map(m => m[0]))];
  for (const d of days) {
    const dayMovs = movs.filter(m => m[0] === d);
    saldo = Math.round((saldo + dayMovs.reduce((s, m) => s + m[2], 0)) * 100) / 100;
    rows.push([d, 'SALDO TOTAL DISPONÍVEL DIA', '', '', saldo]);
    for (const m of dayMovs) rows.push([m[0], m[1], '', m[2], '']);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Lançamentos');
  return { bytes: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'biff8' })), finalBalance: saldo };
}

type Compra = [string, string, string | null, number, string?];   // [aaaa-mm-dd, descrição, parcelamento, valor, final]

/** Fatura Itaú (.xlsx) no layout "fatura aberta". */
export function itauFatura(compras: Compra[], vencimento: string, opts: { final?: string; total?: number } = {}) {
  const final = opts.final ?? '1111';
  const total = opts.total ?? compras.filter(c => c[3] > 0).reduce((s, c) => s + c[3], 0);
  const rows: unknown[][] = [
    [' '], [], [null, 'Nome', 'Titular Teste'], [null, 'Agência', '1234'], [null, 'Conta', '01234-5'], [], [],
    [null, 'Fatura Aberta - Outubro/2026'],
    [null, 'Cartão', null, null, null, null, 'Valor (parcial)', null, 'Vencimento'],
    [null, `Itau Uniclass Black Mastercard - final ${final}`, null, null, null, null, Math.round(total * 100) / 100, null, new Date(vencimento + 'T00:00:00Z')],
    [], [], [null, 'Lançamentos'],
    [null, 'Data', 'Lançamento', 'Parcelamento', 'Valor', null, 'Titularidade', 'Nome', 'Tipo do cartão', 'Número do cartão'],
  ];
  for (const c of compras) rows.push([null, new Date(c[0] + 'T00:00:00Z'), c[1], c[2], c[3], null, 'Titular', 'Titular Teste', 'Físico', `****${c[4] ?? final}`]);
  rows.push([], [null, null, null, 'Subtotal  ']);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Fatura 10-26');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/** Fatura Nubank (.csv). */
export function nubankCsv(lines: [string, string, string][]) {
  return Buffer.from(['date,title,amount', ...lines.map(l => `${l[0]},${l[1]},"${l[2]}"`)].join('\n') + '\n', 'utf8');
}
