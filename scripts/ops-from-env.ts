/**
 * Ajustes pontuais de dados em produção, aplicados no build da Vercel quando a variável existe.
 * Os valores vêm de variáveis de ambiente (nunca do git); o log mostra só contagens e conferências.
 * Tudo é idempotente. Depois do deploy, apague as variáveis.
 *
 *   INCOMES_JSON     {"email","account?","entries":[IncomeEntry]}             → reconcileIncomes
 *   CAIXA_SYNC_B64   gzip+base64 de {"email","account?","parsed":CaixaParsed}  → sincronização da planilha (planSync/applySync)
 *   CLOSE_JSON       {"email","account?","spec":CloseSpec}                    → closeMonths (pagamentos de fatura + conferências)
 *   CONSOLIDATE_JSON {"email","from","to","spec":CloseSpec}                   → consolidateAccounts (exclui a conta "from") + closeMonths,
 *                    numa transação que só é gravada se todos os meses conferirem
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { createDb, type Db } from '../src/server/db';
import { closeMonths, consolidateAccounts, type CloseResult, type CloseSpec } from '../src/server/domain/closing';
import { reconcileIncomes, type IncomeEntry } from '../src/server/domain/incomes';
import type { CaixaParsed } from '../src/server/import/planilha';
import { applySync, planSync } from '../src/server/import/planilha-sync';
import { norm } from '../src/lib/text';
import { fmtMonth } from '../src/lib/dates';

type Log = (m: string) => void;

async function target(db: Db, email: string, account: string | undefined, log: Log) {
  const user = (await db.query<{ id: string }>('select id from users where email=lower($1)', [email.trim()]))[0];
  if (!user) { log('usuário não encontrado — nada feito'); return null; }
  const accs = await db.query<{ id: string; name: string; n: number }>(
    `select a.id, a.name, (select count(*)::int from movements m where m.account_id=a.id and m.deleted_at is null) as n
     from accounts a where a.user_id=$1 and a.is_active and a.type='CHECKING' order by n desc`, [user.id]);
  const acc = accs.find(a => account && norm(a.name).startsWith(norm(account))) ?? accs[0];
  if (!acc) { log('conta corrente não encontrada — nada feito'); return null; }
  log(`conta usada: ${acc.name}`);
  return { userId: user.id, accountId: acc.id };
}

/** Diagnóstico só com contagens: onde está cada tipo de lançamento (por conta/cartão e origem). */
async function diagnose(db: Db, email: string, log: Log) {
  const user = (await db.query<{ id: string }>('select id from users where email=lower($1)', [email.trim()]))[0];
  if (!user) { log('diag: usuário não encontrado'); return; }
  const rows = await db.query<{ holder: string; kind: string; origin: string; n: number; first: string; last: string }>(
    `select coalesce(a.name || ' [' || a.type || case when a.is_active then '' else ', inativa' end || ', início ' || a.opening_balance_date || ']', 'cartão ' || c.name) as holder,
       m.kind, case when m.dedup_key like 'mig|cash|%' then 'mig-cash' when m.dedup_key like 'mig|card|%' then 'mig-card'
         when m.dedup_key like 'mig|inc|%' then 'mig-inc' when m.dedup_key like 'plan|%' then 'sync' when m.dedup_key like 'inc|%' then 'inc'
         else m.source end as origin,
       count(*)::int as n, min(m.date)::text as first, max(m.date)::text as last
     from movements m left join accounts a on a.id=m.account_id left join credit_cards c on c.id=m.card_id
     where m.user_id=$1 and m.deleted_at is null group by 1,2,3 order by 1,2,3`, [user.id]);
  for (const r of rows) log(`diag: ${r.holder} | ${r.kind} | ${r.origin} | ${r.n} | ${r.first}..${r.last}`);
  const b = await db.query<{ importer_id: string; status: string; n: number }>(
    'select importer_id, status, count(*)::int as n from import_batches where user_id=$1 group by 1,2 order by 1,2', [user.id]);
  for (const r of b) log(`diag: lotes ${r.importer_id} ${r.status}: ${r.n}`);
}

