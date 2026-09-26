'use client';
import { useState } from 'react';
import { saveRecurringAction } from '@/app/actions/recurring';
import { CategoryPicker, type PickerCategory } from '@/components/CategoryPicker';
import { ActionForm } from '@/components/forms';
import { Field, inputClass } from '@/components/ui';
import { formatNum } from '@/lib/money';
import { today } from '@/lib/dates';

export interface RecurringValues {
  id?: string; description?: string; amount_cents?: number; account_id?: string | null; card_id?: string | null; category_id?: string | null;
  frequency?: string; interval_count?: number; interval_unit?: string; start_date?: string; end_date?: string | null; day_of_month?: number | null;
  match_pattern?: string | null; amount_tolerance_pct?: number;
}

export default function RecurringForm({ values = {}, accounts, cards, categories }: {
  values?: RecurringValues; accounts: { id: string; name: string }[]; cards: { id: string; name: string }[]; categories: PickerCategory[];
}) {
  const [freq, setFreq] = useState(values.frequency ?? 'MONTHLY');
  const [dir, setDir] = useState(values.amount_cents != null && values.amount_cents > 0 ? 'in' : 'out');
  return (
    <ActionForm action={saveRecurringAction}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="flex gap-2">
        {[['out', 'Despesa'], ['in', 'Receita']].map(([v, l]) => (
          <label key={v} className={`flex-1 rounded-xl border p-3 text-center text-sm font-medium ${dir === v ? 'border-primary bg-primary-soft text-primary' : 'border-border'}`}>
            <input type="radio" name="direction" value={v} checked={dir === v} onChange={() => setDir(v)} className="sr-only" />{l}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Descrição"><input name="description" required defaultValue={values.description} className={inputClass} placeholder="Ex.: Aluguel" /></Field>
        <Field label="Valor (R$)"><input name="amount" required inputMode="decimal" defaultValue={values.amount_cents ? formatNum(Math.abs(values.amount_cents)) : ''} className={inputClass} /></Field>
        <div className="sm:col-span-2"><span className="mb-1 block text-sm font-medium text-muted">Categoria</span>
          <CategoryPicker name="category_id" categories={categories} value={values.category_id} prefer={dir === 'in' ? 'IN' : 'OUT'} />
        </div>
        <Field label="Conta ou cartão">
          <select name="holder" defaultValue={values.card_id ? `c:${values.card_id}` : values.account_id ? `a:${values.account_id}` : accounts[0] ? `a:${accounts[0].id}` : ''} className={inputClass} required>
            <optgroup label="Contas">{accounts.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>
            {cards.length > 0 && <optgroup label="Cartões">{cards.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
          </select>
        </Field>
        <Field label="Frequência">
          <select name="frequency" value={freq} onChange={e => setFreq(e.target.value)} className={inputClass}>
            <option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option>
            <option value="YEARLY">Anual</option><option value="CUSTOM">Personalizada</option>
          </select>
        </Field>
        {freq === 'CUSTOM' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="A cada"><input name="interval_count" type="number" min={1} defaultValue={values.interval_count ?? 2} className={inputClass} /></Field>
            <Field label="Unidade"><select name="interval_unit" defaultValue={values.interval_unit ?? 'MONTH'} className={inputClass}><option value="DAY">dias</option><option value="WEEK">semanas</option><option value="MONTH">meses</option><option value="YEAR">anos</option></select></Field>
          </div>
        )}
        <Field label={freq === 'MONTHLY' || freq === 'CUSTOM' ? 'Início (1ª ocorrência)' : 'Primeira data'}><input name="start_date" type="date" required defaultValue={values.start_date ?? today()} className={inputClass} /></Field>
        {(freq === 'MONTHLY' || freq === 'CUSTOM') && <Field label="Dia do vencimento"><input name="day_of_month" type="number" min={1} max={31} defaultValue={values.day_of_month ?? ''} className={inputClass} /></Field>}
        <Field label="Fim (opcional)"><input name="end_date" type="date" defaultValue={values.end_date ?? ''} className={inputClass} /></Field>
        <Field label="Trecho da descrição no extrato (opcional)" hint="Ajuda a reconhecer o pagamento real na importação. Ex.: TOMASI IMOVEIS">
          <input name="match_pattern" defaultValue={values.match_pattern ?? ''} className={inputClass} />
        </Field>
        <Field label="Tolerância de valor (%)"><input name="tolerance" type="number" min={0} max={100} defaultValue={values.amount_tolerance_pct ?? 10} className={inputClass} /></Field>
      </div>
      <p className="text-xs text-muted">Gera lançamentos previstos para os próximos 13 meses. Quando o real é importado (mesma conta, data próxima, valor dentro da tolerância), o previsto é realizado em vez de duplicado.</p>
    </ActionForm>
  );
}
