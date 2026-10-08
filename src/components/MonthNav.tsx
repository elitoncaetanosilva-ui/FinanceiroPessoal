import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, fmtMonthLong, monthStart, today, type ISODate } from '@/lib/dates';

/** Seletor de mês por link (?mes=YYYY-MM), preservando os outros parâmetros. */
export function MonthNav({ month, basePath, params = {} }: { month: ISODate; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (m: ISODate) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    sp.set('mes', m.slice(0, 7));
    return `${basePath}?${sp.toString()}`;
  };
  const isCurrent = monthStart(today()) === month;
  return (
    <div className="flex items-center gap-1">
      <Link href={href(addMonths(month, -1, 1))} aria-label="Mês anterior" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><ChevronLeft size={20} /></Link>
      <Link href={href(monthStart(today()))} className="min-w-36 text-center font-semibold">
        {cap(fmtMonthLong(month))}{!isCurrent && <span className="block text-[11px] font-normal text-primary">voltar para hoje</span>}
      </Link>
      <Link href={href(addMonths(month, 1, 1))} aria-label="Próximo mês" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><ChevronRight size={20} /></Link>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthParam(v: string | string[] | undefined): ISODate {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : monthStart(today());
}
