/**
 * Nubank.
 *  - Fatura do cartão (.csv): date,title,amount — valores pt-BR ("- 1.693,60"); parcelas "Loja - Parcela 2/4"
 *    vêm com a data do ciclo (não a da compra). O nome "Nubank_2026-10-27.csv" traz o vencimento.
 *  - Conta (NuConta, .csv): Data,Valor,Identificador,Descrição — o Identificador é o id original da transação.
 */
import { parseDate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { norm } from '@/lib/text';
import { CARD_PAYMENT_CARD_PATTERNS } from '@/server/seed';
import type { CanonicalRow, Importer, ParsedFile } from '../types';
import { amountKey, decodeText, isXls, isZip, parseCsv, parseInstallment, periodOf } from '../util';

const stripParcela = (t: string) => t.replace(/\s*-\s*Parcela\s*\d+\s*\/\s*\d+\s*$/i, '').trim();
const cardKey = (r: CanonicalRow, n: number, total: number) =>
  total > 1 ? `nu-card|${norm(stripParcela(r.description))}|${amountKey(r.amountCents)}|${n}/${total}` : `nu-card|${r.date}|${norm(r.description)}|${amountKey(r.amountCents)}`;

const firstLine = (f: { bytes: Buffer }) => (isXls(f.bytes) || isZip(f.bytes) ? '' : norm(decodeText(f.bytes.subarray(0, 400)).split(/\r?\n/)[0]));

export const nubankCard: Importer = {
  id: 'nubank-cartao',
  label: 'Nubank — fatura do cartão (.csv)',
  detect: f => (firstLine(f).replace(/\s/g, '') === 'DATE,TITLE,AMOUNT' ? 0.95 : 0),
  parse(f): ParsedFile {
    const lines = parseCsv(decodeText(f.bytes));
    const out: CanonicalRow[] = [];
    const warnings: string[] = [];
    for (const [i, r] of lines.slice(1).entries()) {
      const [d, title, amount] = r;
      const date = parseDate(d?.trim());
      const v = toCents(amount);
      if (!date || v == null || !title?.trim()) { warnings.push(`Linha ${i + 2} ignorada: ${r.join(',')}`); continue; }
      const inst = parseInstallment(title.match(/Parcela\s*(\d+\s*\/\s*\d+)/i)?.[1]);
      const isPay = v < 0 && CARD_PAYMENT_CARD_PATTERNS.some(p => norm(title).includes(p));
      out.push({ index: out.length, raw: r, date, description: title.trim(), amountCents: -v, installment: inst, isCardPayment: isPay });
    }
    const m = f.name.match(/(\d{4})-(\d{2})-(\d{2})/);
    const due = m ? parseDate(`${m[1]}-${m[2]}-${m[3]}`) : null;
    if (!due) warnings.push('Vencimento não identificado no nome do arquivo (esperado Nubank_AAAA-MM-DD.csv). Confira a fatura na revisão.');
    return {
      importerId: this.id, family: 'nu-card', institution: 'Nubank', kind: 'CARD',
      card: { title: 'Nubank', last4: null, dueDate: due, reportedTotalCents: out.filter(r => !r.isCardPayment).reduce((s, r) => s - r.amountCents, 0) },
      period: periodOf(out), balances: [], rows: out, warnings,
    };
  },
  baseKey: r => cardKey(r, r.installment?.n ?? 1, r.installment?.total ?? 1),
  installmentKey: (r, k) => cardKey(r, k, r.installment!.total),
  groupKey: r => `nu-card|${norm(stripParcela(r.description))}|${r.installment?.total}|${amountKey(r.amountCents)}`,
};

export const nubankAccount: Importer = {
  id: 'nubank-conta',
  label: 'Nubank — extrato da conta (.csv)',
  detect: f => { const l = firstLine(f).replace(/\s/g, ''); return l.startsWith('DATA,VALOR,IDENTIFICADOR') ? 0.95 : 0; },
  parse(f): ParsedFile {
    const lines = parseCsv(decodeText(f.bytes));
    const out: CanonicalRow[] = [];
    const warnings: string[] = [];
    for (const [i, r] of lines.slice(1).entries()) {
      const [d, amount, id, desc] = r;
      const date = parseDate(d?.trim());
      const v = toCents(amount);
      if (!date || v == null || !desc?.trim()) { warnings.push(`Linha ${i + 2} ignorada`); continue; }
      out.push({ index: out.length, raw: r, date, description: desc.trim(), amountCents: v, externalId: id?.trim() || null });
    }
    return { importerId: this.id, family: 'nu-conta', institution: 'Nubank', kind: 'ACCOUNT', account: {}, period: periodOf(out), balances: [], rows: out, warnings };
  },
  baseKey: r => (r.externalId ? `ext:${r.externalId}` : `nu-conta|${r.date}|${r.amountCents}|${norm(r.description)}`),
};
