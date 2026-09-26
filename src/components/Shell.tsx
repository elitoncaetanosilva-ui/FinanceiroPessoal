'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight, ChartLine, CreditCard, Ellipsis, FileUp, FolderTree, House, Inbox, Landmark, ListOrdered, Minus,
  Plus, Repeat, Scale, Settings, Target, TrendingUp, Upload, Eye, EyeOff, Receipt,
} from 'lucide-react';
import { cx } from './ui';

const SIDEBAR = [
  { href: '/', label: 'Início', icon: House },
  { href: '/movimentos', label: 'Movimentos', icon: ListOrdered },
  { href: '/pendentes', label: 'Pendentes', icon: Inbox, badge: true },
  { href: '/orcamento', label: 'Orçamento', icon: Target },
  { href: '/projecao', label: 'Projeção de caixa', icon: TrendingUp },
  { href: '/analises', label: 'Análises', icon: ChartLine },
  { href: '/cartoes', label: 'Cartões', icon: CreditCard },
  { href: '/contas', label: 'Contas', icon: Landmark },
  { href: '/importacoes', label: 'Importações', icon: Upload },
  { href: '/recorrencias', label: 'Recorrências', icon: Repeat },
  { href: '/cadastros', label: 'Cadastros', icon: FolderTree },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

export const QUICK_ACTIONS = [
  { href: '/movimentos/novo?tipo=despesa', label: 'Nova despesa', icon: Minus, tone: 'text-expense' },
  { href: '/movimentos/novo?tipo=receita', label: 'Nova receita', icon: Plus, tone: 'text-income' },
  { href: '/movimentos/novo?tipo=cartao', label: 'Compra no cartão', icon: CreditCard, tone: 'text-primary' },
  { href: '/movimentos/novo?tipo=transferencia', label: 'Transferência', icon: ArrowLeftRight, tone: 'text-primary' },
  { href: '/movimentos/novo?tipo=pagamento', label: 'Pagamento de fatura', icon: Receipt, tone: 'text-primary' },
  { href: '/importacoes', label: 'Importar arquivo', icon: FileUp, tone: 'text-primary' },
  { href: '/movimentos/novo?tipo=ajuste', label: 'Ajuste de saldo', icon: Scale, tone: 'text-muted' },
];

const active = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

export function PrivacyToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(document.documentElement.dataset.privacy === 'on'); }, []);
  const toggle = () => {
    const v = !on;
    setOn(v);
    if (v) document.documentElement.dataset.privacy = 'on'; else delete document.documentElement.dataset.privacy;
    try { localStorage.setItem('fp.privacy', v ? 'on' : 'off'); } catch { /* sem armazenamento */ }
  };
  return (
    <button type="button" onClick={toggle} aria-label={on ? 'Mostrar valores' : 'Ocultar valores'} title={on ? 'Mostrar valores' : 'Ocultar valores'}
      className={cx('inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2', className)}>
      {on ? <EyeOff size={20} /> : <Eye size={20} />}
    </button>
  );
}

function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
      <div className="p-4 pb-safe">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
        <h2 className="mb-3 text-lg font-semibold">Adicionar</h2>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(a => (
            <Link key={a.href} href={a.href} onClick={onClose}
              className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-3 font-medium active:scale-[.98]">
              <a.icon size={22} className={a.tone} />
              <span className="leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-3 h-11 w-full rounded-xl text-muted">Fechar</button>
      </div>
    </dialog>
  );
}

export default function Shell({ children, pending, userName }: { children: React.ReactNode; pending: number; userName: string }) {
  const path = usePathname();
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setSheet(false); }, [path]);
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return (
    <div className="lg:flex">
      {/* Barra lateral (notebook) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-bold text-on-primary">F</span>
          <span className="text-lg font-bold">Finanças</span>
        </Link>
        <button type="button" onClick={() => setSheet(true)} className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary font-medium text-on-primary hover:bg-primary-strong">
          <Plus size={18} /> Adicionar
        </button>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {SIDEBAR.map(i => (
            <Link key={i.href} href={i.href}
              className={cx('flex h-10 items-center gap-3 rounded-xl px-3 text-[15px]', active(path, i.href) ? 'bg-primary-soft font-semibold text-primary' : 'text-text hover:bg-surface-2')}>
              <i.icon size={18} />
              <span className="flex-1">{i.label}</span>
              {i.badge && pending > 0 && <span className="rounded-full bg-warning-soft px-2 text-xs font-semibold text-warning">{pending}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-3 flex items-center justify-between border-t border-border px-2 pt-3 text-sm text-muted">
          <span className="truncate">{userName}</span>
          <PrivacyToggle />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 lg:px-8 lg:pb-10 lg:pt-6">{children}</main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-safe lg:hidden" aria-label="Navegação principal">
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center">
          <BottomLink href="/" label="Início" icon={House} path={path} />
          <BottomLink href="/movimentos" label="Movimentos" icon={ListOrdered} path={path} badge={pending} />
          <div className="flex justify-center">
            <button type="button" onClick={() => setSheet(true)} aria-label="Adicionar"
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg active:scale-95">
              <Plus size={28} />
            </button>
          </div>
          <BottomLink href="/orcamento" label="Orçamento" icon={Target} path={path} />
          <BottomLink href="/mais" label="Mais" icon={Ellipsis} path={path} alsoActive={['/cartoes', '/contas', '/importacoes', '/pendentes', '/projecao', '/analises', '/recorrencias', '/cadastros', '/configuracoes']} />
        </div>
      </nav>
      <QuickSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

function BottomLink({ href, label, icon: Icon, path, badge, alsoActive = [] }: {
  href: string; label: string; icon: typeof House; path: string; badge?: number; alsoActive?: string[];
}) {
  const on = active(path, href) || alsoActive.some(a => active(path, a));
  return (
    <Link href={href} className={cx('relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px]', on ? 'font-semibold text-primary' : 'text-muted')}>
      <Icon size={22} />
      <span>{label}</span>
      {!!badge && badge > 0 && (
        <span className="absolute right-[18%] top-1.5 min-w-5 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-5 text-white">{badge > 99 ? '99+' : badge}</span>
      )}
    </Link>
  );
}
