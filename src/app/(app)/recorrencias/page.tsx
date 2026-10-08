import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge, ButtonLink, Empty, Money, PageHeader, cx } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { FREQUENCY_LABEL, listRules } from '@/server/domain/recurring';

export const metadata = { title: 'Recorrências' };

export default async function Recorrencias() {
  const rules = await listRules(await readCtx());
  return (
    <div className="max-w-3xl">
      <PageHeader title="Recorrências" subtitle="Salário, aluguel, escola, assinaturas… alimentam o Previsto, o orçamento e a projeção de caixa."
        actions={<ButtonLink href="/recorrencias/nova" size="sm"><Plus size={16} /> Nova</ButtonLink>} />
      {rules.length === 0 ? <Empty title="Nenhuma recorrência" action={<ButtonLink href="/recorrencias/nova">Cadastrar</ButtonLink>}>Cadastre o que se repete para ver quanto ainda vai entrar e sair.</Empty> : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {rules.map(r => (
            <li key={r.id}>
              <Link href={`/recorrencias/${r.id}`} className={cx('flex items-center justify-between gap-3 p-3 hover:bg-surface-2', !r.is_active && 'opacity-50')}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.description}</span>
                  <span className="block truncate text-xs text-muted">{FREQUENCY_LABEL[r.frequency]} · {r.holder_name}{r.category_label ? ` · ${r.category_label}` : ''}{r.next_date ? ` · próxima ${fmtDate(r.next_date)}` : ''}</span>
                </span>
                <span className="text-right"><Money cents={r.amount_cents} tone="auto" className="font-semibold" />{!r.is_active && <Badge className="ml-1">inativa</Badge>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
