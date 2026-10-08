/**
 * Sincronização com a planilha CAIXA (CASH / CARTÃO): compara cada linha com o que já está no app
 * e só inclui o que falta. Também preenche a categoria de lançamentos PENDENTES que a planilha já classifica.
 *
 * Uma linha da planilha é considerada "já no app" quando encontra, no mesmo portador e ainda não usado por outra linha:
 *   1. o lançamento migrado/sincronizado dela (chave "mig|…" da migração ou "plan|…" de sincronizações anteriores);
 *   2. conta: mesmo valor e data a até 3 dias (linhas lançadas no dia 1º, típicas de lançamento manual mensal,
 *      aceitam o mesmo mês);
 *   3. cartão: mesma parcela n/N na fatura do mesmo mês de vencimento e mesmo valor (parcelas aceitam diferença de
 *      arredondamento de até R$ 1,00); compra à vista: mesmo valor e data a até 3 dias.
 * Parcelas futuras previstas (criadas pela importação da fatura) contam como "já no app" — continuam previstas.
 *
 * O arquivo do banco manda: linhas sem correspondência dentro do período já coberto por extrato/fatura importados
 * (conta: até a última data importada; cartão: só nas faturas que vieram no arquivo, até a última compra) são
 * IGNORADAS — o arquivo do banco já confere sem elas.
 * Só entram as linhas posteriores ao último arquivo importado.
 * Nada é apagado nem alterado além do preenchimento de categorias pendentes; tudo é feito numa transação.
 */
