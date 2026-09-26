/**
 * Pipeline de importação:
 *   upload → identificação (formato + conta/cartão) → leitura → validação → deduplicação
 *   → classificação → prévia (lote DRAFT salvo no banco) → revisão → confirmação (transação única)
 *
 * Deduplicação (ver docs/REGRAS.md):
 *   1. chave por formato + índice de ocorrência na própria planilha (duas compras iguais no mesmo dia são 2 linhas);
 *      o banco tem índice único (portador + chave) — reimportar nunca duplica;
 *   2. previsto correspondente (parcela, recorrência) é REALIZADO em vez de criar outro;
 *   3. possível duplicado (lançamento manual ou de outro formato com mesmo valor e data próxima) → revisão, padrão "vincular".
 */
import { createHash } from 'node:crypto';
import { addDays, addMonths, diffDays, monthStart, type ISODate } from '@/lib/dates';
import { coreDescription, norm } from '@/lib/text';
import { audit } from '../domain/audit';
import { AUTO_THRESHOLD, bumpRuleHits, learnRule, loadClassifier } from '../domain/classification';
import { dueMonthForPurchase, ensureStatement, statementsOf } from '../domain/statements';
import * as M from '../domain/movements';
import type { Ctx } from '../domain/types';
import { DomainError } from '../domain/types';
import { CARD_PAYMENT_ACCOUNT_PATTERNS } from '../seed';
import { detectImporter, importerById } from './registry';
import type { CanonicalRow, InputFile, ParsedFile } from './types';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = /\.(xls|xlsx|csv|ofx|txt)$/i;

export interface BatchInfo {
  parsed: Omit<ParsedFile, 'rows'>;
  identify: { accountMatches: string[]; cardMatches: string[] };
  missing?: { id: string; description: string; amount_cents: number; date: ISODate }[];
  checkpoint?: { date: ISODate; reported: number; computedBefore: number | null } | null;
}

export interface BatchRow {
  id: string; row_index: number; date: ISODate; description: string; amount_cents: number;
  installment_number: number | null; installment_total: number | null; purchase_date: ISODate | null; external_id: string | null;
  dedup_key: string | null; row_kind: 'NORMAL' | 'CARD_PAYMENT' | 'TRANSFER'; status: 'NEW' | 'DUPLICATE' | 'MATCHED' | 'POSSIBLE_DUPLICATE' | 'IGNORED' | 'ERROR';
  action: 'IMPORT' | 'SKIP' | 'LINK'; matched_movement_id: string | null; created_movement_id: string | null;
  category_id: string | null; suggested_category_id: string | null; confidence: number | null; rule_id: string | null;
  classification_source: string | null; message: string | null; target_card_id: string | null; group_key: string | null;
  learn_pattern: string | null; raw: unknown;
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

// ---------------------------------------------------------------------
// 1) Upload + identificação + leitura
// ---------------------------------------------------------------------
export function validateFile(name: string, bytes: Buffer) {
  if (!ALLOWED_EXT.test(name)) throw new DomainError('Formato não suportado. Envie .xls, .xlsx, .csv ou .ofx.');
  if (!bytes.length) throw new DomainError('Arquivo vazio.');
  if (bytes.length > MAX_FILE_BYTES) throw new DomainError('Arquivo maior que 5 MB.');
  const isBinary = (bytes[0] === 0xd0 && bytes[1] === 0xcf) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (/\.(xls|xlsx)$/i.test(name) && !isBinary && !bytes.subarray(0, 200).toString('latin1').match(/<(html|table|\?xml)/i)) {
    throw new DomainError('O arquivo não parece ser uma planilha válida.');
  }
}

export async function createBatch(ctx: Ctx, file: InputFile): Promise<string> {
  validateFile(file.name, file.bytes);
  const imp = detectImporter(file);
  if (!imp) throw new DomainError('Não reconheci o formato deste arquivo. Formatos suportados: extrato e fatura do Itaú, fatura e extrato do Nubank (.csv) e OFX de qualquer banco.');
  let parsed: ParsedFile;
  try { parsed = imp.parse(file); } catch (e) { throw new DomainError(`Não consegui ler o arquivo: ${(e as Error).message}`); }
  if (!parsed.rows.length) throw new DomainError('Nenhum lançamento encontrado no arquivo.');
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  const { rows, ...meta } = parsed;
  const identify = await identifyHolder(ctx, parsed);
  const accountId = parsed.kind === 'ACCOUNT' && identify.accountMatches.length === 1 ? identify.accountMatches[0] : null;
  const cardId = parsed.kind === 'CARD' && identify.cardMatches.length === 1 ? identify.cardMatches[0] : null;
  const info: BatchInfo = { parsed: meta, identify };
  const b = await ctx.q.query<{ id: string }>(
    `insert into import_batches(user_id, file_name, file_sha256, file_size, importer_id, institution_name, account_id, card_id,
       statement_due_date, period_start, period_end, info)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [ctx.userId, file.name.slice(0, 200), sha, file.bytes.length, imp.id, parsed.institution, accountId, cardId,
      parsed.card?.dueDate ?? null, parsed.period.start, parsed.period.end, JSON.stringify(info)],
  );
  const batchId = b[0].id;
  for (const r of rows) {
    await ctx.q.query(
      `insert into import_rows(batch_id, user_id, row_index, raw, date, description, amount_cents, installment_number, installment_total,
         purchase_date, external_id, row_kind, status, action, message)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [batchId, ctx.userId, r.index, JSON.stringify(r.raw ?? null), r.date, r.description, r.amountCents, r.installment?.n ?? null,
        r.installment?.total ?? null, r.purchaseDate ?? null, r.externalId ?? null, r.isCardPayment ? 'CARD_PAYMENT' : 'NORMAL',
        r.error ? 'ERROR' : 'NEW', r.error ? 'SKIP' : 'IMPORT', r.error ?? null],
    );
  }
  if (accountId || cardId) await prepareBatch(ctx, batchId);
  return batchId;
}

