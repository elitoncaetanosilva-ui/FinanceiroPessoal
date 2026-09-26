/**
 * Extrato de conta corrente do Itaú (.xls/.xlsx exportado pelo internet banking).
 * Aba "Lançamentos": cabeçalho data | lançamento | ag./origem | valor (R$) | saldos (R$).
 * Linhas "SALDO ANTERIOR" e "SALDO TOTAL DISPONÍVEL DIA" trazem o saldo do banco (fim do dia) → conferência.
 */
import { parseDate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { norm } from '@/lib/text';
import type { CanonicalRow, Importer, ParsedFile } from '../types';
import { cellNorm, cellText, isXls, isZip, periodOf, readWorkbook, sheetRows, type Cell } from '../util';

function findSheet(wb: ReturnType<typeof readWorkbook>) {
  const name = wb.SheetNames.find(n => norm(n).startsWith('LANCAMENTOS') || norm(n).includes('LANCAMENTO'));
  return name ? wb.Sheets[name] : null;
}
function header(rows: Cell[][]) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map(cellNorm);
    const d = h.findIndex(x => x === 'DATA'), l = h.findIndex(x => x.startsWith('LANCAMENTO')), v = h.findIndex(x => x.startsWith('VALOR'));
    if (d >= 0 && l >= 0 && v >= 0) return { row: i, d, l, v, s: h.findIndex(x => x.startsWith('SALDO')) };
  }
  return null;
}

export const itauExtrato: Importer = {
  id: 'itau-extrato',
  label: 'Itaú — extrato de conta corrente (.xls)',
  detect(f) {
    if (!isXls(f.bytes) && !isZip(f.bytes)) return 0;
    try {
      const wb = readWorkbook(f.bytes);
      const ws = findSheet(wb);
      if (!ws) return 0;
      const rows = sheetRows(ws);
      if (!header(rows)) return 0.2;
      const top = rows.slice(0, 8).map(r => r.map(cellNorm).join(' ')).join(' ');
      return top.includes('AGENCIA') && top.includes('CONTA') ? 0.95 : 0.7;
    } catch { return 0; }
  },
  parse(f): ParsedFile {
    const wb = readWorkbook(f.bytes);
    const ws = findSheet(wb) ?? wb.Sheets[wb.SheetNames[0]];
    const rows = sheetRows(ws);
    const h = header(rows);
    if (!h) throw new Error('Cabeçalho data / lançamento / valor não encontrado.');
    let branch: string | null = null, number: string | null = null;
    for (const r of rows.slice(0, h.row)) {
      const k = cellNorm(r[0]);
      if (k.startsWith('AGENCIA')) branch = cellText(r[1]);
      if (k.startsWith('CONTA')) number = cellText(r[1]);
    }
    const out: CanonicalRow[] = [];
    const balances: ParsedFile['balances'] = [];
    let opening: ParsedFile['openingBalance'] = null;
    const warnings: string[] = [];
    rows.slice(h.row + 1).forEach((r, i) => {
      const desc = cellText(r[h.l]);
      const date = parseDate(r[h.d]);
      if (!date || !desc) return;
      const nd = norm(desc);
      if (nd.startsWith('SALDO ANTERIOR')) {
        const b = toCents(r[h.s >= 0 ? h.s : h.v]);
        if (b != null) opening = { date, balanceCents: b };
        return;
      }
      if (nd.startsWith('SALDO')) {
        const b = h.s >= 0 ? toCents(r[h.s]) : null;
        if (b != null) balances.push({ date, balanceCents: b });
        return;
      }
      const v = toCents(r[h.v]);
      if (v == null) { if (cellText(r[h.v])) warnings.push(`Linha ${h.row + i + 2}: valor ilegível "${cellText(r[h.v])}"`); return; }
      if (v === 0) return;
      out.push({ index: out.length, raw: r.map(x => (x instanceof Date ? x.toISOString() : x)), date, description: desc, amountCents: v });
    });
    const byDate = new Map(balances.map(b => [b.date, b]));
    return {
      importerId: this.id, family: 'itau-cc', institution: 'Itaú', kind: 'ACCOUNT', account: { branch, number },
      period: periodOf(out), openingBalance: opening, balances: [...byDate.values()], rows: out, warnings,
    };
  },
  baseKey: r => `itau-cc|${r.date}|${r.amountCents}|${norm(r.description)}`,
};
