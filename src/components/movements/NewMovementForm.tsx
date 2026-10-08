'use client';
import { useActionState, useMemo, useState } from 'react';
import { ArrowLeftRight, CreditCard, Minus, Plus, Receipt, Scale } from 'lucide-react';
import { createMovementAction } from '@/app/actions/movements';
import { CategoryPicker, type PickerCategory } from '@/components/CategoryPicker';
import { Button, ErrorText, Field, cx, inputClass, textareaClass } from '@/components/ui';
import { dueMonthForPurchase, computeStatementDates } from '@/lib/card-cycle';
import { fmtDate, fmtMonth, today as todayFn } from '@/lib/dates';
import { formatBRL, formatNum, toCents } from '@/lib/money';
import type { ActionResult } from '@/server/context';

export type Tipo = 'despesa' | 'receita' | 'cartao' | 'transferencia' | 'pagamento' | 'ajuste';
const TABS: { id: Tipo; label: string; icon: typeof Minus }[] = [
  { id: 'despesa', label: 'Despesa', icon: Minus },
  { id: 'receita', label: 'Receita', icon: Plus },
  { id: 'cartao', label: 'Cartão', icon: CreditCard },
  { id: 'transferencia', label: 'Transferência', icon: ArrowLeftRight },
  { id: 'pagamento', label: 'Pagar fatura', icon: Receipt },
  { id: 'ajuste', label: 'Ajuste', icon: Scale },
];

export interface Holder { id: string; name: string; kind: 'a' | 'c'; closing_day?: number; due_day?: number; payment_account_id?: string | null }
export interface OpenStatement { id: string; card_id: string; label: string; remaining: number }