async function identifyHolder(ctx: Ctx, p: ParsedFile) {
  const accountMatches: string[] = [], cardMatches: string[] = [];
  if (p.kind === 'ACCOUNT') {
    const accs = await ctx.q.query<{ id: string; number: string | null; branch: string | null; institution: string | null }>(
      `select a.id, a.number, a.branch, i.name as institution from accounts a left join institutions i on i.id=a.institution_id where a.user_id=$1 and a.is_active`, [ctx.userId]);
    const num = digits(p.account?.number);
    if (num) accountMatches.push(...accs.filter(a => digits(a.number) === num && (!p.account?.branch || !a.branch || digits(a.branch) === digits(p.account.branch))).map(a => a.id));
    if (!accountMatches.length) {
      const byInst = accs.filter(a => a.institution && norm(a.institution) === norm(p.institution));
      if (byInst.length === 1 && !num) accountMatches.push(byInst[0].id);
    }
  } else {
    const cards = await ctx.q.query<{ id: string; last4: string | null; extra_last4: string[]; institution: string | null }>(
      `select c.id, c.last4, c.extra_last4, i.name as institution from credit_cards c left join institutions i on i.id=c.institution_id where c.user_id=$1 and c.is_active`, [ctx.userId]);
    const l4 = p.card?.last4;
    if (l4) cardMatches.push(...cards.filter(c => c.last4 === l4 || c.extra_last4.includes(l4)).map(c => c.id));
    if (!cardMatches.length) {
      const byInst = cards.filter(c => c.institution && norm(c.institution) === norm(p.institution));
      if (byInst.length === 1) cardMatches.push(byInst[0].id);
    }
  }
  return { accountMatches, cardMatches };
}

export async function getBatch(ctx: Ctx, id: string) {
  const b = (await ctx.q.query<{
    id: string; file_name: string; file_sha256: string; importer_id: string; institution_name: string | null; account_id: string | null;
    card_id: string | null; statement_due_date: ISODate | null; period_start: ISODate | null; period_end: ISODate | null; status: string;
    stats: Record<string, number>; info: BatchInfo; created_at: Date; committed_at: Date | null; reverted_at: Date | null;
  }>('select * from import_batches where id=$1 and user_id=$2', [id, ctx.userId]))[0];
  if (!b) throw new DomainError('Lote de importação não encontrado.');
  return b;
}

export async function batchRows(ctx: Ctx, id: string) {
  return ctx.q.query<BatchRow>('select * from import_rows where batch_id=$1 and user_id=$2 order by row_index', [id, ctx.userId]);
}

/** Define conta/cartão do lote (quando não foi identificado sozinho) e prepara. */
export async function setBatchHolder(ctx: Ctx, batchId: string, holder: { accountId?: string | null; cardId?: string | null; dueDate?: ISODate | null }) {
  const b = await getBatch(ctx, batchId);
  if (b.status !== 'DRAFT') throw new DomainError('Este lote já foi processado.');
  if (holder.accountId) {
    const ok = await ctx.q.query('select 1 from accounts where id=$1 and user_id=$2', [holder.accountId, ctx.userId]);
    if (!ok[0]) throw new DomainError('Conta inválida.');
  }
  if (holder.cardId) {
    const ok = await ctx.q.query('select 1 from credit_cards where id=$1 and user_id=$2', [holder.cardId, ctx.userId]);
    if (!ok[0]) throw new DomainError('Cartão inválido.');
  }
  await ctx.q.query('update import_batches set account_id=$2, card_id=$3, statement_due_date=coalesce($4, statement_due_date) where id=$1',
    [batchId, holder.accountId ?? null, holder.cardId ?? null, holder.dueDate ?? null]);
  await prepareBatch(ctx, batchId);
}

