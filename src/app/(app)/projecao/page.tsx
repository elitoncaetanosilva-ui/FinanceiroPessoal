import Link from 'next/link';
import { BalanceChart } from '@/components/charts';
import { Badge, Card, CardTitle, Money, PageHeader, cx } from '@/components/ui';
import { fmtDate, fmtMonth } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { autoRealizeInstallments } from '@/server/domain/movements';
import { projectCash } from '@/server/domain/projection';

export const metadata = { title: 'Projeção de caixa' };
const KIND = { planned: { l: 'previsto', t: 'planned' }, statement: { l: 'fatura', t: 'primary' }, estimate: { l: 'estimativa', t: 'neutral' }, overdue: { l: 'vencido', t: 'warning' } } as const;

export default async function Projecao({ searchParams }: { searchParams: Promise<{ estimativa?: string; dias?: string }> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  await autoRealizeInstallments(ctx);
  const estimate = sp.estimativa !== '0';
  const days = [30, 60, 90, 180, 365].includes(Number(sp.dias)) ? Number(sp.dias) : 365;
  const p = await projectCash(ctx, { days, estimate });
  const upcoming = p.events.filter(e => e.kind !== 'estimate').slice(0, 40);
  return (
    <div className="space-y-4">
      <PageHeader title="Projeção de caixa" subtitle={`Saldo disponível hoje ${fmtDate(p.today)}: `} />
      <p className="-mt-3 text-2xl font-bold"><Money cents={p.start} /></p>
      <div className="flex flex-wrap gap-2 text-sm">
        {[30, 60, 90, 180, 365].map(d => <Link key={d} href={`/projecao?dias=${d}${estimate ? '' : '&estimativa=0'}`} className={cx('rounded-full border px-3 py-1.5', days === d ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border')}>{d < 365 ? `${d} dias` : '12 meses'}</Link>)}
        <Link href={`/projecao?dias=${days}${estimate ? '&estimativa=0' : ''}`} className={cx('rounded-full border px-3 py-1.5', estimate ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
          {estimate ? '✓ ' : ''}Incluir gastos variáveis pelo orçamento
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {p.checkpoints.map(c => (
          <Card key={c.days} className="p-3">
            <p className="text-xs text-muted">{c.days < 365 ? `${c.days} dias` : '12 meses'} · {fmtDate(c.date)}</p>
            <p className="text-lg font-bold"><Money cents={c.balance} tone={c.balance < 0 ? 'expense' : 'neutral'} /></p>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>Saldo projetado</CardTitle>
        <BalanceChart data={p.series} height={280} />
        <p className={cx('mt-2 text-sm', p.min.balance < 0 ? 'font-medium text-expense' : 'text-muted')}>
          Menor saldo: <Money cents={p.min.balance} strong /> em {fmtDate(p.min.date)}{p.min.balance < 0 ? ' — o caixa fica negativo; antecipe entradas ou reduza saídas antes dessa data.' : ''}
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Por mês</CardTitle>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="text-left">Mês</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Saldo final</th></tr></thead>
            <tbody>{p.months.map(m => (
              <tr key={m.month} className="border-t border-border"><td className="py-1.5">{fmtMonth(m.month)}</td><td className="text-right"><Money cents={m.inflow} tone="income" /></td>
                <td className="text-right"><Money cents={-m.outflow} tone="expense" /></td><td className="text-right font-semibold"><Money cents={m.end} tone={m.end < 0 ? 'expense' : 'neutral'} /></td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card>
          <CardTitle>Próximos movimentos conhecidos</CardTitle>
          {upcoming.length === 0 ? <p className="text-sm text-muted">Nenhum previsto. Cadastre recorrências (salário, aluguel…) ou importe faturas.</p> : (
            <ul className="divide-y divide-border text-sm">
              {upcoming.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{fmtDate(e.date)} · {e.label} <Badge tone={KIND[e.kind].t}>{KIND[e.kind].l}</Badge></span>
                  <Money cents={e.amount} tone="auto" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-xs text-muted">Considera: saldo das contas disponíveis, previstos (recorrências, parcelas, lançamentos futuros), faturas a pagar no vencimento{estimate ? ' e o orçamento restante de cada mês para gastos e entradas variáveis' : ''}.</p>
    </div>
  );
}
