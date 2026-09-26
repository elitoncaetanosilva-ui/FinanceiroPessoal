import Link from 'next/link';
import { CircleCheck, TriangleAlert, Plus } from 'lucide-react';
import { Badge, ButtonLink, Card, Empty, Money, PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { consolidated } from '@/server/domain/balances';
import { ACCOUNT_TYPES } from '@/server/domain/types';

export const metadata = { title: 'Contas' };

export default async function Contas() {
  const ctx = await readCtx();
  const c = await consolidated(ctx);
  const active = c.accounts.filter(a => a.is_active), inactive = c.accounts.filter(a => !a.is_active);
  return (
    <div>
      <PageHeader title="Contas" subtitle="Saldo de cada conta, calculado a partir do saldo inicial e dos lançamentos realizados"
        actions={<ButtonLink href="/contas/nova" size="sm"><Plus size={16} /> Nova conta</ButtonLink>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card><p className="text-xs text-muted">Disponível</p><p className="text-lg font-bold"><Money cents={c.available} /></p></Card>
        <Card><p className="text-xs text-muted">Investido</p><p className="text-lg font-bold"><Money cents={c.invested} /></p></Card>
        <Card className="col-span-2 sm:col-span-1"><p className="text-xs text-muted">Patrimônio em contas</p><p className="text-lg font-bold"><Money cents={c.total} /></p></Card>
      </div>
      {active.length === 0 && <Empty title="Nenhuma conta cadastrada" action={<ButtonLink href="/contas/nova">Cadastrar conta</ButtonLink>}>Cadastre as contas bancárias, carteiras e investimentos que quer acompanhar.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map(a => (
          <Link key={a.id} href={`/contas/${a.id}`} className="rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{a.name}</p>
                <p className="text-xs text-muted">{[a.institution_name, ACCOUNT_TYPES[a.type]].filter(Boolean).join(' · ')}</p>
              </div>
              {!a.in_available_balance && <Badge>fora do disponível</Badge>}
            </div>
            <p className="mt-2 text-2xl font-bold"><Money cents={a.balance_cents} tone={a.balance_cents < 0 ? 'expense' : 'neutral'} /></p>
            {a.planned_cents !== 0 && <p className="text-xs text-muted">Previstos: <Money cents={a.planned_cents} signed /></p>}
            {a.checkpoint && (a.checkpoint.diff === 0
              ? <p className="mt-2 flex items-center gap-1 text-xs text-income"><CircleCheck size={14} /> Confere com o banco em {fmtDate(a.checkpoint.date)}</p>
              : <p className="mt-2 flex items-center gap-1 text-xs text-danger"><TriangleAlert size={14} /> Diferença de <Money cents={a.checkpoint.diff} /> com o banco em {fmtDate(a.checkpoint.date)}</p>)}
          </Link>
        ))}
      </div>
      {inactive.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">Inativas</h2>
          <div className="flex flex-wrap gap-2">{inactive.map(a => <Link key={a.id} href={`/contas/${a.id}`} className="rounded-xl border border-border px-3 py-2 text-sm text-muted">{a.name}</Link>)}</div>
        </div>
      )}
    </div>
  );
}
