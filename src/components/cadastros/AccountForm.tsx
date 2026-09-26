'use client';
import { saveAccountAction } from '@/app/actions/cadastros';
import { ActionForm } from '@/components/forms';
import { Field, inputClass } from '@/components/ui';
import { formatNum } from '@/lib/money';

const TYPES = [
  ['CHECKING', 'Conta corrente'], ['DIGITAL', 'Conta digital'], ['SAVINGS', 'Poupança'], ['INVESTMENT', 'Investimento'],
  ['WALLET', 'Carteira digital'], ['CASH', 'Dinheiro'], ['OTHER', 'Outros'],
];

export interface AccountFormValues {
  id?: string; name?: string; type?: string; institution_id?: string | null; branch?: string | null; number?: string | null;
  opening_balance_cents?: number; opening_balance_date?: string; in_available_balance?: boolean;
}

export default function AccountForm({ values = {}, institutions, back, today }: {
  values?: AccountFormValues; institutions: { id: string; name: string }[]; back?: string; today: string;
}) {
  return (
    <ActionForm action={saveAccountAction}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {back && <input type="hidden" name="back" value={back} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome da conta"><input name="name" required defaultValue={values.name} className={inputClass} placeholder="Ex.: Itaú conta corrente" /></Field>
        <Field label="Instituição">
          <select name="institution_id" defaultValue={values.institution_id ?? ''} className={inputClass}>
            <option value="">—</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select name="type" defaultValue={values.type ?? 'CHECKING'} className={inputClass}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agência"><input name="branch" defaultValue={values.branch ?? ''} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Conta"><input name="number" defaultValue={values.number ?? ''} className={inputClass} /></Field>
        </div>
        <Field label="Saldo inicial (R$)" hint="Saldo no FIM do dia informado ao lado. Pode ser negativo.">
          <input name="opening_balance" inputMode="decimal" defaultValue={values.opening_balance_cents != null ? formatNum(values.opening_balance_cents) : '0,00'} className={inputClass} />
        </Field>
        <Field label="Data do saldo inicial" hint="Lançamentos até esta data não alteram o saldo (histórico).">
          <input name="opening_balance_date" type="date" required defaultValue={values.opening_balance_date ?? today} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-border p-3">
        <input type="checkbox" name="in_available_balance" defaultChecked={values.in_available_balance ?? true} className="mt-1 h-5 w-5 accent-[var(--primary)]" />
        <span><span className="font-medium">Somar no saldo disponível</span><span className="block text-sm text-muted">Desmarque para investimentos: entram no patrimônio, não no disponível.</span></span>
      </label>
    </ActionForm>
  );
}