export async function opsFromEnv(log: Log = m => console.log('[db]', m)) {
  const { INCOMES_JSON, CAIXA_SYNC_B64, CLOSE_JSON, CONSOLIDATE_JSON, DIAG_EMAIL } = process.env;
  if (!INCOMES_JSON && !CAIXA_SYNC_B64 && !CLOSE_JSON && !CONSOLIDATE_JSON && !DIAG_EMAIL) return;
  const db = await createDb();
  try {
    if (DIAG_EMAIL) await diagnose(db, DIAG_EMAIL, log);
    if (INCOMES_JSON) {
      const spec = JSON.parse(INCOMES_JSON) as { email: string; account?: string; entries: IncomeEntry[] };
      const t = await target(db, spec.email, spec.account, log);
      if (t) {
        const r = await db.tx(q => reconcileIncomes({ q, userId: t.userId }, t.accountId, spec.entries));
        log(`receitas: ${spec.entries.length} informadas · ${r.kept} já no app (${r.redated} com data ajustada) · ${r.classified} classificadas no extrato · ` +
          `${r.createdMain} lançadas na conta principal · ${r.createdOther} em "Outras contas" · ${r.splitMovements} rateio(s) · ${r.divergent} divergentes`);
      }
    }
    if (CAIXA_SYNC_B64) {
      const spec = JSON.parse(zlib.gunzipSync(Buffer.from(CAIXA_SYNC_B64, 'base64')).toString('utf8')) as { email: string; account?: string; parsed: CaixaParsed };
      const t = await target(db, spec.email, spec.account, log);
      if (t) {
        const cards = await db.query<{ id: string; name: string }>('select id, name from credit_cards where user_id=$1 and is_active', [t.userId]);
        const cardMap: Record<string, string> = {};
        for (const n of spec.parsed.cardNames) {
          const c = cards.find(x => norm(x.name).includes(norm(n).split(' ')[0]));
          if (c) cardMap[n] = c.id;
        }
        log(`cartões: ${spec.parsed.cardNames.map(n => `${n} → ${cards.find(c => c.id === cardMap[n])?.name ?? 'não mapeado'}`).join(' · ')}`);
        const r = await db.tx(async q => {
          const ctx = { q, userId: t.userId };
          const o = { accountId: t.accountId, cardMap };
          const plan = await planSync(ctx, spec.parsed, o);
          const sha = createHash('sha256').update(CAIXA_SYNC_B64).digest('hex');
          const b = await q.query<{ id: string }>(
            `insert into import_batches(user_id, file_name, file_sha256, file_size, importer_id, institution_name, info)
             values ($1,'CAIXA_2026.xlsx (sincronização no deploy)',$2,$3,'caixa-planilha','Planilha CAIXA','{}') returning id`,
            [t.userId, sha, CAIXA_SYNC_B64.length]);
          const st = await applySync(ctx, b[0].id, spec.parsed, o);
          return { plan, st };
        });
        log(`planilha: ${r.st.created} incluídos (conta ${r.plan.totals.newCash}, cartões ${r.plan.totals.newCard}) · ${r.st.filled} categorias preenchidas · ` +
          `${r.st.matched} já no app · ${r.plan.ignored.length} ignorados · cartões não mapeados: ${r.plan.unmappedCards.length} · subcategorias desconhecidas: ${r.plan.unknownCategories.length}`);
      }
    }
    if (CLOSE_JSON) {
      const spec = JSON.parse(CLOSE_JSON) as { email: string; account?: string; spec: CloseSpec };
      const t = await target(db, spec.email, spec.account, log);
      if (t) {
        const r = await db.tx(q => closeMonths({ q, userId: t.userId }, t.accountId, spec.spec));
        log(`fechamento: saldo inicial ${r.openingChanged ? 'ajustado' : 'já correto'} · ${r.paymentsCreated} pagamentos de fatura lançados`);
        log(`conferência: ${r.months.map(m => `${fmtMonth(m.date)} ${m.diff === 0 ? 'ok' : `dif ${m.diff}`}`).join(' · ')}`);
      }
    }
    if (CONSOLIDATE_JSON) {
      const spec = JSON.parse(CONSOLIDATE_JSON) as { email: string; from: string; to: string; spec: CloseSpec };
      const user = (await db.query<{ id: string }>('select id from users where email=lower($1)', [spec.email.trim()]))[0];
      const accs = user ? await db.query<{ id: string; name: string }>('select id, name from accounts where user_id=$1', [user.id]) : [];
      const from = accs.find(a => a.name === spec.from), to = accs.find(a => a.name === spec.to);
      if (!user || !from || !to) log(`consolidação: ${!user ? 'usuário' : !to ? `conta "${spec.to}"` : `conta "${spec.from}"`} não encontrada — nada feito`);
      else {
        class NotClosed extends Error { constructor(public r: CloseResult) { super('não fechou'); } }
        try {
          const out = await db.tx(async q => {
            const ctx = { q, userId: user.id };
            const c = await consolidateAccounts(ctx, from.id, to.id);
            const r = await closeMonths(ctx, to.id, spec.spec);
            if (r.months.some(m => m.diff !== 0)) throw new NotClosed(r);
            return { c, r };
          });
          log(`consolidação: ${out.c.revertedBatches} lote(s) de extrato desfeito(s) · ${out.c.movedIncomes} receitas movidas · ` +
            `${out.c.removedDuplicates} gastos duplicados removidos · ${out.c.moved} outros movidos · conta "${spec.from}" excluída · ` +
            `${out.r.paymentsCreated} pagamentos de fatura + ${out.r.accountSidesCreated} débitos de pagamento lançados`);
          log(`conferência: ${out.r.months.map(m => `${fmtMonth(m.date)} ok`).join(' · ')}`);
        } catch (e) {
          if (e instanceof NotClosed) log(`consolidação NÃO aplicada (desfeita): ${e.r.months.map(m => `${fmtMonth(m.date)} ${m.diff === 0 ? 'ok' : `dif ${m.diff}`}`).join(' · ')}`);
          else log(`consolidação NÃO aplicada (desfeita) — erro: ${(e as Error).message}`);
        }
      }
    }
  } finally {
    await db.close();
  }
}
