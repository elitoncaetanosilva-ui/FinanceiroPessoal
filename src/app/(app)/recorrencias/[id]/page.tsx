import { notFound } from 'next/navigation';
import { deactivateRecurringAction } from '@/app/actions/recurring';
import { ActionButton } from '@/components/forms';
import RecurringForm from '@/components/RecurringForm';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import { readCtx } from '@/server/context';
import { categoryIndex, listAccounts, listCards, pickerCategories } from '@/server/domain/catalog';
import { listRules } from '@/server/domain/recurring';

export default async function Editar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await readCtx();
  const rule = (await listRules(ctx)).find(r => r.id === id);
  if (!rule) notFound();
  const [accounts, cards, idx] = await Promise.all([listAccounts(ctx, true), listCards(ctx, true), categoryIndex(ctx)]);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={rule.description} back="/recorrencias" actions={<ButtonLink size="sm" variant="secondary" href={`/movimentos?regra=${id}`}>Ocorrências</ButtonLink>} />
      <Card><RecurringForm values={rule} accounts={accounts} cards={cards} categories={pickerCategories(idx)} /></Card>
      <p className="text-xs text-muted">Salvar recalcula as ocorrências previstas futuras; as já realizadas não mudam.</p>
      {rule.is_active && <ActionButton run={deactivateRecurringAction.bind(null, id)} confirm="Confirmar: desativar">Desativar recorrência</ActionButton>}
    </div>
  );
}
