/**
 * Fatura do cartão Itaú (.xlsx "fatura aberta"/"fatura fechada").
 * Topo: "Cartão ... - final 5850", "Valor (parcial)" ou "Total", "Vencimento".
 * Tabela: Data | Lançamento | Parcelamento | Valor | Titularidade | Nome | Tipo do cartão | Número do cartão.
 * Nas parcelas a Data é a da compra original. Valor positivo = compra; negativo = pagamento/estorno.
 */
import { parseDate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { coreDescription, norm } from '@/lib/text';
import { CARD_PAYMENT_CARD_PATTERNS } from '@/server/seed';
import type { CanonicalRow, Importer, ParsedFile } from '../types';
import { amountKey, cellNorm, cellText, isZip, isXls, parseInstallment, periodOf, readWorkbook, sheetRows, type Cell } from '../util';

function header(rows: Cell[][]) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const h = rows[i].map(cellNorm);
    const d = h.findIndex(x => x === 'DATA'), l = h.findIndex(x => x.startsWith('LANCAMENTO')), v = h.findIndex(x => x.startsWith('VALOR'));
    if (d >= 0 && l >= 0 && v >= 0) return { row: i, d, l, v, p: h.findIndex(x => x.startsWith('PARCELA')), n: h.findIndex(x => x.startsWith('NUMERO DO CARTAO')) };
  }
  return null;
}

const key = (r: CanonicalRow, n: number, total: number) => `itau-card|${r.purchaseDate ?? r.date}|${norm(r.description)}|${amountKey(r.amountCents)}|${n}/${total}`;

export const itauFatura: Importer = {
  id: 'itau-fatura',
  label: 'Itaú — fatura do cartão (.xlsx)',
  detect(f) {
    if (!isZip(f.bytes) && !isXls(f.bytes)) return 0;
    try {
      const wb = readWorkbook(f.bytes);
      const rows = sheetRows(wb.Sheets[wb.SheetNames[0]]);
      const h = header(rows);
      if (!h) return 0;
      const top = rows.slice(0, h.row).map(r => r.map(cellNorm).join(' ')).join(' ');
      const hasCard = /FINAL \d{4}/.test(top) || top.includes('CARTAO');
      return hasCard && (top.includes('VENCIMENTO') || norm(wb.SheetNames[0]).includes('FATURA')) ? 0.95 : 0.4;
    } catch { return 0; }
  },
  parse(f): ParsedFile {
    const wb = readWorkbook(f.bytes);
    const rows = sheetRows(wb.Sheets[wb.SheetNames[0]]);
    const h = header(rows);
    if (!h) throw new Error('Cabeçalho Data / Lançamento / Valor não encontrado.');
    let title: string | null = null, last4: string | null = null, due: string | null = null, total: number | null = null, open = false;
    for (let i = 0; i < h.row; i++) {
      const r = rows[i];
      const t = r.map(cellNorm);
      const joined = t.join(' ');
      if (joined.includes('FATURA ABERTA')) open = true;
      const m = joined.match(/FINAL (\d{4})/);
      if (m && !last4) { last4 = m[1]; title = r.map(cellText).find(x => /final \d{4}/i.test(x)) ?? null; }
      // rótulos na linha i, valores na linha i+1 (mesma coluna)
      t.forEach((lbl, j) => {
        const below = rows[i + 1]?.[j];
        if (lbl.startsWith('VENCIMENTO') && !due) due = parseDate(below) ?? parseDate(r[j + 1]);
        if ((lbl.startsWith('VALOR') || lbl.startsWith('TOTAL')) && total == null) {
          const c = toCents(below as never) ?? toCents(r[j + 1] as never);
          if (c != null) total = c;
        }
      });
    }
    if (!due) { const m = norm(wb.SheetNames[0]).match(/(\d{1,2})\D(\d{2,4})/); if (m) { let y = +m[2]; if (y < 100) y += 2000; due = `${y}-${String(+m[1]).padStart(2, '0')}-10`; } }
    const out: CanonicalRow[] = [];
    const warnings: string[] = [];
    const others = new Set<string>();
    for (const r of rows.slice(h.row + 1)) {
      const desc = cellText(r[h.l]);
      const v = toCents(r[h.v] as never);
      if (!desc || v == null) continue;
      if (norm(desc).startsWith('SUBTOTAL') || norm(desc).startsWith('TOTAL')) continue;
      const date = parseDate(r[h.d]);
      if (!date) { warnings.push(`Data inválida em "${desc}"`); continue; }
      const inst = h.p >= 0 ? parseInstallment(r[h.p]) : null;
      const cardNo = h.n >= 0 ? (cellText(r[h.n]).match(/(\d{4})\s*$/)?.[1] ?? null) : null;
      if (cardNo && cardNo !== last4) others.add(cardNo);
      const isPay = v < 0 && CARD_PAYMENT_CARD_PATTERNS.some(p => norm(desc).includes(p));
      out.push({
        index: out.length, raw: r.map(x => (x instanceof Date ? x.toISOString() : x)), date, description: desc, amountCents: -v,
        installment: inst, purchaseDate: date, cardLast4: cardNo, isCardPayment: isPay,
      });
    }
    return {
      importerId: this.id, family: 'itau-card', institution: 'Itaú', kind: 'CARD',
      card: { title, last4, otherLast4: [...others], dueDate: due, reportedTotalCents: total, open },
      period: periodOf(out), balances: [], rows: out, warnings,
    };
  },
  baseKey: r => key(r, r.installment?.n ?? 1, r.installment?.total ?? 1),
  installmentKey: (r, k) => key(r, k, r.installment!.total),
  groupKey: r => `itau-card|${r.purchaseDate ?? r.date}|${coreDescription(r.description)}|${r.installment?.total}|${amountKey(r.amountCents)}`,
};
