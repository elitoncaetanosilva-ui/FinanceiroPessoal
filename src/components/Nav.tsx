'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITENS = [
  { href: '/', label: 'Painel' },
  { href: '/fluxo', label: 'Fluxo de caixa' },
  { href: '/lancamentos', label: 'Lançamentos' },
  { href: '/cartoes', label: 'Cartões' },
  { href: '/insights', label: 'Insights' },
  { href: '/conexoes', label: 'Dados & bancos' },
];

export function Nav({ pendentes }: { pendentes: number }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      {ITENS.map(i => {
        const ativo = i.href === '/' ? path === '/' : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={ativo ? 'page' : undefined}>
            {i.label}
            {i.href === '/lancamentos' && pendentes > 0 && <span className="badge badge-warn" title="Para revisar">{pendentes}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
