import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { deleteCheckpointAction, saveCheckpointAction, setAccountActiveAction } from '@/app/actions/cadastros';
import AccountForm from '@/components/cadastros/AccountForm';
import { ActionButton, ActionForm } from '@/components/forms';
import { ButtonLink, Card, CardTitle, Field, Money, PageHeader, inputClass } from '@/components/ui';
import { addDays, fmtDate, monthStart, today } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { accountBalances, checkpointsReport } from '@/server/domain/balances';
import { listInstitutions } from '@/server/domain/catalog';
import { ACCOUNT_TYPES } from '@/server/domain/types';

export default async function Conta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await readCtx();
  const a = (await accountBalances(ctx)).find(x => x.id === id);
  if (!a) notFound();
  const [cps, inst] = await Promise.all([checkpointsReport(ctx, id), listInstitutions(ctx)]);
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={a.name} subtitle={[a.institution_name, ACCOUNT_TYPES[a.type], a.branch && `ag. ${a.branch}`, a.number && `cc ${a.number}`].filter(Boolean).join(' · ')} back="/contas"
        actions={<ButtonLink size="sm" variant="secondary" href={`/movimentos?conta=${a.id}`}>Lançamentos</ButtonLink>} />
      <Card>
        <p className="text-sm text-muted">Saldo atual</p>
        <p className="text-3xl font-bold"><Money cents={a.balance_cents} tone={a.balance_cents < 0 ? 'expense' : 'neutral'} /></p>
        <p className="mt-1 text-sm text-muted">Saldo inicial <Money cents={a.opening_balance_cents} /> em {fmtDate(a.opening_balance_date)}{a.last_movement_date && ` · último lançamento em ${fmtDate(a.last_movement_date)}`}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink size="sm" href={`/movimentos/novo?tipo=ajuste&conta=${a.id}`} variant="secondary">Ajustar saldo</ButtonLink>
          <ButtonLink size="sm" href={`/movimentos/novo?tipo=transferencia&conta=${a.id}`} variant="secondary">Transferir</ButtonLink>
        </div>
      </Card>
      <Card>
        <CardTitle>Conferência com o banco</CardTitle>
        <p className="mb-2 text-sm text-muted">Saldos do banco (dos extratos importados ou informados por você) comparados com o saldo calculado pelo app.</p>
        {cps.length > 0 && (
          <ul className="mb-3 divide-y divide-border text-sm">
            {cps.slice(0, 15).map(c => (
              <li key={c.date} className="flex items-center justify-between gap-2 py-2">
                <span>{fmtDate(c.date)}{c.source === 'MANUAL' && <span className="text-xs text-muted"> · informado</span>}</span>
                <span className="flex items-center gap-2">
                  <Money cents={c.balance_cents} />
                  {c.diff === 0 ? <CircleCheck size={16} className="text-income" /> : <span className="flex items-center gap-1 text-danger"><TriangleAlert size={16} /> <Money cents={c.diff} signed /></span>}
                  {c.source === 'MANUAL' && <ActionButton run={deleteCheckpointAction.bind(null, a.id, c.date)} confirm="Remover?" variant="ghost">×</ActionButton>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {cps.some(c => c.diff !== 0) && <p className="mb-3 text-sm text-muted">Diferença? Verifique lançamentos faltando ou duplicados até essa data. Se for uma correção real, use <Link className="text-primary" href={`/movimentos/novo?tipo=ajuste&conta=${a.id}`}>Ajustar saldo</Link>.</p>}
        <ActionForm action={saveCheckpointAction} submit="Conferir saldo" resetOnSuccess>
          <input type="hidden" name="account_id" value={a.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Saldo no banco em"><input type="date" name="date" required defaultValue={addDays(monthStart(today()), -1)} className={inputClass} /></Field>
            <Field label="Saldo (R$)"><input name="balance" required inputMode="decimal" placeholder="0,00" className={inputClass} /></Field>
          </div>
        </ActionForm>
      </Card>
      <Card>
        <CardTitle>Dados da conta</CardTitle>
        <AccountForm institutions={inst.filter(i => i.is_active || i.id === a.institution_id)} today={today()} values={a} />
      </Card>
      <div>
        {a.is_active
          ? <ActionButton run={setAccountActiveAction.bind(null, a.id, false)} confirm="Confirmar inativação">Inativar conta</ActionButton>
          : <ActionButton run={setAccountActiveAction.bind(null, a.id, true)}>Reativar conta</ActionButton>}
        <p className="mt-1 text-xs text-muted">Contas com lançamentos não são excluídas: ficam inativas e o histórico é mantido.</p>
      </div>
    </div>
  );
}
