import Link from 'next/link';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { CategorySelect } from '@/components/CategorySelect';
import { MonthNav } from '@/components/MonthNav';
import MovementList from '@/components/movements/MovementList';
import { parseFilters } from '@/components/movements/filters';
import { ButtonLink, Money, PageHeader, cx, inputClass } from '@/components/ui';
import { monthStart, today } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { categoryIndex, listAccounts, listCards, pickerCategories } from '@/server/domain/catalog';
import { listMovements, sumMovements } from '@/server/domain/queries';

export const metadata = { title: 'Movimentos' };

export default async function Movimentos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const f = parseFilters(sp);
  const [page, totals, idx, accounts, cards] = await Promise.all([
    listMovements(ctx, f, null, 60), sumMovements(ctx, f), categoryIndex(ctx), listAccounts(ctx), listCards(ctx),
  ]);
  const base = Object.fromEntries(Object.entries(sp).filter(([k]) => k !== 'excluido'));
  const chip = (label: string, patch: Record<string, string | undefined>) => {
    const next = { ...base, ...patch };
    const on = Object.entries(patch).every(([k, v]) => (v ? base[k] === v : !base[k]));
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return <Link key={label} href={`/movimentos${qs ? '?' + qs : ''}`} className={cx('shrink-0 rounded-full border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface')}>{label}</Link>;
  };
  const activeFilters = ['conta', 'cartao', 'cat', 'natureza', 'grupo', 'lote', 'fatura', 'regra'].filter(k => sp[k]);
  return (
    <div>
      <PageHeader title="Movimentos" actions={<ButtonLink href="/movimentos/novo" size="sm" className="hidden lg:inline-flex"><Plus size={16} /> Novo</ButtonLink>} />
      {sp.excluido && <p className="mb-3 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">Lançamento excluído (continua no histórico de auditoria).</p>}

      <form className="relative mb-3" action="/movimentos">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input name="q" defaultValue={sp.q} placeholder="Buscar descrição ou valor (em todo o histórico)" className={cx(inputClass, 'pl-10')} />
      </form>

      <div className="mb-3 flex items-center justify-between gap-2">
        {f.month ? <MonthNav month={f.month} basePath="/movimentos" params={{ ...base, mes: undefined }} /> : <Link href="/movimentos" className="text-sm text-primary">Voltar ao mês atual</Link>}
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:flex-wrap lg:px-0">
        {chip('Todos', { pend: undefined, prev: undefined, portador: undefined })}
        {chip('Pendentes', { pend: '1' })}
        {chip('Previstos', { prev: '1' })}
        {chip('Realizados', { prev: '0' })}
        {chip('Cartões', { portador: 'cartao' })}
        {chip('Contas', { portador: 'conta' })}
        {chip('Ano todo / histórico', { todos: '1', mes: undefined })}
      </div>

      <details className="mb-4 rounded-2xl border border-border bg-surface p-3" open={activeFilters.length > 0}>
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><SlidersHorizontal size={16} /> Filtros {activeFilters.length > 0 && `(${activeFilters.length})`}</summary>
        <form action="/movimentos" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {sp.mes && <input type="hidden" name="mes" value={sp.mes} />}
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <select name="conta" defaultValue={sp.conta ?? ''} className={inputClass}><option value="">Todas as contas</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select name="cartao" defaultValue={sp.cartao ?? ''} className={inputClass}><option value="">Todos os cartões</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <CategorySelect categories={idx.all} name="cat" defaultValue={sp.cat} onlyActive={false} />
          <select name="natureza" defaultValue={sp.natureza ?? ''} className={inputClass}>
            <option value="">Todas as naturezas</option><option value="INCOME">Receitas</option><option value="EXPENSE">Despesas</option>
            <option value="FINANCING">Financiamentos</option><option value="INVESTMENT">Investimentos</option><option value="TRANSFER">Transferências</option><option value="ADJUSTMENT">Ajustes</option>
          </select>
          <div className="flex gap-2"><button className="h-11 flex-1 rounded-xl bg-primary px-4 font-medium text-on-primary">Filtrar</button><Link href={`/movimentos${f.month && f.month !== monthStart(today()) ? `?mes=${f.month.slice(0, 7)}` : ''}`} className="flex h-11 items-center rounded-xl border border-border px-3 text-sm">Limpar</Link></div>
        </form>
      </details>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">{totals.n} lançamento(s)</span>
        <span>Entradas <Money cents={totals.inflow} tone="income" /></span>
        <span>Saídas <Money cents={-totals.outflow} tone="expense" /></span>
      </div>
      <MovementList key={JSON.stringify(sp)} initial={page.items} next={page.next} filters={f} categories={pickerCategories(idx)} />
    </div>
  );
}