// ---------------------------------------------------------------------
// 2) Preparação: chaves, duplicidade, previstos, classificação
// ---------------------------------------------------------------------
export async function prepareBatch(ctx: Ctx, batchId: string) {
  const b = await getBatch(ctx, batchId);
  if (b.status !== 'DRAFT') throw new DomainError('Este lote já foi processado.');
  const imp = importerById(b.importer_id);
  if (!imp) throw new Error('Importador desconhecido: ' + b.importer_id);
  const holderId = b.account_id ?? b.card_id;
  if (!holderId) return;
  const holderCol = b.account_id ? 'account_id' : 'card_id';
  const rows = await batchRows(ctx, batchId);
  const classifier = await loadClassifier(ctx);
  const cards = await ctx.q.query<{ id: string; payment_patterns: string[]; institution: string | null }>(
    `select c.id, c.payment_patterns, i.name as institution from credit_cards c left join institutions i on i.id=c.institution_id where c.user_id=$1 and c.is_active`, [ctx.userId]);

  // fatura do arquivo (cartão)
  let statementId: string | null = null;
  if (b.card_id) {
    const card = (await ctx.q.query<{ id: string; closing_day: number; due_day: number }>('select id, closing_day, due_day from credit_cards where id=$1', [b.card_id]))[0];
    let due = b.statement_due_date;
    if (!due) {
      const latest = rows.filter(r => !r.installment_total).map(r => r.date).sort().pop() ?? rows[rows.length - 1].date;
      due = dueMonthForPurchase(card, latest, await statementsOf(ctx, card.id));
      await ctx.q.query('update import_batches set statement_due_date=$2 where id=$1', [batchId, due]);
    }
    const st = await ensureStatement(ctx, card, monthStart(due), b.statement_due_date ? { due_date: b.statement_due_date } : undefined);
    statementId = st.id;
  }

  const seq = new Map<string, number>();
  const claimed = new Set<string>();
  const stats = { total: rows.length, new: 0, duplicate: 0, matched: 0, possible: 0, classified: 0, pending: 0, errors: 0, payments: 0 };
  for (const r of rows) {
    if (r.status === 'ERROR') { stats.errors++; continue; }
    const cr: CanonicalRow = {
      index: r.row_index, raw: r.raw, date: r.date, description: r.description, amountCents: r.amount_cents,
      installment: r.installment_total ? { n: r.installment_number!, total: r.installment_total } : null,
      purchaseDate: r.purchase_date, externalId: r.external_id,
    };
    const base = imp.baseKey(cr);
    const n = (seq.get(base) ?? 0) + 1;
    seq.set(base, n);
    const key = base.startsWith('ext:') ? base : `${base}|${n}`;
    const groupKey = cr.installment && imp.groupKey ? `${imp.groupKey(cr)}|${n}` : null;

    let status: BatchRow['status'] = 'NEW', action: BatchRow['action'] = 'IMPORT', matched: string | null = null, message: string | null = null;
    // (a) mesma chave já importada
    const same = (await ctx.q.query<{ id: string; status: string }>(
      `select id, status from movements where ${holderCol}=$1 and dedup_key=$2 and deleted_at is null`, [holderId, key]))[0];
    if (same && same.status !== 'PLANNED') { status = 'DUPLICATE'; action = 'SKIP'; matched = same.id; message = 'Já importado anteriormente.'; }
    else if (same) { status = 'MATCHED'; action = 'LINK'; matched = same.id; message = 'Realiza a parcela prevista.'; }
    // (b) previsto correspondente (parcela com centavos diferentes, recorrência)
    if (status === 'NEW') {
      const planned = await findPlannedMatch(ctx, holderCol, holderId, cr, claimed);
      if (planned) { status = 'MATCHED'; action = 'LINK'; matched = planned.id; message = planned.why; }
    }
    // (c) possível duplicado vindo de outra fonte (manual, outro formato, criado pelo sistema)
    if (status === 'NEW') {
      const dup = (await ctx.q.query<{ id: string; source: string; description: string }>(
        `select id, source, description from movements
         where ${holderCol}=$1 and amount_cents=$2 and deleted_at is null and status='REALIZED' and abs(date - $3::date) <= 3
           and (dedup_key is null or (dedup_key not like $4 and dedup_key not like 'ext:%'))
           and not exists (select 1 from import_rows ir join import_batches ib on ib.id=ir.batch_id where ir.matched_movement_id=movements.id and ir.batch_id<>$5 and ir.action='LINK' and ib.status='COMMITTED')
           and ($6::int is null or installment_number is not distinct from $6)
         order by abs(date - $3::date) limit 5`,
        [holderId, cr.amountCents, cr.date, `${imp.baseKey(cr).split('|')[0]}|%`, batchId, cr.installment?.n ?? null]))
        .find(x => !claimed.has(x.id));
      if (dup) { status = 'POSSIBLE_DUPLICATE'; action = 'LINK'; matched = dup.id; message = `Parece ser o lançamento “${dup.description}” (${dup.source === 'MANUAL' ? 'lançado à mão' : dup.source === 'SYSTEM' ? 'gerado pelo app' : 'já existente'}).`; }
    }
    if (matched && action === 'LINK') claimed.add(matched);

    // classificação
    let rowKind: BatchRow['row_kind'] = r.row_kind === 'CARD_PAYMENT' ? 'CARD_PAYMENT' : 'NORMAL';
    let targetCard: string | null = b.card_id && rowKind === 'CARD_PAYMENT' ? b.card_id : null;
    let categoryId: string | null = null, suggested: string | null = null, confidence: number | null = null, ruleId: string | null = null, source: string | null = null;
    if (b.account_id && cr.amountCents < 0) {
      const d = norm(cr.description);
      const own = cards.filter(c => c.payment_patterns.some(p => p && d.includes(norm(p))));
      if (own.length === 1) { rowKind = 'CARD_PAYMENT'; targetCard = own[0].id; source = 'padrão do cartão'; }
      else if (!own.length && CARD_PAYMENT_ACCOUNT_PATTERNS.some(p => d.includes(p)) && cards.length) {
        const byName = cards.filter(c => c.institution && d.includes(norm(c.institution).split(' ')[0]));
        const guess = byName.length === 1 ? byName : cards.length === 1 ? cards : [];
        if (guess.length === 1) { rowKind = 'CARD_PAYMENT'; targetCard = guess[0].id; source = 'parece pagamento de fatura'; }
        else message = (message ? message + ' ' : '') + 'Parece pagamento de fatura: indique o cartão.';
      }
    }
    if (rowKind === 'NORMAL' && status !== 'DUPLICATE') {
      const c = classifier.classify({ description: cr.description, amountCents: cr.amountCents, accountId: b.account_id, cardId: b.card_id });
      if (c) {
        suggested = c.categoryId; confidence = c.confidence; source = c.source; ruleId = c.ruleId;
        if (c.confidence >= AUTO_THRESHOLD) categoryId = c.categoryId;
      }
    }
    if (status === 'NEW' || status === 'POSSIBLE_DUPLICATE') stats[status === 'NEW' ? 'new' : 'possible']++;
    if (status === 'DUPLICATE') stats.duplicate++;
    if (status === 'MATCHED') stats.matched++;
    if (rowKind === 'CARD_PAYMENT') stats.payments++;
    else if (status !== 'DUPLICATE' && status !== 'MATCHED') { if (categoryId) stats.classified++; else stats.pending++; }

    await ctx.q.query(
      `update import_rows set dedup_key=$2, status=$3, action=$4, matched_movement_id=$5, row_kind=$6, target_card_id=$7,
         category_id=$8, suggested_category_id=$9, confidence=$10, rule_id=$11, classification_source=$12, message=$13, group_key=$14
       where id=$1`,
      [r.id, key, status, action, matched, rowKind, targetCard, categoryId, suggested, confidence, ruleId, source, message, groupKey],
    );
  }

  // D5: linhas que estavam numa importação anterior da mesma fatura e sumiram (estorno/alteração do banco)
  const info: BatchInfo = b.info;
  if (statementId && b.card_id) {
    const keys = [...seq.keys()];
    const prev = await ctx.q.query<{ id: string; description: string; amount_cents: number; date: ISODate; dedup_key: string }>(
      `select id, description, amount_cents, date, dedup_key from movements where statement_id=$1 and deleted_at is null and source='IMPORT'
         and status='REALIZED' and dedup_key like $2`, [statementId, `${imp.baseKey({ index: 0, raw: null, date: '2000-01-01', description: '', amountCents: 0 }).split('|')[0]}|%`]);
    const current = new Set((await batchRows(ctx, batchId)).map(r => r.dedup_key));
    info.missing = prev.filter(p => !current.has(p.dedup_key) && !keys.some(k => p.dedup_key.startsWith(k))).map(({ dedup_key: _k, ...x }) => x);
  }
  // conferência de saldo: saldo informado × calculado ANTES da importação
  if (b.account_id && info.parsed.balances?.length) {
    const last = [...info.parsed.balances].sort((a, z) => (a.date < z.date ? 1 : -1))[0];
    info.checkpoint = { date: last.date, reported: last.balanceCents, computedBefore: null };
  }
  await ctx.q.query('update import_batches set stats=$2, info=$3 where id=$1', [batchId, JSON.stringify(stats), JSON.stringify(info)]);
}

