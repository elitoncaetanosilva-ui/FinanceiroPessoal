import NewMovementForm, { type Tipo } from '@/components/movements/NewMovementForm';
import { Card, Empty, ButtonLink, PageHeader } from '@/components/ui';
import { fmtMonth } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { readCtx } from '@/server/context';
import { statementViews } from '@/server/domain/cards';
import { categoryIndex, listAccounts, listCards, pickerCategories, recentCategoryIds } from '@/server/domain/catalog';

export const metadata = { title: 'Novo lançamento' };
const TIPOS: Tipo[] = ['despesa', 'receita', 'cartao', 'transferencia', 'pagamento', 'ajuste'];

export default async function Novo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const [accounts, cards, idx, recent] = await Promise.all([listAccounts(ctx, true), listCards(ctx, true), categoryIndex(ctx), recentCategoryIds(ctx)]);
  if (!accounts.length && !cards.length) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Novo lançamento" back="/" />
        <Empty title="Cadastre uma conta ou um cartão primeiro" action={<div className="flex justify-center gap-2"><ButtonLink href="/contas/nova?voltar=/movimentos/novo">Nova conta</ButtonLink><ButtonLink variant="secondary" href="/cartoes/novo?voltar=/movimentos/novo">Novo cartão</ButtonLink></div>} />
      </div>
    );
  }
  const statements = [];
  for (const c of cards) {
    for (const s of await statementViews(ctx, c.id)) {
      if (s.status === 'PAID' || s.status === 'FUTURE') continue;
      statements.push({ id: s.id, card_id: c.id, remaining: s.remaining, label: `${fmtMonth(s.due_month)} · falta ${formatBRL(Math.max(0, s.remaining))}` });
    }
  }
  const tipo = TIPOS.includes(sp.tipo as Tipo) ? (sp.tipo as Tipo) : 'despesa';
  return (
    <div className="max-w-2xl">
      <PageHeader title="Novo lançamento" back="/movimentos" />
      <Card>
        <NewMovementForm initialTipo={tipo} categories={pickerCategories(idx)} recent={recent} statements={statements}
          accounts={accounts.map(a => ({ id: a.id, name: a.name, kind: 'a' as const }))}
          cards={cards.map(c => ({ id: c.id, name: c.name, kind: 'c' as const, closing_day: c.closing_day, due_day: c.due_day, payment_account_id: c.payment_account_id }))}
          defaults={{ account: sp.conta, card: sp.cartao, statement: sp.fatura, amount: sp.valor ? Number(sp.valor) : undefined }} />
      </Card>
    </div>
  );
}