export default function NewMovementForm({ initialTipo, accounts, cards, categories, recent, statements, defaults }: {
  initialTipo: Tipo; accounts: Holder[]; cards: Holder[]; categories: PickerCategory[]; recent: string[]; statements: OpenStatement[];
  defaults: { account?: string; card?: string; statement?: string; amount?: number };
}) {
  const [tipo, setTipo] = useState<Tipo>(initialTipo);
  const [date, setDate] = useState(todayFn());
  const [installments, setInstallments] = useState(1);
  const [amount, setAmount] = useState(defaults.amount ? formatNum(defaults.amount) : '');
  const [holder, setHolder] = useState<string>(defaults.card ? `c:${defaults.card}` : defaults.account ? `a:${defaults.account}` : initialTipo === 'cartao' && cards[0] ? `c:${cards[0].id}` : accounts[0] ? `a:${accounts[0].id}` : '');
  const [cardId, setCardId] = useState(defaults.card ?? cards[0]?.id ?? '');
  const [stmt, setStmt] = useState(defaults.statement ?? '');
  const [adjMode, setAdjMode] = useState<'saldo' | 'valor'>('saldo');
  const [state, action, pending] = useActionState(createMovementAction, { ok: true } as ActionResult);

  const selTab = (t: Tipo) => {
    setTipo(t);
    if (t === 'cartao' && cards[0] && !holder.startsWith('c:')) setHolder(`c:${cards[0].id}`);
    if ((t === 'receita' || t === 'despesa') && !holder && accounts[0]) setHolder(`a:${accounts[0].id}`);
    if (t === 'receita' && holder.startsWith('c:') && accounts[0]) setHolder(`a:${accounts[0].id}`);
  };
  const card = cards.find(c => `c:${c.id}` === holder);
  const fatura = useMemo(() => {
    if (!card?.closing_day || !card.due_day) return null;
    const dm = dueMonthForPurchase({ closing_day: card.closing_day, due_day: card.due_day }, date);
    return { dm, due: computeStatementDates({ closing_day: card.closing_day, due_day: card.due_day }, dm).due_date };
  }, [card, date]);
  const cents = toCents(amount) ?? 0;
  const cardStatements = statements.filter(s => s.card_id === cardId);
  const payCard = cards.find(c => c.id === cardId);

  const holderSelect = (allowCards: boolean) => (
    <Field label={allowCards ? 'Conta ou cartão' : 'Conta'}>
      <select name="holder" value={holder} onChange={e => setHolder(e.target.value)} className={inputClass} required>
        <option value="" disabled>— escolha —</option>
        {accounts.length > 0 && <optgroup label="Contas">{accounts.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>}
        {allowCards && cards.length > 0 && <optgroup label="Cartões">{cards.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
      </select>
    </Field>
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="tipo" value={tipo} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:flex-wrap lg:px-0" role="tablist">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tipo === t.id} onClick={() => selTab(t.id)}
            className={cx('flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium', tipo === t.id ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface')}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tipo === 'ajuste' && (
        <div className="flex gap-2 text-sm">
          <label className={cx('flex-1 rounded-xl border p-3', adjMode === 'saldo' ? 'border-primary bg-primary-soft' : 'border-border')}>
            <input type="radio" name="mode" value="saldo" checked={adjMode === 'saldo'} onChange={() => setAdjMode('saldo')} className="mr-2" />Informar o saldo do banco
          </label>
          <label className={cx('flex-1 rounded-xl border p-3', adjMode === 'valor' ? 'border-primary bg-primary-soft' : 'border-border')}>
            <input type="radio" name="mode" value="valor" checked={adjMode === 'valor'} onChange={() => setAdjMode('valor')} className="mr-2" />Informar a diferença
          </label>
        </div>
      )}

      <div className="rounded-2xl bg-surface-2 p-4">
        <label className="block text-sm text-muted" htmlFor="amount">
          {tipo === 'ajuste' ? (adjMode === 'saldo' ? 'Saldo correto (conforme o banco)' : 'Diferença (use − para reduzir)') : tipo === 'cartao' && installments > 1 ? 'Valor total da compra' : 'Valor'}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-muted">R$</span>
          <input id="amount" name="amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoFocus required placeholder="0,00"
            className={cx('w-full bg-transparent text-4xl font-bold outline-none', tipo === 'receita' ? 'text-income' : tipo === 'despesa' || tipo === 'cartao' ? 'text-expense' : '')} />
        </div>
        {tipo === 'cartao' && installments > 1 && cents !== 0 && <p className="text-sm text-muted">{installments}× de {formatBRL(Math.floor(Math.abs(cents) / installments))}</p>}
      </div>

      {(tipo === 'despesa' || tipo === 'receita' || tipo === 'cartao') && (
        <>
          <Field label="Descrição"><input name="description" className={inputClass} placeholder={tipo === 'receita' ? 'Ex.: Salário' : 'Ex.: Supermercado'} /></Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-muted">Categoria</span>
            <CategoryPicker name="category_id" categories={categories} recentIds={recent} prefer={tipo === 'receita' ? 'IN' : 'OUT'} placeholder="Escolher (ou deixar para depois)" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {holderSelect(tipo !== 'receita')}
            <Field label={tipo === 'cartao' ? 'Data da compra' : 'Data'} hint={date > todayFn() ? 'Data futura: fica como previsto.' : undefined}>
              <input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} required />
            </Field>
          </div>
          {tipo !== 'receita' && (
            <Field label="Parcelas" hint={card && fatura ? `1ª parcela na fatura de ${fmtMonth(fatura.dm)} (vence ${fmtDate(fatura.due)}).` : installments > 1 ? 'Uma parcela por mês a partir da data.' : undefined}>
              <select name="installments" value={installments} onChange={e => setInstallments(Number(e.target.value))} className={inputClass}>
                {Array.from({ length: 48 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}×`}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      {tipo === 'transferencia' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="De"><select name="from" defaultValue={defaults.account ?? accounts[0]?.id} className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Para"><select name="to" defaultValue={accounts.find(a => a.id !== (defaults.account ?? accounts[0]?.id))?.id} className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          </div>
          <Field label="Data"><input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} /></Field>
          <Field label="Descrição (opcional)"><input name="description" className={inputClass} placeholder="Transferência entre contas" /></Field>
          <p className="text-xs text-muted">Não é receita nem despesa. Para uma conta de investimento/poupança, vira aporte; no sentido inverso, resgate.</p>
        </>
      )}

      {tipo === 'pagamento' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cartão"><select name="card_id" value={cardId} onChange={e => { setCardId(e.target.value); setStmt(''); }} className={inputClass}>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Fatura">
              <select name="statement_id" value={stmt} onChange={e => { setStmt(e.target.value); const s = statements.find(x => x.id === e.target.value); if (s && s.remaining > 0) setAmount(formatNum(s.remaining)); }} className={inputClass}>
                <option value="">Automático (a fechada em aberto)</option>
                {cardStatements.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Pago com a conta"><select name="account_id" defaultValue={payCard?.payment_account_id ?? accounts[0]?.id} className={inputClass}><option value="">Conta não controlada no app</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Data do pagamento"><input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} /></Field>
          </div>
          <p className="text-xs text-muted">Quita a fatura; as compras já foram contadas como despesa, então o pagamento não entra de novo nos gastos.</p>
        </>
      )}

      {tipo === 'ajuste' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Conta"><select name="account_id" defaultValue={defaults.account ?? accounts[0]?.id} className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Data"><input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} /></Field>
          </div>
          <Field label="Motivo"><input name="reason" required className={inputClass} placeholder="Ex.: diferença com o saldo do banco" /></Field>
          <p className="text-xs text-muted">Correção excepcional: altera o saldo da conta, mas não entra em receitas ou despesas.</p>
        </>
      )}

      <Field label="Observação (opcional)"><textarea name="notes" rows={2} className={textareaClass} /></Field>
      {!state.ok && <ErrorText>{state.error}</ErrorText>}
      {state.ok && state.message && <p className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">{state.message}</p>}
      <div className="sticky bottom-20 z-10 flex gap-2 bg-bg/90 py-2 backdrop-blur lg:static lg:bg-transparent">
        <Button type="submit" name="next" value="view" disabled={pending} className="flex-1" size="lg">{pending ? 'Salvando…' : 'Salvar'}</Button>
        {(tipo === 'despesa' || tipo === 'cartao' || tipo === 'receita') && <Button type="submit" name="next" value="another" variant="secondary" disabled={pending} size="lg">Salvar e outro</Button>}
      </div>
    </form>
  );
}