async function findPlannedMatch(ctx: Ctx, holderCol: string, holderId: string, r: CanonicalRow, claimed: Set<string>) {
  if (r.installment) {
    const c = await ctx.q.query<{ id: string; description: string }>(
      `select id, description from movements where ${holderCol}=$1 and status='PLANNED' and deleted_at is null
         and installment_number=$2 and installment_total=$3 and abs(amount_cents - $4) <= 5 order by date limit 10`,
      [holderId, r.installment.n, r.installment.total, r.amountCents]);
    const core = coreDescription(r.description);
    const hit = c.find(x => !claimed.has(x.id) && coreDescription(x.description) === core);
    if (hit) return { id: hit.id, why: 'Realiza a parcela prevista (valor ajustado).' };
  }
  const rec = await ctx.q.query<{ id: string; amount_cents: number; date: ISODate; match_pattern: string | null; tol: number; description: string }>(
    `select m.id, m.amount_cents, m.date, r.match_pattern, r.amount_tolerance_pct as tol, m.description from movements m join recurring_rules r on r.id=m.recurring_rule_id
     where m.${holderCol}=$1 and m.status='PLANNED' and m.deleted_at is null and m.source='RECURRING' and abs(m.date - $2::date) <= 7
       and sign(m.amount_cents) = sign($3::bigint) order by abs(m.date - $2::date)`,
    [holderId, r.date, r.amountCents]);
  const d = norm(r.description);
  for (const x of rec) {
    if (claimed.has(x.id)) continue;
    const tol = Math.abs(x.amount_cents) * (x.tol / 100);
    if (Math.abs(Math.abs(x.amount_cents) - Math.abs(r.amountCents)) > tol) continue;
    if (x.match_pattern && !d.includes(norm(x.match_pattern))) continue;
    if (!x.match_pattern && Math.abs(x.amount_cents) !== Math.abs(r.amountCents)) continue; // sem padrão, exige valor exato
    return { id: x.id, why: `Realiza a recorrência prevista “${x.description}”.` };
  }
  return null;
}

