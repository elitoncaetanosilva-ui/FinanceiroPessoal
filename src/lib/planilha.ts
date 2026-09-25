import * as XLSX from 'xlsx';
import { DEFAULT_CATEGORIAS, catKey } from './taxonomy';
import type { Categoria, Lancamento, NovoLancamento, Natureza, Orcamento } from './types';
import { isoFromParts, monthStart, norm, pad2, parseParcela, r2, toISODate, toNum, ym } from './util';

// ---------- leitura ----------

type Row = unknown[];

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function serialToISO(n: number) {
  const d = new Date(EXCEL_EPOCH + Math.floor(n) * 86400000);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function cellISO(v: unknown): string | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToISO(v) : null;
  return toISODate(v);
}
/** Coluna "Parcela": texto "05/09", mas o Sheets às vezes a converte em data (5 de setembro). */
function cellParcela(v: unknown) {
  if (typeof v === 'number' && v > 20000) {
    const iso = serialToISO(v);
    return { k: +iso.slice(8, 10), n: +iso.slice(5, 7) };
  }
  return parseParcela(v);
}
const str = (v: unknown) => (v == null ? '' : String(v).trim());

function findSheet(wb: XLSX.WorkBook, ...names: string[]) {
  for (const n of names) {
    const hit = wb.SheetNames.find(s => norm(s) === norm(n));
    if (hit) return wb.Sheets[hit];
  }
  return null;
}
const rowsOf = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });

function headerIndex(header: Row, ...names: string[]) {
  const h = header.map(x => norm(x));
  for (const n of names) {
    const i = h.findIndex(x => x === norm(n));
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex(x => x.startsWith(norm(n)));
    if (i >= 0) return i;
  }
  return -1;
}

export interface PlanilhaImport {
  categorias: Categoria[];
  lancamentos: NovoLancamento[];
  orcamentos: Orcamento[];
  saldoInicial: { mes: string; valor: number } | null;
  cartoes: string[];
  avisos: string[];
  stats: { cash: number; cartao: number; receitas: number; orcamentos: number };
}

const base = (x: Partial<NovoLancamento>): NovoLancamento => ({
  origem: 'cash', natureza: 'despesa', conta: null, data: '', vencimento: '', descricao: '', parcela: null, parcelas: null,
  subgrupo: '', valor: 0, fonte: 'planilha', external_id: null, revisar: false, ignorado: false, nota: null, ...x,
});

