import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ButtonLink, Card, Empty, Money, PageHeader, cx } from '@/components/ui';
import { fmtDayMonth, fmtMonth } from '@/lib/dates';
import { formatNum } from '@/lib/money';
import { readCtx } from '@/server/context';
import { cardSummaries } from '@/server/domain/cards';
import { listCards } from '@/server/domain/catalog';
import { autoRealizeInstallments } from '@/server/domain/movements';
import type { StatementStatus } from '@/server/domain/statements';

export const metadata = { title: 'Cartões' };

const SHORT: Record<StatementStatus, { label: string; tone: string }> = {
  OPEN: { label: 'aberta', tone: 'text-primary' }, CLOSED: { label: 'fechada', tone: 'text-warning' }, OVERDUE: { label: 'vencida', tone: 'text-danger' },
  PARTIAL: { label: 'parcial', tone: 'text-warning' }, PAID: { label: 'paga', tone: 'text-income' }, FUTURE: { label: 'futura', tone: 'text-muted' },
};

export default async function Cartoes() {
  const ctx = await readCtx();
  await autoRealizeInstallments(ctx);
  const [cards, all] = await Promise.all([cardSummaries(ctx), listCards(ctx)]);
  const inactive = all.filter(c => !c.is_active);
  return (
    <div>
      <PageHeader title="Cartões" actions={<ButtonLink href="/cartoes/novo" size="sm"><Plus size={16} /> Novo cartão</ButtonLink>} />
      {cards.length === 0 && <Empty title="Nenhum cartão cadastrado" action={<ButtonLink href="/cartoes/novo">Cadastrar cartão</ButtonLink>}>Informe limite, fechamento e vencimento para o app calcular as faturas.</Empty>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map(c => {
          const due = c.closed && ['CLOSED', 'OVERDUE', 'PARTIAL'].includes(c.closed.status) ? c.closed : null;
          return (
            <Card key={c.id}>
              <Link href={`/cartoes/${c.id}`} className="block">
                <p className="text-lg font-semibold">{c.name}</p>
                <p className="text-xs text-muted">{[c.institution_name, c.brand, c.last4 && `final ${c.last4}`].filter(Boolean).join(' · ')} · fecha dia {c.closing_day}, vence dia {c.due_day}</p>
              </Link>
              {due && (
                <Link href={`/cartoes/${c.id}?fatura=${due.id}`} className={cx('mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm', due.status === 'OVERDUE' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
                  <span>Fatura {fmtMonth(due.due_month)} {due.status === 'OVERDUE' ? 'vencida' : 'fechada'} · vence {fmtDayMonth(due.due_date)}</span>
                  <Money cents={due.remaining} strong />
                </Link>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
                {c.timeline.map(t => {
                  const st = t.statement;
                  const cur = t.position === 'current';
                  const body = (
                    <>
                      <span className="flex items-center justify-between gap-1">
                        <span className={cx('text-xs', cur ? 'font-semibold text-primary' : 'text-muted')}>{fmtMonth(t.due_month)}</span>
                        {st && <span className={cx('text-[10px] font-medium', SHORT[st.status].tone)}>{SHORT[st.status].label}</span>}
                      </span>
                      <span className={cx('money tnum mt-0.5 block whitespace-nowrap text-[15px] font-semibold tracking-tight', (!st || (t.position === 'past' && st.status === 'PAID')) && 'text-muted')}>
                        <span className="mr-0.5 text-[10px] font-normal text-muted">R$</span>{formatNum(st?.total ?? 0)}
                      </span>
                      <span className="block text-[11px] text-muted">{st ? (cur && st.status === 'OPEN' ? `fecha ${fmtDayMonth(st.closing_date)}` : `vence ${fmtDayMonth(st.due_date)}`) : 'sem lançamentos'}</span>
                    </>
                  );
                  const cls = cx('min-w-0 rounded-xl border px-2 py-1.5', cur ? 'border-primary bg-primary-soft' : 'border-border bg-surface-2/60');
                  return st
                    ? <Link key={t.due_month} href={`/cartoes/${c.id}?fatura=${st.id}`} className={cx(cls, 'active:scale-[.98]')}>{body}</Link>
                    : <div key={t.due_month} className={cls}>{body}</div>;
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted">2 anteriores · atual (destacada) · 3 próximas</p>
              {c.limit_cents > 0 && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (c.used / c.limit_cents) * 100)}%` }} /></div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>Usado <Money cents={c.used} /></span><span>Disponível <Money cents={c.available} /></span>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {inactive.length > 0 && (
        <div className="mt-6"><h2 className="mb-2 text-sm font-semibold text-muted">Inativos</h2>
          <div className="flex flex-wrap gap-2">{inactive.map(c => <Link key={c.id} href={`/cartoes/${c.id}`} className="rounded-xl border border-border px-3 py-2 text-sm text-muted">{c.name}</Link>)}</div>
        </div>
      )}
    </div>
  );
}
