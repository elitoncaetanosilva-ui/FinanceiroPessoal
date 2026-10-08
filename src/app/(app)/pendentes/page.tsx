import PendingTriage, { type PendingItem } from '@/components/pending/PendingTriage';
import { PageHeader } from '@/components/ui';
import { readCtx } from '@/server/context';
import { categoryIndex, listCards, pickerCategories, recentCategoryIds } from '@/server/domain/catalog';

export const metadata = { title: 'Pendentes' };

export default async function Pendentes() {
  const ctx = await readCtx();
  const [idx, recent, cards] = await Promise.all([categoryIndex(ctx), recentCategoryIds(ctx, 10), listCards(ctx, true)]);
  const items = await ctx.q.query<PendingItem>(
    `select m.id, m.date, m.description, m.amount_cents, coalesce(a.name, c.name) as holder, (m.account_id is not null) as is_account,
       m.suggested_category_id, m.suggestion_source, m.status,
       case when m.installment_total > 1 then m.installment_number || '/' || m.installment_total end as installment
     from movements m left join accounts a on a.id=m.account_id left join credit_cards c on c.id=m.card_id
     where m.user_id=$1 and m.deleted_at is null and m.status<>'CANCELLED' and m.kind in ('NORMAL','TRANSFER')
       and exists (select 1 from movement_splits s where s.movement_id=m.id and s.category_id is null)
       and (select count(*) from movement_splits s where s.movement_id=m.id) = 1
       and not (m.status='PLANNED' and m.installment_group_id is not null)
     order by m.date desc limit 300`,
    [ctx.userId],
  );
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Pendentes de classificação" subtitle="Toque na sugestão ou numa categoria. Com “aplicar a semelhantes”, o app aprende para as próximas importações." />
      <PendingTriage items={items} categories={pickerCategories(idx)} recent={recent} cards={cards.map(c => ({ id: c.id, name: c.name }))} transferCategoryId={idx.system('TRANSFER').id} />
    </div>
  );
}
