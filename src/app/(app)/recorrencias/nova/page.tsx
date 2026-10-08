import RecurringForm from '@/components/RecurringForm';
import { Card, PageHeader } from '@/components/ui';
import { readCtx } from '@/server/context';
import { categoryIndex, listAccounts, listCards, pickerCategories } from '@/server/domain/catalog';

export const metadata = { title: 'Nova recorrência' };

export default async function Nova() {
  const ctx = await readCtx();
  const [accounts, cards, idx] = await Promise.all([listAccounts(ctx, true), listCards(ctx, true), categoryIndex(ctx)]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nova recorrência" back="/recorrencias" />
      <Card><RecurringForm accounts={accounts} cards={cards} categories={pickerCategories(idx)} /></Card>
    </div>
  );
}
