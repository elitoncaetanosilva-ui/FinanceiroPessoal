import Link from 'next/link';
import { MonthNav, monthParam } from '@/components/MonthNav';
import { BudgetBar, ButtonLink, Card, Money, PageHeader, cx } from '@/components/ui';
import { readCtx } from '@/server/context';
import { budgetView, type BudgetLine } from '@/server/domain/budget';
import { autoRealizeInstallments } from '@/server/domain/movements';

export const metadata = { title: 'Orçamento' };

export default async function Orcamento({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  await autoRealizeInstallments(ctx);
  const month = monthParam(sp.mes);
  const v = await budgetView(ctx, month);
  const mk = month.slice(0, 7);
  const s = v.spending;
  const inn = v.sections.find(x => x.section === 'IN')!.total;
  return (
    <div className="space-y-4">
      <PageHeader title="Orçamento" actions={<ButtonLink href={`/orcamento/editar?ano=${month.slice(0, 4)}`} size="sm" variant="secondary">Editar ano</ButtonLink>} />
      <MonthNav month={month} basePath="/orcamento" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold text-muted">Gastos (despesas + dívidas)</p>
          <Four b={s.budget} r={s.realized} p={s.planned} />
          <BudgetBar className="mt-3" budget={s.budget} realized={s.realized} planned={s.planned} />
          <Deviation d={s.deviation} budget={s.budget} expense />
        </Card>
        <Card>
          <p className="text-sm font-semibold text-muted">Entradas</p>
          <Four b={inn.budget} r={inn.realized} p={inn.planned} />
          <BudgetBar className="mt-3" budget={inn.budget} realized={inn.realized} planned={inn.planned} />
          <Deviation d={inn.deviation} budget={inn.budget} />
        </Card>
      </div>
      {(v.unclassified.outflow !== 0 || v.unclassified.inflow !== 0) && (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning"><Link href={`/movimentos?mes=${mk}&pend=1`}>
          Sem categoria neste mês (fora do orçamento): {v.unclassified.outflow > 0 && <>saídas <Money cents={v.unclassified.outflow} /></>}{v.unclassified.outflow > 0 && v.unclassified.inflow > 0 && ' · '}{v.unclassified.inflow > 0 && <>entradas <Money cents={v.unclassified.inflow} /></>}. Classificar →
        </Link></p>
      )}
      {v.sections.map(sec => (
        <section key={sec.section}>
          <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-sm font-semibold text-muted">
            <span className="uppercase tracking-wide">{sec.label}</span><span><Money cents={sec.total.projected} /> de <Money cents={sec.total.budget} /></span>
          </h2>
          {/* celular */}
          <div className="space-y-2 lg:hidden">
            {sec.lines.map(l => <LineCard key={l.category.id} l={l} mk={mk} section={sec.section} />)}
          </div>
          {/* notebook */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase text-muted"><tr>
                <th className="p-2 text-left">Categoria</th><th className="p-2 text-right">Orçado</th><th className="p-2 text-right">Realizado</th>
                <th className="p-2 text-right">Previsto</th><th className="p-2 text-right">Realizado + Previsto</th><th className="p-2 text-right">Desvio</th><th className="w-40 p-2" />
              </tr></thead>
              <tbody>
                {sec.lines.map(l => (
                  <TableRows key={l.category.id} l={l} mk={mk} section={sec.section} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function Four({ b, r, p }: { b: number; r: number; p: number }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
      <div><dt className="text-[11px] text-muted">Orçado</dt><dd><Money cents={b} /></dd></div>
      <div><dt className="text-[11px] text-muted">Realizado</dt><dd><Money cents={r} /></dd></div>
      <div><dt className="text-[11px] text-muted">Previsto</dt><dd className="text-planned"><Money cents={p} /></dd></div>
      <div><dt className="text-[11px] text-muted">R + P</dt><dd className="font-semibold"><Money cents={r + p} /></dd></div>
    </dl>
  );
}
function Deviation({ d, budget, expense }: { d: number; budget: number; expense?: boolean }) {
  if (!budget) return <p className="mt-2 text-sm text-muted">Sem orçamento definido.</p>;
  const bad = expense ? d > 0 : d < 0;
  return <p className={cx('mt-2 text-sm font-medium', bad ? 'text-expense' : 'text-income')}>{d === 0 ? 'Exatamente no orçamento' : <><Money cents={Math.abs(d)} /> {d > 0 ? 'acima' : 'abaixo'} do orçamento (projetado)</>}</p>;
}
function LineCard({ l, mk, section }: { l: BudgetLine; mk: string; section: 'IN' | 'OUT' }) {
  const bad = section === 'OUT' ? l.deviation > 0 && l.budget > 0 : l.deviation < 0 && l.budget > 0;
  return (
    <details id={`c-${l.category.id}`} className="rounded-2xl border border-border bg-surface">
      <summary className="block cursor-pointer list-none p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{l.category.name}</span>
          <span className="text-sm"><Money cents={l.projected} strong /> <span className="text-muted">/ <Money cents={l.budget} /></span></span>
        </div>
        <BudgetBar className="mt-2" budget={l.budget} realized={l.realized} planned={l.planned} />
        {l.budget > 0 && l.deviation !== 0 && <p className={cx('mt-1 text-xs', bad ? 'text-expense' : 'text-muted')}><Money cents={Math.abs(l.deviation)} /> {l.deviation > 0 ? 'acima' : 'abaixo'} do orçado</p>}
      </summary>
      <ul className="divide-y divide-border border-t border-border text-sm">
        {(l.children ?? []).map(c => (
          <li key={c.category.id}>
            <Link href={`/movimentos?mes=${mk}&cat=${c.category.id}`} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <span className="text-muted">{c.category.name}</span>
              <span><Money cents={c.realized} />{c.planned !== 0 && <span className="text-planned"> +<Money cents={c.planned} /></span>} <span className="text-muted">/ <Money cents={c.budget} /></span></span>
            </Link>
          </li>
        ))}
        <li><Link href={`/movimentos?mes=${mk}&cat=${l.category.id}`} className="block px-3 py-2 text-center text-primary">Ver lançamentos</Link></li>
      </ul>
    </details>
  );
}
function TableRows({ l, mk, section }: { l: BudgetLine; mk: string; section: 'IN' | 'OUT' }) {
  const dev = (x: BudgetLine) => (x.budget > 0 ? cx((section === 'OUT' ? x.deviation > 0 : x.deviation < 0) ? 'text-expense' : 'text-income') : 'text-muted');
  return (
    <>
      <tr className="border-t border-border bg-surface-2/50 font-medium">
        <td className="p-2"><Link href={`/movimentos?mes=${mk}&cat=${l.category.id}`} className="hover:text-primary">{l.category.name}</Link></td>
        <td className="p-2 text-right"><Money cents={l.budget} /></td><td className="p-2 text-right"><Money cents={l.realized} /></td>
        <td className="p-2 text-right text-planned"><Money cents={l.planned} /></td><td className="p-2 text-right font-semibold"><Money cents={l.projected} /></td>
        <td className={cx('p-2 text-right', dev(l))}><Money cents={l.deviation} /></td>
        <td className="p-2"><BudgetBar budget={l.budget} realized={l.realized} planned={l.planned} /></td>
      </tr>
      {(l.children ?? []).filter(c => c.budget || c.realized || c.planned).map(c => (
        <tr key={c.category.id} className="border-t border-border/50 text-muted">
          <td className="p-2 pl-6"><Link href={`/movimentos?mes=${mk}&cat=${c.category.id}`} className="hover:text-primary">{c.category.name}</Link></td>
          <td className="p-2 text-right"><Money cents={c.budget} /></td><td className="p-2 text-right"><Money cents={c.realized} /></td>
          <td className="p-2 text-right text-planned"><Money cents={c.planned} /></td><td className="p-2 text-right"><Money cents={c.projected} /></td>
          <td className={cx('p-2 text-right', dev(c))}><Money cents={c.deviation} /></td><td />
        </tr>
      ))}
    </>
  );
}
