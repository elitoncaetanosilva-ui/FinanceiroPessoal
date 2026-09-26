import Link from 'next/link';
import { copyYearAction } from '@/app/actions/budget';
import BudgetGrid from '@/components/budget/BudgetGrid';
import { ActionButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { today } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { budgetItems } from '@/server/domain/budget';
import { categoryIndex } from '@/server/domain/catalog';

export const metadata = { title: 'Orçamento anual' };

export default async function EditarOrcamento({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const sp = await searchParams;
  const year = Number(sp.ano) || Number(today().slice(0, 4));
  const ctx = await readCtx();
  const [idx, items, prev] = await Promise.all([categoryIndex(ctx), budgetItems(ctx, year), budgetItems(ctx, year - 1)]);
  const groups = idx.groups.filter(g => !g.is_hidden && g.is_active).map(g => ({
    id: g.id, name: g.name, section: g.section,
    subs: (idx.children.get(g.id) ?? []).filter(c => !c.is_hidden && (c.is_active || items.has(c.id))).map(c => ({ id: c.id, name: c.name })),
  }));
  return (
    <div>
      <PageHeader title={`Orçamento ${year}`} back="/orcamento" subtitle="Valores mensais por subcategoria. No notebook, passe o mouse numa célula para aplicar o valor aos meses seguintes."
        actions={<div className="flex items-center gap-1 text-sm"><Link className="rounded-lg px-2 py-1 hover:bg-surface-2" href={`/orcamento/editar?ano=${year - 1}`}>‹ {year - 1}</Link><Link className="rounded-lg px-2 py-1 hover:bg-surface-2" href={`/orcamento/editar?ano=${year + 1}`}>{year + 1} ›</Link></div>} />
      {prev.size > 0 && (
        <div className="mb-3">
          <ActionButton run={copyYearAction.bind(null, year - 1, year)} confirm={items.size ? `Sobrescrever com ${year - 1}?` : undefined}>Copiar orçamento de {year - 1}</ActionButton>
        </div>
      )}
      <BudgetGrid year={year} groups={groups} values={Object.fromEntries(items)} />
    </div>
  );
}
