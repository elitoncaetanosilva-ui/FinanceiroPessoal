import AccountForm from '@/components/cadastros/AccountForm';
import { Card, PageHeader } from '@/components/ui';
import { today } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { listInstitutions } from '@/server/domain/catalog';

export const metadata = { title: 'Nova conta' };

export default async function NovaConta({ searchParams }: { searchParams: Promise<{ voltar?: string; nome?: string; agencia?: string; conta?: string; banco?: string; saldo?: string; data?: string }> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const inst = (await listInstitutions(ctx)).filter(i => i.is_active);
  const bank = sp.banco ? inst.find(i => i.name.toLowerCase() === sp.banco!.toLowerCase()) : undefined;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nova conta" back={sp.voltar || '/contas'} />
      <Card>
        <AccountForm institutions={inst} back={sp.voltar} today={today()}
          values={{ name: sp.nome, branch: sp.agencia, number: sp.conta, institution_id: bank?.id,
            opening_balance_cents: sp.saldo ? Number(sp.saldo) : undefined, opening_balance_date: sp.data }} />
      </Card>
    </div>
  );
}
