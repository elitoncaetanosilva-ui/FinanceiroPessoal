import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge, ButtonLink, Card, Empty, Money, PageHeader } from '@/components/ui';
import { fmtDayMonth, fmtMonth } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { cardSummaries } from '@/server/domain/cards';
import { listCards } from '@/server/domain/catalog';
import { autoRealizeInstallments } from '@/server/domain/movements';
import { STATEMENT_STATUS_LABEL } from '@/server/domain/statements';

export const metadata = { title: 'Cartões' };

export default async function Cartoes() {
  const ctx = await readCtx();
  await autoRealizeInstallments(ctx);
  const [cards, all] = await Promise.all([cardSummaries(ctx), listCards(ctx)]);
  const inactive = all.filter(c => !c.is_active);
  return (
    <div>
      <PageHeader title="Cartões" actions={<ButtonLink href="/cartoes/novo" size="sm"><Plus size={16} /> Novo cartão</ButtonLink>} />
      {cards.length === 0 && <Empty title="Nenhum cartão cadastrado" action={<ButtonLink href="/cartoes/novo">Cadastrar cartão</ButtonLink>}>Informe limite, fechamento e vencimento para o app calcular as faturas.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map(c => (
          <Card key={c.id}>
            <Link href={`/cartoes/${c.id}`} className="block">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">{[c.institution_name, c.brand, c.last4 && `final ${c.last4}`].filter(Boolean).join(' · ')} · fecha dia {c.closing_day}, vence dia {c.due_day}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[c.closed, c.current].filter(Boolean).map(s => (
                  <div key={s!.id} className="rounded-xl bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs text-muted">Fatura {fmtMonth(s!.due_month)}</span>
                      <Badge tone={s!.status === 'OVERDUE' ? 'danger' : s!.status === 'CLOSED' ? 'warning' : s!.status === 'PAID' ? 'income' : 'neutral'}>{STATEMENT_STATUS_LABEL[s!.status]}</Badge>
                    </div>
                    <p className="mt-1 text-lg font-bold"><Money cents={s!.remaining} /></p>
                    <p className="text-xs text-muted">vence {fmtDayMonth(s!.due_date)}{s!.status === 'OPEN' && ` · fecha ${fmtDayMonth(s!.closing_date)}`}</p>
                  </div>
                ))}
              </div>
              {c.limit_cents > 0 && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (c.used / c.limit_cents) * 100)}%` }} /></div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>Usado <Money cents={c.used} /></span><span>Disponível <Money cents={c.available} /></span>
                  </div>
                </div>
              )}
              {c.upcoming.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-none">
                  {c.upcoming.slice(0, 6).map(u => (
                    <div key={u.id} className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs">
                      <span className="text-muted">{fmtMonth(u.due_month)}</span> <Money cents={u.remaining} />
                    </div>
                  ))}
                </div>
              )}
            </Link>
          </Card>
        ))}
      </div>
      {inactive.length > 0 && (
        <div className="mt-6"><h2 className="mb-2 text-sm font-semibold text-muted">Inativos</h2>
          <div className="flex flex-wrap gap-2">{inactive.map(c => <Link key={c.id} href={`/cartoes/${c.id}`} className="rounded-xl border border-border px-3 py-2 text-sm text-muted">{c.name}</Link>)}</div>
        </div>
      )}
    </div>
  );
}