export function parsePlanilha(buf: ArrayBuffer | Buffer): PlanilhaImport {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer' });
  const avisos: string[] = [];
  const out: PlanilhaImport = { categorias: [], lancamentos: [], orcamentos: [], saldoInicial: null, cartoes: [], avisos, stats: { cash: 0, cartao: 0, receitas: 0, orcamentos: 0 } };

  // Apoio → categorias de despesa + cartões
  const cats = new Map<string, Categoria>(DEFAULT_CATEGORIAS.map(c => [catKey(c.natureza, c.subgrupo), c]));
  const apoio = findSheet(wb, 'Apoio');
  if (apoio) {
    let ordem = 500;
    for (const r of rowsOf(apoio).slice(1)) {
      const grupo = str(r[0]), sub = str(r[1]), cartao = str(r[3]);
      if (sub && !cats.has(catKey('despesa', sub))) cats.set(catKey('despesa', sub), { natureza: 'despesa', grupo: grupo || 'Outros', subgrupo: sub, ordem: ordem++ });
      if (cartao && !/^cart/i.test(cartao)) out.cartoes.push(cartao);
    }
  }

  // CASH
  const cash = findSheet(wb, 'CASH');
  if (cash) {
    const rows = rowsOf(cash);
    const h = rows[0] ?? [];
    const cD = headerIndex(h, 'DATA COMPRA', 'DATA'), cV = headerIndex(h, 'VENCIMENTO'), cDesc = headerIndex(h, 'DESCRIÇÃO'), cSub = headerIndex(h, 'SUBGRUPO'), cVal = headerIndex(h, 'VALOR');
    for (const r of rows.slice(1)) {
      const valor = toNum(r[cVal]);
      const data = cellISO(r[cD]) ?? cellISO(r[cV]);
      if (valor == null || !data) continue;
      const sub = str(r[cSub]);
      out.lancamentos.push(base({
        origem: 'cash', natureza: 'despesa', data, vencimento: cellISO(r[cV]) ?? data,
        descricao: str(r[cDesc]) || sub || 'Sem descrição', subgrupo: sub || 'Despesa não identificada', valor: r2(valor), revisar: !sub,
      }));
      out.stats.cash++;
    }
  } else avisos.push('Aba CASH não encontrada.');

  // CARTÃO
  const cartao = findSheet(wb, 'CARTÃO', 'CARTAO');
  if (cartao) {
    const rows = rowsOf(cartao);
    const h = rows[0] ?? [];
    const cD = headerIndex(h, 'DATA COMPRA'), cV = headerIndex(h, 'VENCIMENTO'), cDesc = headerIndex(h, 'DESCRIÇÃO'), cP = headerIndex(h, 'Parcela'),
      cC = headerIndex(h, 'CARTÃO', 'CARTAO'), cSub = headerIndex(h, 'SUBGRUPO'), cVal = headerIndex(h, 'VALOR');
    for (const r of rows.slice(1)) {
      const valor = toNum(r[cVal]);
      const venc = cellISO(r[cV]);
      if (valor == null || !venc) continue;
      const p = cellParcela(r[cP]);
      const sub = str(r[cSub]);
      out.lancamentos.push(base({
        origem: 'cartao', natureza: 'despesa', conta: str(r[cC]) || null, data: cellISO(r[cD]) ?? venc, vencimento: venc,
        descricao: str(r[cDesc]) || 'Sem descrição', parcela: p.k, parcelas: p.n, subgrupo: sub || 'Despesa não identificada', valor: r2(valor), revisar: !sub,
      }));
      out.stats.cartao++;
    }
  } else avisos.push('Aba CARTÃO não encontrada.');

  // CAIXA MENSAL → entradas realizadas (lançamentos de receita), previsto (orçamento) e saldo inicial
  const cm = findSheet(wb, 'CAIXA MENSAL');
  if (cm) {
    const rows = rowsOf(cm);
    const months: { col: number; mes: string }[] = [];
    (rows[0] ?? []).forEach((v, col) => {
      const iso = typeof v === 'number' && v > 20000 ? serialToISO(v) : toISODate(v);
      if (iso) months.push({ col, mes: ym(iso) });
    });
    let secao: Natureza | null = null, grupo = '', ordem = 900;
    for (const r of rows.slice(2)) {
      const a = norm(r[0]), b = str(r[1]);
      if (a.startsWith('TOTAL DE ENTRADAS')) { secao = 'receita'; continue; }
      if (a.startsWith('TOTAL DE SAIDAS')) { secao = 'despesa'; continue; }
      if (a.startsWith('GERACAO DE CAIXA')) { secao = null; continue; }
      if (a.startsWith('SALDO INICIAL') && months.length) {
        const first = months[0];
        const v = toNum(r[first.col + 1]) ?? toNum(r[first.col]);
        if (v != null) out.saldoInicial = { mes: first.mes, valor: r2(v) };
        continue;
      }
      if (!secao) continue;
      if (a) { grupo = str(r[0]); continue; }
      if (!b) continue;
      if (!cats.has(catKey(secao, b))) cats.set(catKey(secao, b), { natureza: secao, grupo, subgrupo: b, ordem: ordem++ });
      for (const { col, mes } of months) {
        const prev = toNum(r[col]);
        if (prev != null && prev !== 0) { out.orcamentos.push({ mes, natureza: secao, subgrupo: b, valor: r2(prev) }); out.stats.orcamentos++; }
        if (secao === 'receita') {
          const real = toNum(r[col + 1]);
          if (real != null && real !== 0) {
            out.lancamentos.push(base({ origem: 'cash', natureza: 'receita', data: mes + '-01', vencimento: mes + '-01', descricao: `${b} (CAIXA MENSAL)`, subgrupo: b, valor: r2(real) }));
            out.stats.receitas++;
          }
        }
      }
    }
  } else avisos.push('Aba CAIXA MENSAL não encontrada: entradas e previsto não foram importados.');

  out.categorias = [...cats.values()].sort((x, y) => x.ordem - y.ordem);
  if (!out.cartoes.length) out.cartoes = [...new Set(out.lancamentos.filter(l => l.origem === 'cartao' && l.conta).map(l => l.conta!))];
  return out;
}

