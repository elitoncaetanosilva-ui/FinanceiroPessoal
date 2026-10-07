/**
 * Ajuste pontual: concilia receitas mensais informadas pelo usuário (ver src/server/domain/incomes.ts).
 * Os valores vêm da variável INCOMES_JSON (nunca do git):
 *   {"email":"…","account":"Itaú","entries":[{"month":"2026-01-01","group":"CLT","sub":"Salário","cents":504900}, …]}
 * Roda no build da Vercel quando a variável existe; é idempotente. Depois do deploy, apague a variável.
 * O log mostra só contagens.
 */
import { createDb } from '../src/server/db';
import { reconcileIncomes, type IncomeEntry } from '../src/server/domain/incomes';

export async function incomesFromEnv(log = (m: string) => console.log('[db]', m)) {
  const raw = process.env.INCOMES_JSON;
  if (!raw) return;
  const spec = JSON.parse(raw) as { email: string; account?: string; entries: IncomeEntry[] };
  const db = await createDb();
  try {
    const user = (await db.query<{ id: string }>('select id from users where email=lower($1)', [spec.email.trim()]))[0];
    if (!user) { log('INCOMES_JSON: usuário não encontrado — nada feito'); return; }
    const accs = await db.query<{ id: string; name: string; n: number; last: string | null; opening: string }>(
      `select a.id, a.name, a.opening_balance_date::text as opening,
         (select count(*)::int from movements m where m.account_id=a.id and m.source='IMPORT' and m.deleted_at is null) as n,
         (select max(m.date)::text from movements m where m.account_id=a.id and m.source='IMPORT' and m.deleted_at is null) as last
       from accounts a where a.user_id=$1 and a.is_active and a.type='CHECKING' order by n desc`, [user.id]);
    log(`contas correntes: ${accs.map(a => `${a.name} (início ${a.opening}, ${a.n} importados, último ${a.last ?? '—'})`).join(' · ')}`);
    const acc = accs.find(a => spec.account && a.name.toLowerCase().startsWith(spec.account.toLowerCase())) ?? accs[0];
    if (!acc) { log('INCOMES_JSON: conta corrente não encontrada — nada feito'); return; }
    log(`conta usada: ${acc.name}`);
    const sync = await db.query<{ n: number }>(
      `select count(*)::int as n from import_batches where user_id=$1 and importer_id='caixa-planilha' and status='COMMITTED' and stats ? 'created'`, [user.id]);
    log(`sincronizações da planilha já aplicadas: ${sync[0].n}`);
    const r = await db.tx(q => reconcileIncomes({ q, userId: user.id }, acc.id, spec.entries));
    log(`receitas: ${spec.entries.length} informadas · ${r.kept} já no app (${r.redated} com data ajustada para o 1º dia útil) · ` +
      `${r.classified} classificadas no extrato (${r.splitMovements} rateio) · ${r.createdMain} lançadas na conta principal · ` +
      `${r.createdOther} lançadas em "Outras contas" · ${r.divergent} divergentes`);
  } finally {
    await db.close();
  }
}
