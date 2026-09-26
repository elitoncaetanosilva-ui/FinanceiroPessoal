import CardForm from '@/components/cadastros/CardForm';
import { Card, PageHeader } from '@/components/ui';
import { readCtx } from '@/server/context';
import { listAccounts, listInstitutions } from '@/server/domain/catalog';

export const metadata = { title: 'Novo cartão' };

const DEFAULT_PATTERNS: Record<string, string[]> = { 'itaú': ['FATURA ITAU'], nubank: ['NU PAGAMENT'], sicredi: ['FATURA SICREDI'], 'mercado pago': ['MERCADO PAGO FATURA'] };

export default async function NovoCartao({ searchParams }: { searchParams: Promise<{ voltar?: string; nome?: string; final?: string; banco?: string; vencimento?: string; finais?: string }> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const [inst, accounts] = await Promise.all([listInstitutions(ctx), listAccounts(ctx, true)]);
  const bank = sp.banco ? inst.find(i => i.name.toLowerCase() === sp.banco!.toLowerCase()) : undefined;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Novo cartão" back={sp.voltar || '/cartoes'} />
      <Card>
        <CardForm institutions={inst.filter(i => i.is_active)} accounts={accounts} back={sp.voltar}
          values={{ name: sp.nome, last4: sp.final, institution_id: bank?.id, due_day: sp.vencimento ? Number(sp.vencimento) : undefined,
            extra_last4: sp.finais ? sp.finais.split(',') : [], payment_patterns: bank ? DEFAULT_PATTERNS[bank.name.toLowerCase()] ?? [] : [],
            payment_account_id: accounts.find(a => a.institution_id && a.institution_id === bank?.id)?.id }} />
      </Card>
    </div>
  );
}
