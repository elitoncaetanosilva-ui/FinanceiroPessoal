/**
 * Migração da planilha CAIXA 2026 (implantação).
 *  - CASH (conta): DATA COMPRA, VENCIMENTO, DESCRIÇÃO, SUBGRUPO, VALOR (positivo = saída; negativo = entrada/estorno)
 *  - CARTÃO: … Parcela, CARTÃO, SUBGRUPO, VALOR (uma linha por parcela, no mês de vencimento)
 *  - CAIXA MENSAL: PREVISTO (→ orçamento) e REALIZADO das ENTRADAS (→ uma entrada por subcategoria/mês)
 * Corte: a planilha manda até o mês de corte; depois dele valem só os arquivos do banco (evita duplicar).
 * Idempotente: cada linha tem chave "mig|…"; rodar de novo não duplica.
 */
import * as XLSX from '@e965/xlsx';
import { addMonths, monthStart, parseDate, type ISODate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { norm } from '@/lib/text';
import { audit } from '../domain/audit';
import { categoryIndex } from '../domain/catalog';
import { ensureStatement } from '../domain/statements';
import type { Ctx } from '../domain/types';
import { DomainError } from '../domain/types';

export interface CaixaRow { row: number; date: ISODate; due: ISODate; description: string; sub: string; valueCents: number; card?: string; parcela?: string | null }
export interface CaixaParsed {
  cash: CaixaRow[]; card: CaixaRow[];
  incomes: { group: string; sub: string; month: ISODate; valueCents: number }[];
  budgets: { section: 'IN' | 'OUT'; group: string; sub: string; month: ISODate; valueCents: number }[];
  cardNames: string[]; years: number[]; warnings: string[];
}

const sheet = (wb: XLSX.WorkBook, name: string) => {
  const n = wb.SheetNames.find(s => norm(s) === norm(name));
  return n ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null;
};
const txt = (v: unknown) => (v == null ? '' : String(v).trim());

export function parseCaixa(bytes: Buffer): CaixaParsed {
  const wb = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const cashRows = sheet(wb, 'CASH'), cardRows = sheet(wb, 'CARTÃO') ?? sheet(wb, 'CARTAO'), mensal = sheet(wb, 'CAIXA MENSAL');
  if (!cashRows && !cardRows) throw new DomainError('Planilha sem as abas CASH/CARTÃO.');
  const warnings: string[] = [];
  const cash: CaixaRow[] = [], card: CaixaRow[] = [];
  (cashRows ?? []).slice(1).forEach((r, i) => {
    const v = toCents(r[6] as never), desc = txt(r[4]) || `${txt(r[5]) || 'Lançamento'} (sem descrição na planilha)`;
    if (v == null || v === 0) return;
    const due = parseDate(r[3]) ?? parseDate(r[1]); const date = parseDate(r[2]) ?? due;
    if (!due || !date) { warnings.push(`CASH linha ${i + 2}: sem data`); return; }
    cash.push({ row: i + 2, date, due, description: desc, sub: txt(r[5]), valueCents: v });
  });
  (cardRows ?? []).slice(1).forEach((r, i) => {
    const v = toCents(r[8] as never), desc = txt(r[4]) || `${txt(r[7]) || 'Compra'} (sem descrição na planilha)`;
    if (v == null || v === 0) return;
    const due = parseDate(r[3]) ?? parseDate(r[1]); const date = parseDate(r[2]) ?? due;
    if (!due || !date) { warnings.push(`CARTÃO linha ${i + 2}: sem data`); return; }
    card.push({ row: i + 2, date, due, description: desc, sub: txt(r[7]), valueCents: v, card: txt(r[6]) || 'Cartão', parcela: txt(r[5]) || null });
  });

  const incomes: CaixaParsed['incomes'] = [], budgets: CaixaParsed['budgets'] = [];
  const years = new Set<number>();
  if (mensal && mensal.length > 2) {
    const h0 = mensal[0], h1 = mensal[1];
    const cols: { c: number; month: ISODate; kind: 'P' | 'R' }[] = [];
    let lastMonth: ISODate | null = null;
    for (let c = 2; c < h1.length; c++) {
      const d = parseDate(h0[c]);
      if (d) lastMonth = monthStart(d);
      const k = norm(h1[c]);
      if (!lastMonth || (k !== 'PREVISTO' && k !== 'REALIZADO')) continue;
      if (d || k === 'REALIZADO') cols.push({ c, month: lastMonth, kind: k === 'PREVISTO' ? 'P' : 'R' });
      if (k === 'REALIZADO') lastMonth = null;
    }
    let section: 'IN' | 'OUT' = 'IN', group = '';
    for (const r of mensal.slice(2)) {
      const a = txt(r[0]), b = txt(r[1]);
      if (norm(a).startsWith('TOTAL DE SAIDAS')) { section = 'OUT'; continue; }
      if (norm(a).startsWith('TOTAL DE ENTRADAS')) { section = 'IN'; continue; }
      if (/GERACAO DE CAIXA|SALDO/.test(norm(a))) break;
      if (a) { group = a; continue; }
      if (!b || !group) continue;
      for (const col of cols) {
        const v = toCents(r[col.c] as never);
        if (v == null || v === 0) continue;
        years.add(Number(col.month.slice(0, 4)));
        if (col.kind === 'P') budgets.push({ section, group, sub: b, month: col.month, valueCents: v });
        if (col.kind === 'R' && section === 'IN') incomes.push({ group, sub: b, month: col.month, valueCents: v });
      }
    }
  }
  return { cash, card, incomes, budgets, cardNames: [...new Set(card.map(c => c.card!))], years: [...years].sort(), warnings };
}

export interface CaixaOptions {
  accountId: string;
  cardMap: Record<string, string>;      // nome na planilha → id do cartão
  cashCutoff: ISODate;                  // último mês (YYYY-MM-01) de CASH e entradas que entram
  cardCutoff: ISODate;                  // último mês de vencimento de fatura que entra
  importHistory: boolean;
  importBudgets: boolean;
}

export async function applyCaixa(ctx: Ctx, p: CaixaParsed, o: CaixaOptions) {
  const acc = await ctx.q.query('select 1 from accounts where id=$1 and user_id=$2', [o.accountId, ctx.userId]);
  if (!acc[0]) throw new DomainError('Conta inválida.');
  const idx = await categoryIndex(ctx);
  const leaf = (sub: string, section: 'IN' | 'OUT', group?: string) => {
    const cands = idx.all.filter(c => c.parent_id && norm(c.name) === norm(sub) && !c.is_hidden);
    const g = group ? cands.find(c => norm(idx.byId.get(c.parent_id!)?.name ?? '') === norm(group)) : undefined;
    return (g ?? cands.find(c => c.section === section) ?? cands[0])?.id ?? null;
  };
  const counts = { cash: 0, card: 0, incomes: 0, budgets: 0, skippedAfterCutoff: 0, unknownCategory: 0, statements: 0 };
  const unknown = new Set<string>();

  type Ins = { key: string; account: string | null; card: string | null; statement: string | null; amount: number; date: ISODate; comp: ISODate; desc: string; cat: string | null };
  const rows: Ins[] = [];
  if (o.importHistory) {
    for (const r of p.cash) {
      if (monthStart(r.due) > o.cashCutoff) { counts.skippedAfterCutoff++; continue; }
      const cat = r.sub ? leaf(r.sub, 'OUT') : null;
      if (r.sub && !cat) unknown.add(r.sub);
      rows.push({ key: `mig|cash|${r.row}`, account: o.accountId, card: null, statement: null, amount: -r.valueCents, date: r.date, comp: monthStart(r.due), desc: r.description, cat });
      counts.cash++;
    }
    const cards = await ctx.q.query<{ id: string; closing_day: number; due_day: number }>('select id, closing_day, due_day from credit_cards where user_id=$1', [ctx.userId]);
    const stCache = new Map<string, string>();
    for (const r of p.card) {
      const cardId = o.cardMap[r.card!];
      if (!cardId) continue;
      const dm = monthStart(r.due);
      if (dm > o.cardCutoff) { counts.skippedAfterCutoff++; continue; }
      const c = cards.find(x => x.id === cardId);
      if (!c) throw new DomainError('Cartão inválido no mapeamento.');
      const k = `${cardId}|${dm}`;
      if (!stCache.has(k)) {
        const st = await ensureStatement(ctx, c, dm);
        await ctx.q.query('update card_statements set settled_manually=true where id=$1', [st.id]);
        stCache.set(k, st.id);
        counts.statements++;
      }
      const cat = r.sub ? leaf(r.sub, 'OUT') : null;
      if (r.sub && !cat) unknown.add(r.sub);
      const desc = r.parcela && r.parcela !== '01/01' && !r.description.includes(r.parcela) ? `${r.description} (${r.parcela})` : r.description;
      rows.push({ key: `mig|card|${r.row}`, account: null, card: cardId, statement: stCache.get(k)!, amount: -r.valueCents, date: r.date, comp: dm, desc, cat });
      counts.card++;
    }
    for (const inc of p.incomes) {
      if (inc.month > o.cashCutoff) { counts.skippedAfterCutoff++; continue; }
      const cat = leaf(inc.sub, 'IN', inc.group);
      if (!cat) { unknown.add(inc.sub); continue; }
      rows.push({ key: `mig|inc|${norm(inc.group)}|${norm(inc.sub)}|${inc.month}`, account: o.accountId, card: null, statement: null, amount: inc.valueCents,
        date: inc.month, comp: inc.month, desc: `${inc.sub} (histórico da planilha)`, cat });
      counts.incomes++;
    }
  }
  counts.unknownCategory = unknown.size;

  // inserção em lote (movimentos + rateios); duplicatas (rodar de novo) são ignoradas pelo índice único
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const ins = await ctx.q.query<{ id: string; dedup_key: string }>(
      `insert into movements(user_id, account_id, card_id, statement_id, amount_cents, date, competence, description, normalized_description,
         status, source, dedup_key, paid_date)
       select $1, x.account, x.card, x.statement, x.amount, x.date, x.comp, x.descr, upper(x.descr), 'REALIZED', 'MIGRATION', x.k,
         case when x.account is not null then x.date end
       from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::bigint[], $6::date[], $7::date[], $8::text[], $9::text[])
         as x(account, card, statement, amount, date, comp, descr, k)
       on conflict ((coalesce(account_id, card_id)), dedup_key) where dedup_key is not null and deleted_at is null do nothing
       returning id, dedup_key`,
      [ctx.userId, chunk.map(r => r.account), chunk.map(r => r.card), chunk.map(r => r.statement), chunk.map(r => r.amount),
        chunk.map(r => r.date), chunk.map(r => r.comp), chunk.map(r => r.desc), chunk.map(r => r.key)],
    );
    const byKey = new Map(chunk.map(r => [r.key, r]));
    if (ins.length) {
      await ctx.q.query(
        `insert into movement_splits(user_id, movement_id, category_id, amount_cents)
         select $1, x.m, x.c, x.a from unnest($2::uuid[], $3::uuid[], $4::bigint[]) as x(m, c, a)`,
        [ctx.userId, ins.map(x => x.id), ins.map(x => byKey.get(x.dedup_key)!.cat), ins.map(x => byKey.get(x.dedup_key)!.amount)],
      );
    }
  }
  // normalized_description correto (sem acentos) para busca/regras
  await ctx.q.query(`update movements set normalized_description=upper(translate(description, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
    where user_id=$1 and source='MIGRATION'`, [ctx.userId]);

  if (o.importBudgets) {
    const byYear = new Map<number, string>();
    for (const b of p.budgets) {
      const y = Number(b.month.slice(0, 4));
      if (!byYear.has(y)) {
        const r = await ctx.q.query<{ id: string }>('insert into budgets(user_id, year) values ($1,$2) on conflict (user_id, year) do update set year=excluded.year returning id', [ctx.userId, y]);
        byYear.set(y, r[0].id);
      }
      const cat = leaf(b.sub, b.section, b.group);
      if (!cat) { unknown.add(b.sub); continue; }
      await ctx.q.query(
        `insert into budget_items(budget_id, category_id, month, amount_cents) values ($1,$2,$3,$4)
         on conflict (budget_id, category_id, month) do update set amount_cents=excluded.amount_cents`,
        [byYear.get(y), cat, Number(b.month.slice(5, 7)), b.valueCents]);
      counts.budgets++;
    }
  }
  await audit(ctx, 'migration', null, 'CAIXA_2026', null, { ...counts, unknown: [...unknown] });
  return { ...counts, unknown: [...unknown] };
}

export const defaultCutoffs = (today: ISODate) => ({ cash: addMonths(monthStart(today), -1, 1), card: monthStart(today) });
