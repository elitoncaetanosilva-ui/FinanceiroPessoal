'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { classifyAction, deleteMovementAction, markCardPaymentAction, realizeAction, setSplitsAction, linkTransferAction } from '@/app/actions/movements';
import { CategoryPicker, type PickerCategory } from '@/components/CategoryPicker';
import { Button, ErrorText, Field, Money, inputClass } from '@/components/ui';
import { formatNum, toCents } from '@/lib/money';
import { today } from '@/lib/dates';

/** Classificação com opção de aprender a regra ("aplicar a semelhantes"). */
export function ClassifyBox({ id, categories, current, suggestedId, recent, defaultPattern, direction }: {
  id: string; categories: PickerCategory[]; current: string | null; suggestedId: string | null; recent: string[]; defaultPattern: string; direction: 'IN' | 'OUT';
}) {
  const [cat, setCat] = useState<string | null>(current ?? suggestedId);
  const [learn, setLearn] = useState(!current);
  const [pattern, setPattern] = useState(defaultPattern);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => {
    if (!cat) return;
    const r = await classifyAction([id], cat, learn ? { pattern, direction } : null);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    const n = r.data?.learned ?? 0;
    setMsg({ ok: true, text: learn ? `Classificado. Regra criada${n ? ` e aplicada a mais ${n} pendente(s)` : ''}.` : 'Classificado.' });
    router.refresh();
  });
  return (
    <div className="space-y-3">
      <CategoryPicker categories={categories} value={cat} onChange={setCat} suggestedId={suggestedId} recentIds={recent} prefer={direction} />
      <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
        <input type="checkbox" checked={learn} onChange={e => setLearn(e.target.checked)} className="mt-0.5 h-5 w-5" />
        <span className="flex-1">
          <span className="font-medium">Aplicar a lançamentos semelhantes no futuro</span>
          {learn && <input value={pattern} onChange={e => setPattern(e.target.value)} className={`${inputClass} mt-2`} aria-label="Padrão da regra" />}
          {learn && <span className="mt-1 block text-xs text-muted">Descrições que contêm este trecho serão classificadas automaticamente (inclusive os pendentes de agora).</span>}
        </span>
      </label>
      {msg && (msg.ok ? <p className="text-sm text-primary">{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>)}
      <Button onClick={save} disabled={!cat || pending} className="w-full sm:w-auto">{pending ? 'Salvando…' : 'Salvar classificação'}</Button>
    </div>
  );
}

/** Editor de rateio: a soma precisa fechar com o valor do movimento. */
export function SplitEditor({ id, amount, categories, splits }: {
  id: string; amount: number; categories: PickerCategory[]; splits: { category_id: string | null; amount_cents: number }[];
}) {
  const sign: 1 | -1 = amount < 0 ? -1 : 1;
  const [rows, setRows] = useState(splits.map(s => ({ categoryId: s.category_id, amount: formatNum(Math.abs(s.amount_cents)) })));
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const total = useMemo(() => rows.reduce((s, r) => s + Math.abs(toCents(r.amount) ?? 0), 0), [rows]);
  const rest = Math.abs(amount) - total;
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(r => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = () => start(async () => {
    const r = await setSplitsAction(id, rows, sign);
    if (!r.ok) { setErr(r.error); setOk(''); return; }
    setErr(''); setOk('Rateio salvo.');
    router.refresh();
  });
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><CategoryPicker categories={categories} value={r.categoryId} onChange={c => upd(i, { categoryId: c })} /></div>
          <input value={r.amount} onChange={e => upd(i, { amount: e.target.value })} inputMode="decimal" className={`${inputClass} w-28 text-right`} aria-label="Valor" />
          {rows.length > 1 && <button type="button" onClick={() => setRows(x => x.filter((_, k) => k !== i))} aria-label="Remover" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2"><Trash2 size={18} /></button>}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => setRows(x => [...x, { categoryId: null, amount: rest > 0 ? formatNum(rest) : '' }])} className="flex items-center gap-1 text-primary"><Plus size={16} /> Adicionar parte</button>
        <span className={rest === 0 ? 'text-income' : 'text-danger'}>{rest === 0 ? 'Rateio fecha com o valor ✓' : <>Falta distribuir <Money cents={rest} /></>}</span>
      </div>
      <ErrorText>{err}</ErrorText>
      {ok && <p className="text-sm text-primary">{ok}</p>}
      <Button onClick={save} disabled={pending || rest !== 0} variant="secondary">{pending ? 'Salvando…' : 'Salvar rateio'}</Button>
    </div>
  );
}

export function MovementActions({ id, planned, hasSeries, isAccountOut, isCardCredit, cards, isTransferCandidate }: {
  id: string; planned: boolean; hasSeries: boolean; isAccountOut: boolean; isCardCredit: boolean; cards: { id: string; name: string }[]; isTransferCandidate: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [armed, setArmed] = useState<'one' | 'future' | null>(null);
  const [card, setCard] = useState(cards[0]?.id ?? '');
  const [realDate, setRealDate] = useState(today());
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? 'Erro'); setOk(''); } else { setErr(''); setOk(r.message ?? 'Feito.'); router.refresh(); }
  });
  const del = (scope: 'one' | 'future') => {
    if (armed !== scope) { setArmed(scope); setTimeout(() => setArmed(null), 4000); return; }
    run(() => deleteMovementAction(id, scope));
  };
  return (
    <div className="space-y-4">
      {planned && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Aconteceu em"><input type="date" value={realDate} onChange={e => setRealDate(e.target.value)} className={inputClass} /></Field>
          <Button onClick={() => run(() => realizeAction(id, realDate))} disabled={pending}>Confirmar como realizado</Button>
        </div>
      )}
      {(isAccountOut || isCardCredit) && cards.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          {isAccountOut && <Field label="É pagamento da fatura do cartão"><select value={card} onChange={e => setCard(e.target.value)} className={inputClass}>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <Button variant="secondary" onClick={() => run(() => markCardPaymentAction(id, card))} disabled={pending}>{isAccountOut ? 'Marcar como pagamento de fatura' : 'É pagamento da fatura (crédito)'}</Button>
        </div>
      )}
      {isTransferCandidate && <Button variant="secondary" onClick={() => run(() => linkTransferAction(id))} disabled={pending}>Procurar o outro lado da transferência</Button>}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button variant={armed === 'one' ? 'danger' : 'secondary'} size="sm" onClick={() => del('one')} disabled={pending}>{armed === 'one' ? 'Confirmar exclusão' : 'Excluir'}</Button>
        {hasSeries && <Button variant={armed === 'future' ? 'danger' : 'secondary'} size="sm" onClick={() => del('future')} disabled={pending}>{armed === 'future' ? 'Confirmar' : 'Excluir este e os seguintes'}</Button>}
      </div>
      <ErrorText>{err}</ErrorText>
      {ok && <p className="text-sm text-primary">{ok}</p>}
    </div>
  );
}
