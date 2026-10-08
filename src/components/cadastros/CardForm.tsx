'use client';
import { saveCardAction } from '@/app/actions/cadastros';
import { ActionForm } from '@/components/forms';
import { Field, inputClass } from '@/components/ui';
import { formatNum } from '@/lib/money';

export interface CardFormValues {
  id?: string; name?: string; institution_id?: string | null; brand?: string | null; last4?: string | null; extra_last4?: string[];
  limit_cents?: number; closing_day?: number; due_day?: number; payment_account_id?: string | null; payment_patterns?: string[];
}

export default function CardForm({ values = {}, institutions, accounts, back }: {
  values?: CardFormValues; institutions: { id: string; name: string }[]; accounts: { id: string; name: string }[]; back?: string;
}) {
  return (
    <ActionForm action={saveCardAction}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {back && <input type="hidden" name="back" value={back} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome do cartão"><input name="name" required defaultValue={values.name} className={inputClass} placeholder="Ex.: Itaú Black" /></Field>
        <Field label="Instituição">
          <select name="institution_id" defaultValue={values.institution_id ?? ''} className={inputClass}>
            <option value="">—</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Bandeira"><input name="brand" defaultValue={values.brand ?? ''} className={inputClass} placeholder="Mastercard, Visa…" /></Field>
        <Field label="Final do cartão"><input name="last4" defaultValue={values.last4 ?? ''} inputMode="numeric" maxLength={4} className={inputClass} placeholder="1234" /></Field>
        <Field label="Limite (R$)"><input name="limit" inputMode="decimal" defaultValue={values.limit_cents != null ? formatNum(values.limit_cents) : ''} className={inputClass} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia de fechamento"><input name="closing_day" type="number" min={1} max={31} required defaultValue={values.closing_day} className={inputClass} /></Field>
          <Field label="Dia de vencimento"><input name="due_day" type="number" min={1} max={31} required defaultValue={values.due_day} className={inputClass} /></Field>
        </div>
        <Field label="Conta usada para pagar">
          <select name="payment_account_id" defaultValue={values.payment_account_id ?? ''} className={inputClass}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Finais adicionais (virtuais)" hint="Separados por vírgula. Ajudam a reconhecer a fatura na importação.">
          <input name="extra_last4" defaultValue={(values.extra_last4 ?? []).join(', ')} className={inputClass} placeholder="8706, 9849" />
        </Field>
      </div>
      <Field label="Como o pagamento desta fatura aparece no extrato" hint="Trechos separados por vírgula. Ex.: FATURA ITAU UNICLASS, NU PAGAMENT. Esses lançamentos viram pagamento de fatura (nunca despesa).">
        <input name="payment_patterns" defaultValue={(values.payment_patterns ?? []).join(', ')} className={inputClass} />
      </Field>
      <p className="text-xs text-muted">Compras até o dia anterior ao fechamento entram na fatura do mês; a partir do dia do fechamento, na seguinte. As datas reais de cada fatura podem ser ajustadas na tela do cartão.</p>
    </ActionForm>
  );
}