import { createHash } from 'node:crypto';
import { addMonths, diffDays, isISODate, monthStart, today as todayFn, type ISODate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { coreDescription, norm } from '@/lib/text';
import { audit } from '../domain/audit';
import { balanceAt, setCheckpoint } from '../domain/balances';
import { categoryIndex } from '../domain/catalog';
import { classifyMovement, insertMovement } from '../domain/movements';
import { ensureStatement } from '../domain/statements';
import type { Ctx } from '../domain/types';
import { DomainError } from '../domain/types';
import type { CaixaParsed, CaixaRow } from './planilha';

export interface SyncOptions {
  accountId: string; cardMap: Record<string, string>; exclude?: string[];
  /** saldo informado pelo banco (ex.: fim do mês), conferido na prévia e gravado ao aplicar */
  checkpoint?: { date: ISODate; balanceCents: number } | null;
}

export interface SyncItem {
  key: string;                 // identidade da linha na planilha (estável): usada na chave de deduplicação e para excluir na prévia
  sheet: 'CASH' | 'CARTÃO'; row: number; date: ISODate; due: ISODate; description: string; sub: string;
  amountCents: number;         // sinal do portador
  holder: { accountId?: string; cardId?: string; name: string };
  installment: { n: number; total: number } | null;
  categoryId: string | null;
  match: { id: string; status: string; pending: boolean; description: string; how: string } | null;
  fillCategory: boolean;       // lançamento existente está pendente e a planilha tem categoria
  covered: boolean;            // período já coberto por arquivo do banco: sem correspondência = ignorada
  future: boolean;             // entra como previsto (fatura ainda não fechada / data futura)
  beforeOpening: boolean;      // histórico anterior ao saldo inicial da conta (não altera saldo)
}

export interface SyncPlan {
  items: SyncItem[];
  newItems: SyncItem[]; matched: SyncItem[]; fills: SyncItem[]; ignored: SyncItem[];
  unknownCategories: string[]; unmappedCards: string[];
  /** até quando cada portador já está coberto por arquivo do banco */
  coverage: { name: string; until: ISODate | null }[];
  totals: { newCash: number; newCard: number; newCashCents: number; newCardCents: number };
  /** saldo da conta calculado na data informada, depois de aplicar, comparado com o do banco */
  balanceCheck: { date: ISODate; reported: number; computed: number; diff: number } | null;
}

interface ExistingMov {
  id: string; account_id: string | null; card_id: string | null; amount_cents: number; date: ISODate; status: string; kind: string;
  description: string; dedup_key: string | null; installment_number: number | null; installment_total: number | null;
  due_month: ISODate | null; pending: boolean; n_splits: number;
}

/** Opções da sincronização (vêm do formulário de prévia ou da URL). */
export function syncOptionsFrom(get: (k: string) => string | null | undefined, cardNames: string[]): SyncOptions | null {
  const accountId = get('conta') ?? '';
  if (!accountId) return null;
  const cardMap: Record<string, string> = {};
  cardNames.forEach((n, i) => { const v = get(`c${i}`); if (v) cardMap[n] = v; });
  const d = get('saldo_data') ?? '', v = toCents(get('saldo'));
  const checkpoint = isISODate(d) && v != null ? { date: d, balanceCents: v } : null;
  return { accountId, cardMap, checkpoint };
}

const parcela = (p: string | null | undefined) => {
  const m = String(p ?? '').match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (!m) return null;
  const n = +m[1], total = +m[2];
  return total > 1 && n >= 1 && n <= total ? { n, total } : null;
};

/** Monta o plano (sem gravar nada). */
export async function planSync(ctx: Ctx, p: CaixaParsed, o: SyncOptions): Promise<SyncPlan> {
  const acc = (await ctx.q.query<{ id: string; name: string; opening_balance_cents: number; opening_balance_date: ISODate }>(
    'select id, name, opening_balance_cents, opening_balance_date from accounts where id=$1 and user_id=$2', [o.accountId, ctx.userId]))[0];
  if (!acc) throw new DomainError('Escolha a conta da aba CASH.');
  const cards = await ctx.q.query<{ id: string; name: string; closing_day: number; due_day: number }>(
    'select id, name, closing_day, due_day from credit_cards where user_id=$1', [ctx.userId]);
  const cardById = new Map(cards.map(c => [c.id, c]));
  const idx = await categoryIndex(ctx);
  const leaf = (sub: string) => {
    const cands = idx.all.filter(c => c.parent_id && !c.is_hidden && norm(c.name) === norm(sub));
    return (cands.find(c => c.section === 'OUT') ?? cands[0])?.id ?? null;
  };
  const today = todayFn();
  const unknown = new Set<string>(), unmapped = new Set<string>();

  // existentes nos portadores envolvidos
  const holderIds = [o.accountId, ...Object.values(o.cardMap).filter(Boolean)];
  const existing = await ctx.q.query<ExistingMov>(
    `select m.id, m.account_id, m.card_id, m.amount_cents, m.date, m.status, m.kind, m.description, m.dedup_key,
       m.installment_number, m.installment_total, s.due_month,
       exists (select 1 from movement_splits x where x.movement_id=m.id and x.category_id is null) as pending,
       (select count(*)::int from movement_splits x where x.movement_id=m.id) as n_splits
     from movements m left join card_statements s on s.id=m.statement_id
     where m.user_id=$1 and m.deleted_at is null and m.status <> 'CANCELLED' and coalesce(m.account_id, m.card_id) = any($2::uuid[])`,
    [ctx.userId, holderIds]);
  const byKey = new Map(existing.filter(e => e.dedup_key).map(e => [`${e.account_id ?? e.card_id}|${e.dedup_key}`, e]));

  // cobertura dos arquivos do banco: última data importada (no cartão, compras à vista — parcelas trazem datas
  // projetadas) e último mês de vencimento com lançamentos importados
  const cov = await ctx.q.query<{ hid: string; until: ISODate | null; until_any: ISODate | null; dues: (ISODate | null)[] }>(
    `select coalesce(m.account_id, m.card_id) as hid,
       max(m.date) filter (where m.installment_number is null) as until, max(m.date) as until_any, array_agg(distinct s.due_month) as dues
     from movements m left join card_statements s on s.id=m.statement_id
     where m.user_id=$1 and m.deleted_at is null and m.source='IMPORT' and m.status='REALIZED' and m.kind <> 'CARD_PAYMENT'
       and coalesce(m.account_id, m.card_id) = any($2::uuid[])
     group by 1`, [ctx.userId, holderIds]);
  // no cartão, um arquivo do banco cobre só as faturas que ele trouxe (não as anteriores)
  const covBy = new Map(cov.map(c => [c.hid, { until: c.until ?? c.until_any, dues: new Set(c.dues.filter(Boolean)) }]));
  const used = new Set<string>();

  // identidade estável da linha: conteúdo + ocorrência (não depende da posição na planilha)
  const seq = new Map<string, number>();
  const contentKey = (sheet: string, r: CaixaRow) => {
    const base = `${sheet}|${r.card ?? ''}|${r.date}|${r.due.slice(0, 7)}|${r.valueCents}|${norm(r.description)}|${r.parcela ?? ''}`;
    const n = (seq.get(base) ?? 0) + 1;
    seq.set(base, n);
    return createHash('sha1').update(`${base}|${n}`).digest('hex').slice(0, 20);
  };

  const items: SyncItem[] = [];
  const rows: { sheet: 'CASH' | 'CARTÃO'; r: CaixaRow }[] = [...p.cash.map(r => ({ sheet: 'CASH' as const, r })), ...p.card.map(r => ({ sheet: 'CARTÃO' as const, r }))];
  for (const { sheet, r } of rows) {
    const key = contentKey(sheet, r);
    let holder: SyncItem['holder'];
    if (sheet === 'CASH') holder = { accountId: acc.id, name: acc.name };
    else {
      const cid = o.cardMap[r.card ?? ''];
      if (!cid || !cardById.has(cid)) { unmapped.add(r.card ?? '?'); continue; }
      holder = { cardId: cid, name: cardById.get(cid)!.name };
    }
    const hid = (holder.accountId ?? holder.cardId)!;
    const inst = sheet === 'CARTÃO' ? parcela(r.parcela) : null;
    const categoryId = r.sub ? leaf(r.sub) : null;
    if (r.sub && !categoryId) unknown.add(r.sub);
    const amountCents = -r.valueCents;
    const dueMonth = monthStart(r.due);

    // 1) chave da migração / sincronização anterior
    let m: ExistingMov | undefined =
      byKey.get(`${hid}|mig|${sheet === 'CASH' ? 'cash' : 'card'}|${r.row}`) ?? byKey.get(`${hid}|plan|${key}`);
    let how = m ? 'mesma linha já importada' : '';
    if (m && (used.has(m.id) || m.amount_cents !== amountCents)) m = undefined;
    // 2/3) correspondência por valor e data
    if (!m) {
      const cands = existing.filter(e => !used.has(e.id) && (e.account_id ?? e.card_id) === hid && e.kind !== 'CARD_PAYMENT' &&
        (e.amount_cents === amountCents || (!!inst && Math.abs(e.amount_cents - amountCents) <= Math.min(100, Math.abs(amountCents) * 0.02))));
      let best: ExistingMov | undefined;
      if (sheet === 'CASH') {
        const exact = cands.filter(e => e.amount_cents === amountCents);
        const close = exact.filter(e => Math.abs(diffDays(e.date, r.date)) <= 3);
        const sameMonth = r.date.endsWith('-01') ? exact.filter(e => monthStart(e.date) === monthStart(r.date)) : [];
        const pool = close.length ? close : sameMonth;
        best = pool.sort((a, b) => score(a, r) - score(b, r))[0];
        how = best ? (close.length ? 'mesmo valor e data próxima' : 'mesmo valor no mês') : '';
      } else {
        const pool = cands.filter(e =>
          (e.installment_total ?? 1) === (inst?.total ?? 1) && (e.installment_number ?? 1) === (inst?.n ?? 1) &&
          (e.due_month === dueMonth || (!inst && Math.abs(diffDays(e.date, r.date)) <= 3)));
        // exato primeiro; depois diferença de arredondamento
        best = pool.sort((a, b) => Math.abs(a.amount_cents - amountCents) - Math.abs(b.amount_cents - amountCents) || score(a, r) - score(b, r))[0];
        how = best ? 'mesmo valor e parcela na fatura do mês' : '';
      }
      m = best;
    }
    if (m) used.add(m.id);

    const c = covBy.get(hid);
    const covered = !m && !!c?.until && (sheet === 'CASH'
      ? r.date <= c.until
      : r.date <= c.until && c.dues.has(dueMonth));
    const future = sheet === 'CASH' ? r.date > today : dueMonth > monthStart(today) && !!inst && inst.n > 1;
    items.push({
      key, sheet, row: r.row, date: r.date, due: r.due, description: r.description, sub: r.sub, amountCents, holder,
      installment: inst, categoryId,
      match: m ? { id: m.id, status: m.status, pending: m.pending && m.n_splits === 1, description: m.description, how } : null,
      fillCategory: !!m && m.pending && m.n_splits === 1 && !!categoryId,
      covered, future,
      beforeOpening: sheet === 'CASH' && r.date <= acc.opening_balance_date,
    });
  }
  const exclude = new Set(o.exclude ?? []);
  const newItems = items.filter(i => !i.match && !i.covered && !exclude.has(i.key));

  let balanceCheck: SyncPlan['balanceCheck'] = null;
  if (o.checkpoint && o.checkpoint.date >= acc.opening_balance_date) {
    const d = o.checkpoint.date;
    const now = await balanceAt(ctx, { id: acc.id, opening_balance_cents: acc.opening_balance_cents, opening_balance_date: acc.opening_balance_date }, d);
    const add = newItems.filter(i => i.sheet === 'CASH' && !i.future && i.date > acc.opening_balance_date && i.date <= d).reduce((s, i) => s + i.amountCents, 0);
    balanceCheck = { date: d, reported: o.checkpoint.balanceCents, computed: now + add, diff: o.checkpoint.balanceCents - (now + add) };
  }
  const coverage = [{ name: acc.name, until: covBy.get(acc.id)?.until ?? null },
    ...[...new Set(Object.values(o.cardMap))].filter(id => cardById.has(id)).map(id => ({ name: cardById.get(id)!.name, until: covBy.get(id)?.until ?? null }))];
  return {
    items, newItems, matched: items.filter(i => i.match), fills: items.filter(i => i.fillCategory && !exclude.has(i.key)),
    ignored: items.filter(i => i.covered), coverage, balanceCheck,
    unknownCategories: [...unknown], unmappedCards: [...unmapped],
    totals: {
      newCash: newItems.filter(i => i.sheet === 'CASH').length, newCard: newItems.filter(i => i.sheet === 'CARTÃO').length,
      newCashCents: newItems.filter(i => i.sheet === 'CASH').reduce((s, i) => s + i.amountCents, 0),
      newCardCents: newItems.filter(i => i.sheet === 'CARTÃO').reduce((s, i) => s + i.amountCents, 0),
    },
  };
}

/** Preferência: descrição parecida e data mais próxima. */
function score(e: ExistingMov, r: CaixaRow) {
  const same = coreDescription(e.description).slice(0, 8) === coreDescription(r.description).slice(0, 8) ? 0 : 100;
  return same + Math.abs(diffDays(e.date, r.date));
}

/** Aplica o plano numa transação: cria o que falta e preenche categorias pendentes. */
export async function applySync(ctx: Ctx, batchId: string, p: CaixaParsed, o: SyncOptions) {
  const plan = await planSync(ctx, p, o);
  const today = todayFn();
  const acc = (await ctx.q.query<{ opening_balance_date: ISODate }>('select opening_balance_date from accounts where id=$1', [o.accountId]))[0];
  const cards = await ctx.q.query<{ id: string; closing_day: number; due_day: number }>('select id, closing_day, due_day from credit_cards where user_id=$1', [ctx.userId]);
  const groups = new Map<string, string>();
  let created = 0, filled = 0;

  for (const it of plan.newItems) {
    const desc = it.installment && !it.description.includes(`${it.installment.n}/${it.installment.total}`)
      ? `${it.description} (${String(it.installment.n).padStart(2, '0')}/${String(it.installment.total).padStart(2, '0')})` : it.description;
    const base = {
      amountCents: it.amountCents, description: desc, categoryId: it.categoryId, source: 'MIGRATION' as const,
      importBatchId: batchId, dedupKey: `plan|${it.key}`,
    };
    if (it.sheet === 'CASH') {
      await insertMovement(ctx, { ...base, accountId: o.accountId, date: it.date, competence: monthStart(it.due), status: it.future ? 'PLANNED' : 'REALIZED' }, { audit: false });
      created++;
      continue;
    }
    const card = cards.find(c => c.id === it.holder.cardId)!;
    const st = await ensureStatement(ctx, card, monthStart(it.due));
    // faturas anteriores ao início do controle no app foram pagas fora dele
    if (st.due_date <= acc.opening_balance_date) await ctx.q.query('update card_statements set settled_manually=true where id=$1', [st.id]);
    let groupId: string | null = null;
    if (it.installment) {
      const gk = `plan|${card.id}|${it.date}|${coreDescription(it.description)}|${it.installment.total}|${it.amountCents}`;
      groupId = groups.get(gk) ?? null;
      if (!groupId) {
        const g = await ctx.q.query<{ id: string }>(
          `insert into installment_groups(user_id, card_id, description, purchase_date, installment_count, installment_amount_cents, total_amount_cents, group_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (user_id, coalesce(card_id, account_id), group_key) where group_key is not null do update set description=excluded.description returning id`,
          [ctx.userId, card.id, it.description, it.date, it.installment.total, it.amountCents, it.amountCents * it.installment.total, gk]);
        groupId = g[0].id;
        groups.set(gk, groupId);
      }
    }
    await insertMovement(ctx, {
      ...base, cardId: card.id, statementId: st.id, date: it.installment ? addMonths(it.date, it.installment.n - 1) : it.date,
      status: st.closing_date <= today || !it.future ? 'REALIZED' : 'PLANNED',
      installmentGroupId: groupId, installmentNumber: groupId ? it.installment!.n : null, installmentTotal: groupId ? it.installment!.total : null,
    }, { audit: false });
    created++;
  }
  for (const it of plan.fills) {
    await classifyMovement(ctx, it.match!.id, it.categoryId!, { via: 'planilha' });
    filled++;
  }
  if (o.checkpoint) await setCheckpoint(ctx, o.accountId, o.checkpoint.date, o.checkpoint.balanceCents);
  const stats = { created, filled, matched: plan.matched.length, ignored: plan.ignored.length, cash: plan.totals.newCash, card: plan.totals.newCard,
    checkpoint: plan.balanceCheck };
  await ctx.q.query(`update import_batches set status='COMMITTED', committed_at=now(), stats=$2 where id=$1 and user_id=$3`, [batchId, JSON.stringify(stats), ctx.userId]);
  await audit(ctx, 'import_batch', batchId, 'SYNC_PLANILHA', null, stats);
  return stats;
}
