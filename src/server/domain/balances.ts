/**
 * Saldos. O saldo de uma conta é SEMPRE calculado:
 *   saldo inicial (fim do dia `opening_balance_date`) + movimentos realizados com data posterior.
 * Movimentos anteriores ao saldo inicial (ex.: histórico migrado) aparecem em relatórios, mas não mexem no saldo.
 */
import { today as todayFn, type ISODate } from '@/lib/dates';
import { listAccounts } from './catalog';
import type { Account, Ctx } from './types';

export interface AccountBalance extends Account {
  balance_cents: number;
  planned_cents: number;          // previstos da conta ainda não realizados (entradas − saídas)
  last_movement_date: ISODate | null;
  checkpoint: { date: ISODate; reported: number; computed: number; diff: number } | null;
}

export async function accountBalances(ctx: Ctx, asOf: ISODate = '9999-12-31'): Promise<AccountBalance[]> {
  const accounts = await listAccounts(ctx);
  const rows = await ctx.q.query<{ account_id: string; realized: number; planned: number; last_date: ISODate | null }>(
    `select a.id as account_id,
       coalesce(sum(m.amount_cents) filter (where m.status='REALIZED' and m.date > a.opening_balance_date and m.date <= $2), 0) as realized,
       coalesce(sum(m.amount_cents) filter (where m.status='PLANNED'), 0) as planned,
       max(m.date) filter (where m.status='REALIZED') as last_date
     from accounts a left join movements m on m.account_id=a.id and m.deleted_at is null
     where a.user_id=$1 group by a.id`,
    [ctx.userId, asOf],
  );
  const by = new Map(rows.map(r => [r.account_id, r]));
  const cps = await ctx.q.query<{ account_id: string; date: ISODate; balance_cents: number }>(
    `select distinct on (account_id) account_id, date, balance_cents from balance_checkpoints
     where user_id=$1 order by account_id, date desc`,
    [ctx.userId],
  );
  const out: AccountBalance[] = [];
  for (const a of accounts) {
    const r = by.get(a.id);
    const cp = cps.find(c => c.account_id === a.id);
    let checkpoint: AccountBalance['checkpoint'] = null;
    if (cp && cp.date >= a.opening_balance_date) {
      const computed = await balanceAt(ctx, a, cp.date);
      checkpoint = { date: cp.date, reported: cp.balance_cents, computed, diff: cp.balance_cents - computed };
    }
    out.push({
      ...a,
      balance_cents: a.opening_balance_cents + (r?.realized ?? 0),
      planned_cents: r?.planned ?? 0,
      last_movement_date: r?.last_date ?? null,
      checkpoint,
    });
  }
  return out;
}

export async function balanceAt(ctx: Ctx, a: Pick<Account, 'id' | 'opening_balance_cents' | 'opening_balance_date'>, date: ISODate) {
  const r = await ctx.q.query<{ s: number }>(
    `select coalesce(sum(amount_cents),0) as s from movements
     where account_id=$1 and deleted_at is null and status='REALIZED' and date > $2 and date <= $3`,
    [a.id, a.opening_balance_date, date],
  );
  return a.opening_balance_cents + r[0].s;
}

/** Saldo disponível consolidado (contas ativas marcadas como "disponível") e patrimônio investido. */
export async function consolidated(ctx: Ctx) {
  const list = await accountBalances(ctx);
  const active = list.filter(a => a.is_active);
  const available = active.filter(a => a.in_available_balance).reduce((s, a) => s + a.balance_cents, 0);
  const invested = active.filter(a => !a.in_available_balance).reduce((s, a) => s + a.balance_cents, 0);
  return { accounts: list, available, invested, total: available + invested };
}

/** Série diária do saldo de uma conta entre duas datas (para conferir com os saldos do banco). */
export async function checkpointsReport(ctx: Ctx, accountId: string) {
  const a = (await listAccounts(ctx)).find(x => x.id === accountId);
  if (!a) return [];
  const cps = await ctx.q.query<{ date: ISODate; balance_cents: number; source: string }>(
    'select date, balance_cents, source from balance_checkpoints where account_id=$1 and user_id=$2 order by date desc limit 60',
    [accountId, ctx.userId],
  );
  const out = [];
  for (const c of cps) {
    if (c.date < a.opening_balance_date) continue;
    const computed = await balanceAt(ctx, a, c.date);
    out.push({ ...c, computed, diff: c.balance_cents - computed });
  }
  return out;
}

export { todayFn as today };