// ---------------------------------------------------------------------
// 3) Revisão (decisões por linha)
// ---------------------------------------------------------------------
export async function setRowDecision(ctx: Ctx, rowId: string, d: { action?: 'IMPORT' | 'SKIP' | 'LINK'; categoryId?: string | null; learnPattern?: string | null; kind?: 'NORMAL' | 'CARD_PAYMENT'; targetCardId?: string | null }) {
  const r = (await ctx.q.query<BatchRow & { batch_status: string }>(
    `select ir.*, b.status as batch_status from import_rows ir join import_batches b on b.id=ir.batch_id where ir.id=$1 and ir.user_id=$2`, [rowId, ctx.userId]))[0];
  if (!r) throw new DomainError('Linha não encontrada.');
  if (r.batch_status !== 'DRAFT') throw new DomainError('Este lote já foi processado.');
  if (d.action === 'LINK' && !r.matched_movement_id) throw new DomainError('Não há lançamento para vincular.');
  if (d.action === 'IMPORT' && r.status === 'DUPLICATE') throw new DomainError('Esta linha já foi importada antes; não pode ser importada de novo.');
  await ctx.q.query(
    `update import_rows set action=coalesce($2, action), category_id=case when $3::boolean then $4 else category_id end,
       learn_pattern=case when $5::boolean then $6 else learn_pattern end, row_kind=coalesce($7, row_kind),
       target_card_id=case when $8::boolean then $9 else target_card_id end where id=$1`,
    [rowId, d.action ?? null, d.categoryId !== undefined, d.categoryId ?? null, d.learnPattern !== undefined, d.learnPattern ?? null,
      d.kind ?? null, d.targetCardId !== undefined, d.targetCardId ?? null],
  );
}

