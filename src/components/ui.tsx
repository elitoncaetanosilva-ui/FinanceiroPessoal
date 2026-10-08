import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { formatBRL } from '@/lib/money';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** Valor em reais. `tone`: auto (verde/laranja pelo sinal), income, expense, neutral. */
export function Money({ cents, tone = 'neutral', signed = false, className, strong }: {
  cents: number; tone?: 'auto' | 'income' | 'expense' | 'neutral' | 'muted'; signed?: boolean; className?: string; strong?: boolean;
}) {
  const t = tone === 'auto' ? (cents > 0 ? 'income' : cents < 0 ? 'expense' : 'neutral') : tone;
  const color = { income: 'text-income', expense: 'text-expense', neutral: '', muted: 'text-muted' }[t];
  const text = signed && cents > 0 ? '+' + formatBRL(cents) : formatBRL(cents);
  return <span className={cx('money tnum whitespace-nowrap', color, strong && 'font-semibold', className)}>{text}</span>;
}

export function Card({ children, className, ...rest }: ComponentProps<'section'>) {
  return <section {...rest} className={cx('rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow)]', className)}>{children}</section>;
}

export function CardTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-2', className)}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-strong',
  secondary: 'bg-surface-2 text-text hover:brightness-95 border border-border',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-white hover:brightness-95',
};
export const buttonClass = (v: BtnVariant = 'primary', size: 'md' | 'sm' | 'lg' = 'md') =>
  cx('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:opacity-50 disabled:pointer-events-none select-none',
    size === 'sm' ? 'h-9 px-3 text-sm' : size === 'lg' ? 'h-13 px-5 text-base' : 'h-11 px-4 text-[15px]', btn[v]);

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<'button'> & { variant?: BtnVariant; size?: 'md' | 'sm' | 'lg' }) {
  return <button {...rest} className={cx(buttonClass(variant, size), className)} />;
}
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: 'md' | 'sm' | 'lg' }) {
  return <Link {...rest} className={cx(buttonClass(variant, size), className)} />;
}

const fieldBase = 'w-full rounded-xl border border-border bg-surface px-3 text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-60';
export const inputClass = `h-11 ${fieldBase}`;
export const textareaClass = `min-h-20 py-2 ${fieldBase}`;

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'warning' | 'danger' | 'planned' | 'income'; className?: string }) {
  const t = {
    neutral: 'bg-surface-2 text-muted',
    primary: 'bg-primary-soft text-primary',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    planned: 'bg-planned-soft text-planned',
    income: 'bg-primary-soft text-income',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', t, className)}>{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {back && <Link href={back} className="mb-1 inline-block text-sm text-primary">‹ Voltar</Link>}
        <h1 className="truncate text-xl font-bold lg:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Barra O/R/P: realizado sólido, previsto hachurado, marcador do orçado. */
export function BudgetBar({ budget, realized, planned, className }: { budget: number; realized: number; planned: number; className?: string }) {
  const max = Math.max(budget, realized + planned, 1);
  const r = Math.max(0, (realized / max) * 100), p = Math.max(0, (planned / max) * 100), b = (budget / max) * 100;
  const over = realized + planned > budget && budget > 0;
  return (
    <div className={cx('relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={cx('absolute inset-y-0 left-0', over ? 'bg-expense' : 'bg-primary')} style={{ width: `${r}%` }} />
      <div className="hatch absolute inset-y-0 opacity-80" style={{ left: `${r}%`, width: `${p}%` }} />
      {budget > 0 && <div className="absolute inset-y-[-2px] w-0.5 bg-text" style={{ left: `calc(${Math.min(b, 100)}% - 1px)` }} />}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
}
