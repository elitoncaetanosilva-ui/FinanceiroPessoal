import Link from 'next/link';
import { Building2, CreditCard, FolderTree, Landmark, Repeat, WandSparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Cadastros' };

const ITEMS = [
  { href: '/contas', label: 'Contas', desc: 'Contas bancárias, carteiras e investimentos', icon: Landmark },
  { href: '/cartoes', label: 'Cartões de crédito', desc: 'Limite, fechamento, vencimento', icon: CreditCard },
  { href: '/cadastros/categorias', label: 'Categorias e subcategorias', desc: 'Árvore e natureza econômica', icon: FolderTree },
  { href: '/cadastros/regras', label: 'Regras de classificação', desc: 'Reconhecimento automático', icon: WandSparkles },
  { href: '/cadastros/bancos', label: 'Bancos e instituições', desc: 'Instituições financeiras', icon: Building2 },
  { href: '/recorrencias', label: 'Recorrências', desc: 'Lançamentos que se repetem', icon: Repeat },
];

export default function Cadastros() {
  return (
    <div>
      <PageHeader title="Cadastros" subtitle="Tudo pode ser editado, ativado ou inativado. Itens com lançamentos nunca são apagados." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(i => (
          <Link key={i.href} href={i.href} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2">
            <i.icon className="text-primary" size={24} />
            <span><span className="block font-semibold">{i.label}</span><span className="text-sm text-muted">{i.desc}</span></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