/** Aplica uma categoria a todas as linhas pendentes do lote com o mesmo núcleo de descrição. */
export async function classifySimilarRows(ctx: Ctx, batchId: string, rowId: string, categoryId: string) {
  const rows = await batchRows(ctx, batchId);
  const base = rows.find(r => r.id === rowId);
  if (!base) throw new DomainError('Linha não encontrada.');
  const core = coreDescription(base.description);
  let n = 0;
  for (const r of rows) {
    if (r.row_kind !== 'NORMAL' || r.action !== 'IMPORT') continue;
    if (r.id !== rowId && (coreDescription(r.description) !== core || r.category_id)) continue;
    if (Math.sign(r.amount_cents) !== Math.sign(base.amount_cents)) continue;
    await ctx.q.query('update import_rows set category_id=$2 where id=$1', [r.id, categoryId]);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------
// 4) Confirmação — tudo em uma transação
// ---------------------------------------------------------------------
export async function commitBatch(ctx: Ctx, batchId: string) {
  const locked = await ctx.q.query<{ status: string }>('select status from import_batches where id=$1 and user_id=$2 for update', [batchId, ctx.userId]);
  if (!locked[0]) throw new DomainError('Lote não encontrado.');
  if (locked[0].status !== 'DRAFT') throw new DomainError('Este lote já foi confirmado ou descartado.');
  const b = await getBatch(ctx, batchId);
  const holderId = b.account_id ?? b.card_id;
  if (!holderId) throw new DomainError('Escolha a conta ou o cartão deste arquivo.');
  const imp = importerById(b.importer_id)!;
  const rows = await batchRows(ctx, batchId);
  const card = b.card_id ? (await ctx.q.query<{ id: string; closing_day: number; due_day: number }>('select id, closing_day, due_day from credit_cards where id=$1', [b.card_id]))[0] : null;
  const statement = card && b.statement_due_date ? await ensureStatement(ctx, card, monthStart(b.statement_due_date), { due_date: b.statement_due_date }) : null;
  const ruleHits: string[] = [];
  const created = { imported: 0, linked: 0, skipped: 0, planned: 0, payments: 0 };
  const toLink: { id: string; categoryId: string }[] = [];

  for (const r of rows) {
    if (r.action === 'SKIP' || r.status === 'ERROR' || r.status === 'DUPLICATE') { created.skipped++; continue; }
    if (r.action === 'LINK' && r.matched_movement_id) {
      const m = (await ctx.q.query<{ id: string; status: string; amount_cents: number; date: ISODate; description: string; dedup_key: string | null; statement_id: string | null; source: string; n: number }>(
        `select m.id, m.status, m.amount_cents, m.date, m.description, m.dedup_key, m.statement_id, m.source,
           (select count(*)::int from movement_splits s where s.movement_id=m.id) as n
         from movements m where m.id=$1 and m.user_id=$2 and m.deleted_at is null for update`, [r.matched_movement_id, ctx.userId]))[0];
      if (!m) { created.skipped++; continue; }
      const prev = { status: m.status, amount_cents: m.amount_cents, date: m.date, description: m.description, dedup_key: m.dedup_key, statement_id: m.statement_id, source: m.source };
      const newAmount = m.n === 1 ? r.amount_cents : m.amount_cents;
      await ctx.q.query(
        `update movements set status='REALIZED', amount_cents=$2, date=$3, dedup_key=$4, import_batch_id=$5,
           description=case when source in ('RECURRING','SYSTEM') then $6 else description end,
           statement_id=coalesce($7, statement_id), competence=coalesce($8, competence),
           paid_date=case when account_id is not null then $3::date else paid_date end, updated_at=now(), version=version+1
         where id=$1`,
        [m.id, newAmount, r.date, r.dedup_key, batchId, r.description, statement?.id ?? null, statement?.due_month ?? null],
      );
      if (m.n === 1 && newAmount !== m.amount_cents) await ctx.q.query('update movement_splits set amount_cents=$2 where movement_id=$1', [m.id, newAmount]);
      await ctx.q.query('update import_rows set prev_state=$2, status=case when status=\'POSSIBLE_DUPLICATE\' then \'MATCHED\' else status end where id=$1', [r.id, JSON.stringify(prev)]);
      await audit(ctx, 'movement', m.id, 'IMPORT', { field: 'vinculado à importação', old: prev.status, new: 'REALIZED' }, { batchId });
      created.linked++;
      continue;
    }
    // IMPORT
    const base = {
      accountId: b.account_id, cardId: b.card_id, statementId: statement?.id ?? null, amountCents: r.amount_cents, date: r.date,
      description: r.description, source: 'IMPORT' as const, importBatchId: batchId, externalId: r.external_id, dedupKey: r.dedup_key,
    };
    if (r.row_kind === 'CARD_PAYMENT') {
      const id = await M.insertMovement(ctx, { ...base, categoryId: null }, { audit: false });
      if (!id) { created.skipped++; continue; }
      if (b.account_id && r.target_card_id) await M.makeAccountMovementCardPayment(ctx, id, r.target_card_id);
      else if (b.card_id) await M.makeCardMovementPayment(ctx, id);
      await ctx.q.query('update import_rows set created_movement_id=$2 where id=$1', [r.id, id]);
      created.payments++;
      continue;
    }
    let groupId: string | null = null;
    if (r.installment_total && r.installment_total > 1 && r.group_key) {
      const g = await ctx.q.query<{ id: string }>(
        `insert into installment_groups(user_id, account_id, card_id, description, purchase_date, installment_count, installment_amount_cents, total_amount_cents, group_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (user_id, coalesce(card_id, account_id), group_key) where group_key is not null do update set description=excluded.description
         returning id`,
        [ctx.userId, b.account_id, b.card_id, r.description, r.purchase_date ?? r.date, r.installment_total, r.amount_cents, r.amount_cents * r.installment_total, r.group_key]);
      groupId = g[0].id;
    }
    const id = await M.insertMovement(ctx, {
      ...base, categoryId: r.category_id, suggestedCategoryId: r.category_id ? null : r.suggested_category_id,
      suggestionConfidence: r.category_id ? null : r.confidence, suggestionSource: r.category_id ? null : r.classification_source,
      installmentGroupId: groupId, installmentNumber: groupId ? r.installment_number : null, installmentTotal: groupId ? r.installment_total : null,
      date: groupId && r.purchase_date && b.card_id ? addMonths(r.purchase_date, (r.installment_number ?? 1) - 1) : r.date,
    }, { audit: false });
    if (!id) { await ctx.q.query(`update import_rows set status='DUPLICATE', action='SKIP' where id=$1`, [r.id]); created.skipped++; continue; }
    await ctx.q.query('update import_rows set created_movement_id=$2 where id=$1', [r.id, id]);
    if (r.rule_id && r.category_id === r.suggested_category_id) ruleHits.push(r.rule_id);
    created.imported++;
    if (r.category_id) {
      const sys = await ctx.q.query<{ system_key: string | null }>('select system_key from categories where id=$1', [r.category_id]);
      if (sys[0]?.system_key === 'TRANSFER' || sys[0]?.system_key?.startsWith('INVESTMENT')) toLink.push({ id, categoryId: r.category_id });
    }
    if (r.learn_pattern && r.category_id) await learnRule(ctx, { pattern: r.learn_pattern, categoryId: r.category_id, direction: r.amount_cents < 0 ? 'OUT' : 'IN' });

    // parcelas futuras previstas, já com a chave que o próximo arquivo terá
    if (groupId && card && statement && imp.installmentKey && r.installment_number && r.installment_total) {
      const cr: CanonicalRow = { index: r.row_index, raw: null, date: r.date, description: r.description, amountCents: r.amount_cents,
        installment: { n: r.installment_number, total: r.installment_total }, purchaseDate: r.purchase_date };
      const seqSuffix = r.dedup_key?.split('|').pop() ?? '1';
      for (let k = r.installment_number + 1; k <= r.installment_total; k++) {
        const exists = await ctx.q.query('select 1 from movements where installment_group_id=$1 and installment_number=$2 and deleted_at is null', [groupId, k]);
        if (exists[0]) continue;
        const st = await ensureStatement(ctx, card, addMonths(statement.due_month, k - r.installment_number, 1));
        await M.insertMovement(ctx, {
          cardId: card.id, statementId: st.id, amountCents: r.amount_cents, date: addMonths(r.purchase_date ?? r.date, k - 1),
          description: r.description, status: 'PLANNED', source: 'INSTALLMENT', importBatchId: batchId, categoryId: r.category_id,
          suggestedCategoryId: r.category_id ? null : r.suggested_category_id, installmentGroupId: groupId, installmentNumber: k,
          installmentTotal: r.installment_total, dedupKey: `${imp.installmentKey(cr, k)}|${seqSuffix}`,
        }, { audit: false });
        created.planned++;
      }
    }
  }
  for (const t of toLink) await M.classifyMovement(ctx, t.id, t.categoryId, { via: 'importação' });
  await bumpRuleHits(ctx, ruleHits);

  // conferência de saldo e total da fatura
  const info = b.info;
  if (b.account_id) {
    for (const bal of info.parsed.balances ?? []) {
      await ctx.q.query(
        `insert into balance_checkpoints(user_id, account_id, date, balance_cents, source, import_batch_id) values ($1,$2,$3,$4,'IMPORT',$5)
         on conflict (account_id, date) do update set balance_cents=excluded.balance_cents, import_batch_id=excluded.import_batch_id, created_at=now()`,
        [ctx.userId, b.account_id, bal.date, bal.balanceCents, batchId]);
    }
  }
  if (statement && info.parsed.card?.reportedTotalCents != null) {
    await ctx.q.query('update card_statements set reported_total_cents=$2, updated_at=now() where id=$1', [statement.id, info.parsed.card.reportedTotalCents]);
  }
  const stats = { ...b.stats, ...created };
  await ctx.q.query(`update import_batches set status='COMMITTED', committed_at=now(), stats=$2 where id=$1`, [batchId, JSON.stringify(stats)]);
  await audit(ctx, 'import_batch', batchId, 'COMMIT', null, created);
  return created;
}

export async function discardBatch(ctx: Ctx, batchId: string) {
  const b = await getBatch(ctx, batchId);
  if (b.status !== 'DRAFT') throw new DomainError('Só é possível descartar um lote ainda não confirmado.');
  await ctx.q.query(`update import_batches set status='DISCARDED' where id=$1`, [batchId]);
}

/**
 * Desfaz um lote confirmado: exclui (logicamente) o que ele criou e devolve os previstos que ele realizou
 * ao estado anterior. Lançamentos editados depois da importação também são excluídos, mas o histórico fica.
 */
export async function revertBatch(ctx: Ctx, batchId: string) {
  const locked = await ctx.q.query<{ status: string }>('select status from import_batches where id=$1 and user_id=$2 for update', [batchId, ctx.userId]);
  if (locked[0]?.status !== 'COMMITTED') throw new DomainError('Só é possível desfazer um lote confirmado.');
  const created = await ctx.q.query<{ id: string }>(
    `select id from movements where import_batch_id=$1 and user_id=$2 and deleted_at is null
       and id not in (select matched_movement_id from import_rows where batch_id=$1 and action='LINK' and matched_movement_id is not null)`, [batchId, ctx.userId]);
  let n = 0;
  for (const m of created) n += await M.deleteMovement(ctx, m.id, 'one');
  const linked = await ctx.q.query<{ matched_movement_id: string; prev_state: Record<string, unknown> }>(
    `select matched_movement_id, prev_state from import_rows where batch_id=$1 and action='LINK' and prev_state is not null`, [batchId]);
  for (const l of linked) {
    const p = l.prev_state as { status: string; amount_cents: number; date: ISODate; description: string; dedup_key: string | null; statement_id: string | null };
    await ctx.q.query(
      `update movements set status=$2, amount_cents=$3, date=$4, description=$5, dedup_key=$6, statement_id=coalesce($7, statement_id), import_batch_id=null, updated_at=now()
       where id=$1 and deleted_at is null`, [l.matched_movement_id, p.status, p.amount_cents, p.date, p.description, p.dedup_key, p.statement_id]);
    await ctx.q.query('update movement_splits set amount_cents=$2 where movement_id=$1 and (select count(*) from movement_splits x where x.movement_id=$1)=1', [l.matched_movement_id, p.amount_cents]);
  }
  await ctx.q.query('delete from balance_checkpoints where import_batch_id=$1', [batchId]);
  await ctx.q.query(`update import_batches set status='REVERTED', reverted_at=now() where id=$1`, [batchId]);
  await audit(ctx, 'import_batch', batchId, 'REVERT', null, { removed: n, restored: linked.length });
  return { removed: n, restored: linked.length };
}

export async function listBatches(ctx: Ctx, limit = 50) {
  return ctx.q.query<{ id: string; file_name: string; importer_id: string; institution_name: string | null; status: string; stats: Record<string, number>;
    period_start: ISODate | null; period_end: ISODate | null; created_at: Date; committed_at: Date | null; holder_name: string | null; file_sha256: string }>(
    `select b.id, b.file_name, b.importer_id, b.institution_name, b.status, b.stats, b.period_start, b.period_end, b.created_at, b.committed_at, b.file_sha256,
       coalesce(a.name, c.name) as holder_name
     from import_batches b left join accounts a on a.id=b.account_id left join credit_cards c on c.id=b.card_id
     where b.user_id=$1 order by b.created_at desc limit $2`, [ctx.userId, limit]);
}

export async function sameFileImported(ctx: Ctx, batchId: string) {
  return ctx.q.query<{ id: string; committed_at: Date }>(
    `select b2.id, b2.committed_at from import_batches b1 join import_batches b2 on b2.file_sha256=b1.file_sha256 and b2.id<>b1.id and b2.user_id=b1.user_id
     where b1.id=$1 and b2.status='COMMITTED' order by b2.committed_at desc limit 1`, [batchId]);
}

export { addDays, diffDays };
