import Link from 'next/link';
import { ArrowLeftRight, CalendarClock, CircleAlert, CreditCard, Landmark, Receipt, Repeat, Scale, Split } from 'lucide-react';
import { Money, cx } from '@/components/ui';
import { fmtDayMonth } from '@/lib/dates';
import type { MovementListItem } from '@/server/domain/queries';

/** Linha de movimento: card compacto no celular, linha de tabela no notebook (mesmo componente). */
export function MovementItem({ m, showDate = false }: { m: MovementListItem; showDate?: boolean }) {
  const holder = m.account_name ?? m.card_name ?? '';
  const Icon = m.kind === 'TRANSFER' ? ArrowLeftRight : m.kind === 'CARD_PAYMENT' ? Receipt : m.kind === 'ADJUSTMENT' ? Scale : m.card_id ? CreditCard : Landmark;
  const cat = m.pending ? null : m.split_count > 1 ? 'Rateado' : m.category_name;
  const shown = m.category_amount ?? m.amount_cents;
  return (
    <Link href={`/movimentos/${m.id}`} className={cx('flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 active:bg-surface-2', m.status === 'PLANNED' && 'opacity-80')}>
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', m.pending ? 'bg-warning-soft text-warning' : m.status === 'PLANNED' ? 'bg-planned-soft text-planned' : 'bg-surface-2 text-muted')}>
        {m.pending ? <CircleAlert size={18} /> : m.status === 'PLANNED' ? <CalendarClock size={18} /> : <Icon size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{m.description}</span>
        <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
          {showDate && <span>{fmtDayMonth(m.date)} ·</span>}
          {m.pending ? <span className="font-medium text-warning">Classificar</span> : <span className="truncate">{m.group_name ? `${m.group_name} › ` : ''}{cat}</span>}
          {m.split_count > 1 && <Split size={12} />}
          <span className="truncate">· {holder}</span>
          {m.installment_total && m.installment_total > 1 ? <span>· {m.installment_number}/{m.installment_total}</span> : null}
          {m.recurring_rule_id && <Repeat size={12} />}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Money cents={shown} tone={m.kind === 'TRANSFER' || m.kind === 'CARD_PAYMENT' ? 'muted' : 'auto'} className="text-[15px] font-semibold" />
        {m.status === 'PLANNED' && <span className="block text-[10px] font-medium uppercase text-planned">previsto</span>}
      </span>
    </Link>
  );
}

/** Lista agrupada por dia com total do dia. */
export function MovementGroups({ items }: { items: MovementListItem[] }) {
  const groups: { date: string; items: MovementListItem[] }[] = [];
  for (const m of items) {
    const g = groups[groups.length - 1];
    if (g && g.date === m.date) g.items.push(m); else groups.push({ date: m.date, items: [m] });
  }
  return (
    <div className="space-y-3">
      {groups.map(g => {
        const total = g.items.reduce((s, m) => s + (m.kind === 'NORMAL' || m.kind === 'ADJUSTMENT' ? (m.category_amount ?? m.amount_cents) : 0), 0);
        return (
          <section key={g.date} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <header className="flex items-center justify-between bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">
              <span>{dayLabel(g.date)}</span>
              {total !== 0 && <Money cents={total} tone="muted" />}
            </header>
            <div className="divide-y divide-border">{g.items.map(m => <MovementItem key={m.id} m={m} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function dayLabel(d: string) {
  const wd = DIAS[new Date(d + 'T00:00:00Z').getUTCDay()];
  return `${wd}, ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}
