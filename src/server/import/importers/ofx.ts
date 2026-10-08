/**
 * OFX (1.x SGML e 2.x XML) — formato aceito pela maioria dos bancos (Sicredi, Mercado Pago, BB, Caixa...).
 * Usa o FITID (id original da transação) na deduplicação. LEDGERBAL vira conferência de saldo.
 */
import { parseDate, type ISODate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { norm } from '@/lib/text';
import type { CanonicalRow, Importer, ParsedFile } from '../types';
import { decodeText, periodOf } from '../util';

const BANKS: Record<string, string> = { '0341': 'Itaú', '341': 'Itaú', '0748': 'Sicredi', '748': 'Sicredi', '0260': 'Nubank', '260': 'Nubank', '0323': 'Mercado Pago', '323': 'Mercado Pago', '0001': 'Banco do Brasil', '1': 'Banco do Brasil', '001': 'Banco do Brasil', '0104': 'Caixa', '104': 'Caixa', '0237': 'Bradesco', '237': 'Bradesco', '0033': 'Santander', '33': 'Santander', '077': 'Inter', '0077': 'Inter', '336': 'C6 Bank' };

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}
const ofxDate = (s: string | null): ISODate | null => (s && /^\d{8}/.test(s) ? parseDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`) : null);

export const ofx: Importer = {
  id: 'ofx',
  label: 'OFX (qualquer banco)',
  detect(f) {
    const head = decodeText(f.bytes.subarray(0, 2000)).toUpperCase();
    return head.includes('<OFX>') || head.includes('OFXHEADER') ? 0.9 : 0;
  },
  parse(f): ParsedFile {
    const text = decodeText(f.bytes);
    const isCard = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text);
    const bankId = tag(text, 'BANKID');
    const acct = tag(text, 'ACCTID');
    const out: CanonicalRow[] = [];
    const blocks = text.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
    const warnings: string[] = [];
    for (const b of blocks) {
      const date = ofxDate(tag(b, 'DTPOSTED'));
      const v = toCents(tag(b, 'TRNAMT'));
      const desc = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' ').trim() || tag(b, 'TRNTYPE') || 'Lançamento';
      if (!date || v == null) { warnings.push('Transação sem data ou valor ignorada.'); continue; }
      out.push({ index: out.length, raw: b.trim().slice(0, 500), date, description: desc, amountCents: v, externalId: tag(b, 'FITID') });
    }
    const bal = toCents(tag(text, 'BALAMT'));
    const balDate = ofxDate(tag(text, 'DTASOF'));
    return {
      importerId: this.id, family: 'ofx', institution: (bankId && BANKS[bankId]) || tag(text, 'ORG') || 'Banco', kind: isCard ? 'CARD' : 'ACCOUNT',
      account: isCard ? undefined : { branch: tag(text, 'BRANCHID'), number: acct },
      card: isCard ? { last4: acct ? acct.replace(/\D/g, '').slice(-4) : null, dueDate: null } : undefined,
      period: { start: ofxDate(tag(text, 'DTSTART')), end: ofxDate(tag(text, 'DTEND')) ?? periodOf(out).end },
      balances: !isCard && bal != null && balDate ? [{ date: balDate, balanceCents: bal }] : [], rows: out, warnings,
    };
  },
  baseKey: r => (r.externalId ? `ext:${r.externalId}` : `ofx|${r.date}|${r.amountCents}|${norm(r.description)}`),
};