// ---------- exportação no layout CAIXA 2026 ----------

const dCell = (iso: string) => ({ t: 'n' as const, v: (Date.parse(iso + 'T00:00:00Z') - EXCEL_EPOCH) / 86400000, z: 'dd/mm/yyyy' });
// Fórmula + valor em cache (sem o valor o SheetJS descarta a célula).
const monthF = (c: string, iso: string) => ({ t: 'n' as const, f: `DATE(YEAR(${c}),MONTH(${c}),1)`, v: dCell(monthStart(iso)).v, z: 'mm/yyyy' });

export interface ExportInput {
  lancamentos: Lancamento[];
  categorias: Categoria[];
  cartoes: string[];
  fluxo?: { meses: string[]; linhas: { rotulo: string; nivel: 0 | 1; valores: number[] }[] };
}

export function exportPlanilha(inp: ExportInput): Buffer {
  const wb = XLSX.utils.book_new();
  const ativos = inp.lancamentos.filter(l => !l.ignorado);

  const cash: unknown[][] = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR']];
  ativos.filter(l => l.origem === 'cash' && l.natureza === 'despesa').sort((a, b) => a.vencimento.localeCompare(b.vencimento))
    .forEach((l, i) => { const n = i + 2; cash.push([monthF('C' + n, l.data), monthF('D' + n, l.vencimento), dCell(l.data), dCell(l.vencimento), l.descricao, l.subgrupo, l.valor]); });

  const car: unknown[][] = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'Parcela', 'CARTÃO', 'SUBGRUPO', 'VALOR']];
  ativos.filter(l => l.origem === 'cartao').sort((a, b) => a.vencimento.localeCompare(b.vencimento))
    .forEach((l, i) => { const n = i + 2; car.push([monthF('C' + n, l.data), monthF('D' + n, l.vencimento), dCell(l.data), dCell(l.vencimento), l.descricao, `${pad2(l.parcela ?? 1)}/${pad2(l.parcelas ?? 1)}`, l.conta ?? '', l.subgrupo, l.valor]); });

  const rec: unknown[][] = [['MÊS', 'DATA', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR']];
  ativos.filter(l => l.natureza === 'receita').sort((a, b) => a.data.localeCompare(b.data))
    .forEach(l => rec.push([dCell(monthStart(l.data)), dCell(l.data), l.descricao, l.subgrupo, l.valor]));

  const apoio: unknown[][] = [['Categoria', 'Subgrupo', null, 'CARTÃO']];
  const desp = inp.categorias.filter(c => c.natureza === 'despesa');
  const rowsN = Math.max(desp.length, inp.cartoes.length);
  for (let i = 0; i < rowsN; i++) apoio.push([desp[i]?.grupo ?? null, desp[i]?.subgrupo ?? null, null, inp.cartoes[i] ?? null]);

  const sheet = (aoa: unknown[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    return ws;
  };
  if (inp.fluxo) {
    const aoa: unknown[][] = [['', ...inp.fluxo.meses]];
    for (const l of inp.fluxo.linhas) aoa.push([(l.nivel ? '    ' : '') + l.rotulo, ...l.valores.map(v => r2(v))]);
    XLSX.utils.book_append_sheet(wb, sheet(aoa, [34, ...inp.fluxo.meses.map(() => 12)]), 'CAIXA MENSAL');
  }
  XLSX.utils.book_append_sheet(wb, sheet(cash, [11, 11, 12, 12, 40, 28, 12]), 'CASH');
  XLSX.utils.book_append_sheet(wb, sheet(car, [11, 11, 12, 12, 40, 8, 12, 28, 12]), 'CARTÃO');
  XLSX.utils.book_append_sheet(wb, sheet(rec, [11, 12, 40, 20, 12]), 'ENTRADAS');
  XLSX.utils.book_append_sheet(wb, sheet(apoio, [20, 30, 4, 14]), 'Apoio');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
