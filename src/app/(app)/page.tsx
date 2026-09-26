import Link from 'next/link';
import { ChevronRight, CircleAlert, Inbox } from 'lucide-react';
import { Badge, BudgetBar, Card, CardTitle, Money, cx } from '@/components/ui';
import { MonthNav, monthParam } from '@/components/MonthNav';
import { PrivacyToggle } from '@/components/Shell';
import { fmtDate, fmtDayMonth, fmtMonth } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { dashboardData } from '@/server/domain/dashboard';
import { STATEMENT_STATUS_LABEL } from '@/server/domain/statements';

export const metadata = { title: 'Início' };

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const d = await dashboardData(ctx, monthParam(sp.mes));
  const mk = d.month.slice(0, 7);
  const spend = d.budget.spending;
  const topDev = d.budget.sections.find(s => s.section === 'OUT')!.lines
    .filter(l => l.category.nature === 'EXPENSE' || l.category.nature === 'FINANCING')
    .filter(l => l.deviation > 0 && l.budget > 0).sort((a, b) => b.deviation - a.deviation).slice(0, 3);
  const noData = d.cons.accounts.length === 0;

  return (
    <div className="space-y-4">
      {/* Saldo — primeira coisa ao abrir */}
      <section className="rounded-3xl bg-primary p-5 text-on-primary shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm opacity-85">Saldo disponível</p>
            <p className="mt-1 text-3xl font-bold tracking-tight lg:text-4xl"><Money cents={d.cons.available} /></p>
            {d.cons.invested !== 0 && <p className="mt-1 text-sm opacity-85">Investido: <Money cents={d.cons.invested} /></p>}
          </div>
          <PrivacyToggle className="text-on-primary hover:bg-white/15" />
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto scrollbar-none">
          {d.cons.accounts.filter(a => a.is_active).map(a => (
            <Link key={a.id} href={`/contas/${a.id}`} className="shrink-0 rounded-xl bg-white/12 px-3 py-2 text-sm hover:bg-white/20">
              <span className="block text-xs opacity-80">{a.name}</span>
              <Money cents={a.balance_cents} className="font-semibold" />
            </Link>
          ))}
          {noData && <Link href="/contas/nova" className="rounded-xl bg-white/15 px-3 py-2 text-sm font-medium">+ Cadastrar primeira conta</Link>}
        </div>
      </section>

      {d.pending > 0 && (
        <Link href="/pendentes" className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-warning">
          <Inbox size={20} />
          <span className="flex-1 font-medium">{d.pending} {d.pending === 1 ? 'lançamento' : 'lançamentos'} para classificar</span>
          <ChevronRight size={18} />
        </Link>
      )}

      <div className="flex items-center justify-between">
        <MonthNav month={d.month} basePath="/" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Resultado do mês */}
        <Card>
          <CardTitle action={<Link href={`/analises?mes=${mk}`} className="text-sm text-primary">Análises</Link>}>Resultado do mês</CardTitle>
          <dl className="space-y-2">
            <Row label="Receitas" href={`/movimentos?mes=${mk}&natureza=INCOME`}><Money cents={d.realized.income} tone="income" /></Row>
            <Row label="Despesas" href={`/movimentos?mes=${mk}&natureza=EXPENSE`}><Money cents={-d.realized.expense} tone="expense" /></Row>
            {d.realized.financingOut > 0 && <Row label="Dívidas (financiamentos)" href={`/movimentos?mes=${mk}&natureza=FINANCING`}><Money cents={-d.realized.financingOut} tone="expense" /></Row>}
            <div className="border-t border-border pt-2">
              <Row label={<span className="font-semibold">Resultado</span>}><Money cents={d.result} tone="auto" strong /></Row>
            </div>
            <Row label={<span className="text-muted">Projetado no fim do mês</span>}><Money cents={d.resultProjected} tone="auto" /></Row>
          </dl>
          {d.realized.unclassified > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-warning"><CircleAlert size={14} /> <Money cents={d.realized.unclassified} /> ainda sem categoria</p>
          )}
          <p className="mt-3 text-xs text-muted">
            Caixa do mês: entrou <Money cents={d.cash.inflow} />, saiu <Money cents={d.cash.outflow} />
          </p>
        </Card>

        {/* Orçamento */}
        <Card>
          <CardTitle action={<Link href={`/orcamento?mes=${mk}`} className="text-sm text-primary">Detalhar</Link>}>Orçamento de gastos</CardTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Mini label="Orçado"><Money cents={spend.budget} /></Mini>
            <Mini label="Realizado"><Money cents={spend.realized} /></Mini>
            <Mini label="Previsto"><Money cents={spend.planned} className="text-planned" /></Mini>
            <Mini label="Realizado + Previsto"><Money cents={spend.projected} strong /></Mini>
          </div>
          <BudgetBar className="mt-3" budget={spend.budget} realized={spend.realized} planned={spend.planned} />
          <p className={cx('mt-2 text-sm font-medium', spend.deviation > 0 ? 'text-expense' : 'text-income')}>
            {spend.budget === 0 ? <span className="text-muted">Sem orçamento para este mês. <Link href="/orcamento/editar" className="text-primary">Criar</Link></span>
              : spend.deviation > 0 ? <>Projeção <Money cents={spend.deviation} /> acima do orçamento</> : <>Projeção <Money cents={-spend.deviation} /> abaixo do orçamento</>}
          </p>
          {topDev.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
              {topDev.map(l => (
                <li key={l.category.id}>
                  <Link href={`/orcamento?mes=${mk}#c-${l.category.id}`} className="flex justify-between gap-2">
                    <span className="truncate">{l.category.name}</span>
                    <span className="text-expense">+<Money cents={l.deviation} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Projeção */}
        <Card>
          <CardTitle action={<Link href="/projecao" className="text-sm text-primary">Ver projeção</Link>}>Saldo projetado</CardTitle>
          <div className="grid grid-cols-3 gap-2 text-center">
            {d.projection.checkpoints.slice(0, 3).map(c => (
              <div key={c.days} className="rounded-xl bg-surface-2 px-1 py-2">
                <p className="text-xs text-muted">{c.days} dias</p>
                <Money cents={c.balance} tone={c.balance < 0 ? 'expense' : 'neutral'} className="text-sm font-semibold" />
              </div>
            ))}
          </div>
          <p className={cx('mt-3 text-sm', d.projection.min.balance < 0 ? 'text-expense' : 'text-muted')}>
            Menor saldo previsto: <Money cents={d.projection.min.balance} strong /> em {fmtDate(d.projection.min.date)}
          </p>
          <p className="mt-1 text-xs text-muted">Inclui faturas, recorrências, parcelas e o orçamento restante.</p>
        </Card>
      </div>

      {/* Cartões */}
      <Card>
        <CardTitle action={<Link href="/cartoes" className="text-sm text-primary">Cartões</Link>}>Cartões</CardTitle>
        {d.cards.length === 0 ? (
          <p className="text-sm text-muted">Nenhum cartão cadastrado. <Link className="text-primary" href="/cartoes/novo">Cadastrar</Link></p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.cards.map(c => {
              const st = c.closed ?? c.current;
              return (
                <Link key={c.id} href={`/cartoes/${c.id}`} className="rounded-xl border border-border p-3 hover:bg-surface-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{c.name}</span>
                    {st && <Badge tone={st.status === 'OVERDUE' ? 'danger' : st.status === 'CLOSED' ? 'warning' : 'neutral'}>{STATEMENT_STATUS_LABEL[st.status]}</Badge>}
                  </div>
                  {st ? (
                    <p className="mt-1 text-sm text-muted">Fatura {fmtMonth(st.due_month)} · vence {fmtDayMonth(st.due_date)}</p>
                  ) : <p className="mt-1 text-sm text-muted">Sem fatura aberta</p>}
                  <p className="mt-1 text-xl font-bold"><Money cents={st?.remaining ?? 0} /></p>
                  {c.limit_cents > 0 && (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, (c.used / c.limit_cents) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted">Disponível <Money cents={c.available} /> de <Money cents={c.limit_cents} /></p>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        )}
        {d.futureStatements > 0 && <p className="mt-3 text-sm text-muted">Faturas futuras já comprometidas: <Money cents={d.futureStatements} strong /></p>}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Gastos no cartão</CardTitle>
          <Link href={`/movimentos?mes=${mk}&natureza=EXPENSE&portador=cartao`} className="text-2xl font-bold"><Money cents={d.realized.cardSpend} /></Link>
          <p className="text-xs text-muted">compras com vencimento em {fmtMonth(d.month)}</p>
        </Card>
        <Card>
          <CardTitle>Comprometimento da renda</CardTitle>
          <p className="text-2xl font-bold">{d.commitment.ratio == null ? '—' : `${Math.round(d.commitment.ratio * 100)}%`}</p>
          <p className="text-xs text-muted">dívidas, recorrentes e parcelas: <Money cents={d.commitment.amount} /> de <Money cents={d.commitment.income} /> de entradas</p>
        </Card>
        <Card>
          <CardTitle>Valor poupado</CardTitle>
          <p className="text-2xl font-bold"><Money cents={d.realized.investedNet} tone={d.realized.investedNet < 0 ? 'expense' : 'neutral'} /></p>
          <p className="text-xs text-muted">aportes − resgates no mês{d.realized.income > 0 && d.result > 0 ? ` · sobra ${Math.round((d.result / d.realized.income) * 100)}% da renda` : ''}</p>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children, href }: { label: React.ReactNode; children: React.ReactNode; href?: string }) {
  const inner = (<><dt className="text-sm">{label}</dt><dd>{children}</dd></>);
  return href
    ? <Link href={href} className="flex items-center justify-between gap-2 rounded-lg hover:bg-surface-2">{inner}</Link>
    : <div className="flex items-center justify-between gap-2">{inner}</div>;
}
function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-muted">{label}</p><p className="font-medium">{children}</p></div>;
}
