import Link from 'next/link';
import { ChartLine, CreditCard, FolderTree, Inbox, Landmark, LogOut, Repeat, Settings, TrendingUp, Upload } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Mais' };

const ITEMS = [
  { href: '/cartoes', label: 'Cartões', desc: 'Faturas, limite e parcelas', icon: CreditCard },
  { href: '/contas', label: 'Contas', desc: 'Saldos e conferência', icon: Landmark },
  { href: '/pendentes', label: 'Pendentes', desc: 'Classificar lançamentos', icon: Inbox },
  { href: '/importacoes', label: 'Importações', desc: 'Extratos e faturas', icon: Upload },
  { href: '/projecao', label: 'Projeção de caixa', desc: '30, 60, 90 dias e 12 meses', icon: TrendingUp },
  { href: '/analises', label: 'Análises', desc: 'Gráficos e tendências', icon: ChartLine },
  { href: '/recorrencias', label: 'Recorrências', desc: 'Salário, aluguel, assinaturas', icon: Repeat },
  { href: '/cadastros', label: 'Cadastros', desc: 'Categorias, regras, bancos', icon: FolderTree },
  { href: '/configuracoes', label: 'Configurações', desc: 'Senha, dados, planilha', icon: Settings },
];

export default function Mais() {
  return (
    <div>
      <PageHeader title="Mais" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ITEMS.map(i => (
          <Link key={i.href} href={i.href} className="flex min-h-24 flex-col justify-between rounded-2xl border border-border bg-surface p-3 active:scale-[.98]">
            <i.icon size={24} className="text-primary" />
            <span>
              <span className="block font-semibold">{i.label}</span>
              <span className="block text-xs text-muted">{i.desc}</span>
            </span>
          </Link>
        ))}
      </div>
      <form action={logoutAction} className="mt-6">
        <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border text-muted"><LogOut size={18} /> Sair</button>
      </form>
    </div>
  );
}
