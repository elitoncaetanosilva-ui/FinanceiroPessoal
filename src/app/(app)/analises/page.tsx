import Link from 'next/link';
import { BalanceChart, CardSpendChart, IncomeExpenseChart } from '@/components/charts';
import { CategorySelect } from '@/components/CategorySelect';
import { Card, CardTitle, Money, PageHeader, cx, inputClass } from '@/components/ui';
import { addMonths, fmtMonth, monthStart, today } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { analytics, balanceHistory, cardSpendByMonth, detectRecurring } from '@/server/domain/analytics';
import { categoryIndex, listAccounts, listCards } from '@/server/domain/catalog';

export const metadata = { title: 'Análises' };

export default async function Analises({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const n = [3, 6, 12, 24].includes(Number(sp.meses)) ? Number(sp.meses) : 12;
  const to = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? `${sp.mes}-01` : monthStart(today());
  const from = addMonths(to, -(n - 1), 1);
  const f = { from, to, accountId: sp.conta || undefined, cardId: sp.cartao || undefined, categoryId: sp.cat || undefined };
  const [a, idx, accounts, cards, cardSpend, rec] = await Promise.all([
    analytics(ctx, f), categoryIndex(ctx), listAccounts(ctx), listCards(ctx), cardSpendByMonth(ctx, [from, to].length ? Array.from({ length: n }, (_, i) => addMonths(from, i, 1)) : []), detectRecurring(ctx),
  ]);
  const bal = await balanceHistory(ctx, a.months, f.accountId);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/analises?${p.toString()}`;
  };
  const totalExp = a.byCategory.reduce((s, c) => s + c.total, 0);
  const drill = (catId: string) => `/movimentos?cde=${from.slice(0, 7)}&cate=${to.slice(0, 7)}&cat=${catId}${f.accountId ? `&conta=${f.accountId}` : ''}${f.cardId ? `&cartao=${f.cardId}` : ''}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Análises" subtitle={`${fmtMonth(from)} a ${fmtMonth(to)} · visão econômica (receitas e despesas de verdade; transferências, aportes e pagamentos de fatura ficam fora)`} />
      {/* filtros: uma linha acima de tudo */}
      <form action="/analises" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex gap-1 lg:col-span-1">
          {[3, 6, 12, 24].map(k => <Link key={k} href={qs({ meses: String(k) })} className={cx('flex h-11 flex-1 items-center justify-center rounded-xl border text-sm', n === k ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-border bg-surface')}>{k}m</Link>)}
        </div>
        <input type="hidden" name="meses" value={n} />
        <select name="conta" defaultValue={sp.conta ?? ''} className={inputClass}><option value="">Todas as contas</option>{accounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="cartao" defaultValue={sp.cartao ?? ''} className={inputClass}><option value="">Todos os cartões</option>{cards.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <CategorySelect categories={idx.all} name="cat" defaultValue={sp.cat} onlyActive={false} />
        <button className="h-11 rounded-xl bg-primary font-medium text-on-primary">Aplicar</button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Receitas × despesas</CardTitle>
          <IncomeExpenseChart data={a.series} />
          <details className="mt-2 text-sm"><summary className="cursor-pointer text-primary">Ver tabela</summary>
            <table className="mt-2 w-full"><thead className="text-xs text-muted"><tr><th className="text-left">Mês</th><th className="text-right">Receitas</th><th className="text-right">Despesas</th><th className="text-right">Resultado</th></tr></thead>
              <tbody>{a.series.map(s => <tr key={s.month} className="border-t border-border"><td>{fmtMonth(s.month)}</td><td className="text-right"><Money cents={s.income} /></td><td className="text-right"><Money cents={s.expense} /></td><td className="text-right"><Money cents={s.result} tone="auto" /></td></tr>)}</tbody></table>
          </details>
        </Card>
        <Card>
          <CardTitle>Evolução do saldo disponível</CardTitle>
          {bal.some(b => b.balance != null) ? <BalanceChart daily={false} data={bal.map(b => ({ date: b.month, balance: b.balance }))} /> : <p className="text-sm text-muted">Sem saldo no período (antes do saldo inicial das contas).</p>}
          <p className="mt-1 text-xs text-muted">Saldo no fim de cada mês (mês atual: hoje).</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Gastos por categoria no período</CardTitle>
          {a.byCategory.length === 0 ? <p className="text-sm text-muted">Sem despesas classificadas no período.</p> : (
            <ul className="space-y-2">
              {a.byCategory.map(c => (
                <li key={c.id}>
                  <details>
                    <summary className="block cursor-pointer list-none">
                      <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{c.name}</span><span><Money cents={c.total} strong /> <span className="text-muted">{Math.round((c.total / totalExp) * 100)}%</span></span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(c.total / a.byCategory[0].total) * 100}%` }} /></div>
                    </summary>
                    <ul className="mt-1 pl-3 text-sm">
                      {c.subs.map(s => <li key={s.id}><Link href={drill(s.id)} className="flex justify-between py-1 text-muted hover:text-primary"><span>{s.name}</span><Money cents={s.total} /></Link></li>)}
                      <li><Link href={drill(c.id)} className="text-primary">Ver lançamentos ›</Link></li>
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>O que está aumentando</CardTitle>
          <p className="mb-2 text-xs text-muted">{fmtMonth(a.last)} comparado com a média dos 3 meses anteriores.</p>
          <ul className="divide-y divide-border text-sm">
            {a.growth.slice(0, 8).map(g => (
              <li key={g.id} className="py-1.5">
                <Link href={`/movimentos?mes=${a.last.slice(0, 7)}&cat=${g.id}`} className="flex items-baseline justify-between gap-2 hover:text-primary">
                  <span className="min-w-0 truncate font-medium">{g.name}</span>
                  <span className={cx('shrink-0', g.diff > 0 ? 'text-expense' : 'text-income')}>{g.diff > 0 ? '+' : ''}<Money cents={g.diff} /></span>
                </Link>
                <p className="text-xs text-muted">média <Money cents={g.average} /> → {fmtMonth(a.last)} <Money cents={g.current} /></p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Gastos no cartão por fatura</CardTitle>
          {cardSpend.cards.length ? <CardSpendChart data={cardSpend.data} cards={cardSpend.cards} /> : <p className="text-sm text-muted">Nenhum cartão.</p>}
        </Card>
        <Card>
          <CardTitle action={<Link href="/recorrencias" className="text-sm text-primary">Recorrências</Link>}>Gastos que se repetem</CardTitle>
          {rec.length === 0 ? <p className="text-sm text-muted">Ainda sem histórico suficiente (3 dos últimos 4 meses).</p> : (
            <ul className="divide-y divide-border text-sm">
              {rec.map(r => (
                <li key={r.name} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{r.name} <span className="text-xs text-muted">· {r.months} meses{r.hasRule ? ' · recorrência cadastrada' : ''}</span></span>
                  <Money cents={r.average} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
