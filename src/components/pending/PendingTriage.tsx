'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Check, ChevronRight, Receipt, SkipForward, Sparkles } from 'lucide-react';
import { classifyAction, markCardPaymentAction } from '@/app/actions/movements';
import { PickerSheet, type PickerCategory } from '@/components/CategoryPicker';
import { Badge, ErrorText, Money, cx, inputClass } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { coreDescription, suggestPattern } from '@/lib/text';

export interface PendingItem {
  id: string; date: string; description: string; amount_cents: number; holder: string; is_account: boolean;
  suggested_category_id: string | null; suggestion_source: string | null; installment: string | null; status: string;
}

export default function PendingTriage({ items: initial, categories, recent, cards, transferCategoryId }: {
  items: PendingItem[]; categories: PickerCategory[]; recent: string[]; cards: { id: string; name: string }[]; transferCategoryId: string;
}) {
  const [items, setItems] = useState(initial);
  const [mode, setMode] = useState<'um' | 'grupos'>('um');
  const [i, setI] = useState(0);
  const [learn, setLearn] = useState(true);
  const [pattern, setPattern] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | { ids: string[]; pattern: string; direction: 'IN' | 'OUT' }>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const byId = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; items: PendingItem[]; total: number; direction: 'IN' | 'OUT'; suggested: string | null }>();
    for (const it of items) {
      const dir = it.amount_cents < 0 ? 'OUT' : 'IN';
      const label = suggestPattern(it.description);
      const key = `${dir}|${label}`;
      const g = m.get(key) ?? { key, label, items: [], total: 0, direction: dir, suggested: it.suggested_category_id };
      g.items.push(it); g.total += it.amount_cents;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || Math.abs(b.total) - Math.abs(a.total));
  }, [items]);

  const cur = items[Math.min(i, items.length - 1)];
  const curPattern = pattern ?? (cur ? suggestPattern(cur.description) : '');
  const similar = cur ? items.filter(x => x.id !== cur.id && (x.amount_cents < 0) === (cur.amount_cents < 0) && coreDescription(x.description).includes(curPattern)).length : 0;

  const finish = (ids: string[], msg: string) => {
    setItems(xs => xs.filter(x => !ids.includes(x.id)));
    setPattern(null);
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
    router.refresh();
  };
  const classify = (ids: string[], categoryId: string, learnPattern: string | null, direction: 'IN' | 'OUT') => start(async () => {
    const r = await classifyAction(ids, categoryId, learnPattern ? { pattern: learnPattern, direction } : null);
    if (!r.ok) { setErr(r.error); return; }
    setErr('');
    const learned = r.data?.learned ?? 0;
    const cname = byId.get(categoryId)?.name ?? '';
    // os semelhantes classificados pela regra também saem da fila
    const extra = learnPattern ? items.filter(x => !ids.includes(x.id) && (x.amount_cents < 0) === (direction === 'OUT') && x.description.toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').includes(learnPattern)).map(x => x.id) : [];
    finish([...ids, ...extra], `${cname}${learned ? ` · +${learned} semelhante(s)` : ''}`);
  });
  const payment = (id: string, cardId: string) => start(async () => {
    const r = await markCardPaymentAction(id, cardId);
    if (!r.ok) { setErr(r.error); return; }
    finish([id], 'Pagamento de fatura');
  });

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <Check size={40} className="mx-auto text-income" />
        <p className="mt-2 text-lg font-semibold">Tudo classificado!</p>
        <Link href="/" className="mt-3 inline-block text-primary">Voltar ao início</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['um', 'grupos'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cx('flex-1 rounded-full border py-2 text-sm font-medium', mode === m ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
            {m === 'um' ? `Um a um (${items.length})` : `Agrupados (${groups.length})`}
          </button>
        ))}
      </div>
      <ErrorText>{err}</ErrorText>
      {toast && <p className="rounded-xl bg-primary-soft px-3 py-2 text-center text-sm font-medium text-primary">✓ {toast}</p>}

      {mode === 'um' && cur && (
        <div className="rounded-3xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{Math.min(i, items.length - 1) + 1} de {items.length}</span>
            <Link href={`/movimentos/${cur.id}`} className="text-primary">detalhes</Link>
          </div>
          <p className="mt-2 text-lg font-semibold leading-tight">{cur.description}</p>
          <p className="text-sm text-muted">{fmtDate(cur.date)} · {cur.holder}{cur.installment && ` · ${cur.installment}`}{cur.status === 'PLANNED' && ' · previsto'}</p>
          <p className="mt-2 text-3xl font-bold"><Money cents={cur.amount_cents} tone="auto" /></p>

          <div className="mt-4 space-y-2">
            {cur.suggested_category_id && byId.has(cur.suggested_category_id) && (
              <button type="button" disabled={pending} onClick={() => classify([cur.id], cur.suggested_category_id!, learn ? curPattern : null, cur.amount_cents < 0 ? 'OUT' : 'IN')}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-primary px-4 text-left text-on-primary active:scale-[.99]">
                <Sparkles size={20} />
                <span className="flex-1"><span className="block text-xs opacity-80">Sugestão {cur.suggestion_source ? `(${cur.suggestion_source})` : ''}</span>
                  <span className="font-semibold">{byId.get(cur.suggested_category_id)!.group} › {byId.get(cur.suggested_category_id)!.name}</span></span>
                <Check size={22} />
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              {recent.filter(r => byId.has(r) && r !== cur.suggested_category_id && byId.get(r)!.section === (cur.amount_cents < 0 ? 'OUT' : 'IN')).slice(0, 6).map(r => (
                <button key={r} type="button" disabled={pending} onClick={() => classify([cur.id], r, learn ? curPattern : null, cur.amount_cents < 0 ? 'OUT' : 'IN')}
                  className="min-h-11 rounded-full border border-border bg-surface-2 px-3 text-sm active:scale-[.98]">{byId.get(r)!.name}</button>
              ))}
              <button type="button" onClick={() => setPicker({ ids: [cur.id], pattern: learn ? curPattern : '', direction: cur.amount_cents < 0 ? 'OUT' : 'IN' })}
                className="min-h-11 rounded-full border border-primary px-3 text-sm font-medium text-primary">Outra categoria…</button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {cur.is_account && (
                <button type="button" disabled={pending} onClick={() => classify([cur.id], transferCategoryId, null, 'OUT')} className="flex min-h-10 items-center gap-1 rounded-full border border-border px-3 text-sm">
                  <ArrowLeftRight size={16} /> Transferência entre minhas contas
                </button>
              )}
              {cur.is_account && cur.amount_cents < 0 && cards.map(c => (
                <button key={c.id} type="button" disabled={pending} onClick={() => payment(cur.id, c.id)} className="flex min-h-10 items-center gap-1 rounded-full border border-border px-3 text-sm">
                  <Receipt size={16} /> Pagamento fatura {c.name}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
            <input type="checkbox" checked={learn} onChange={e => setLearn(e.target.checked)} className="mt-0.5 h-5 w-5" />
            <span className="flex-1">
              Aplicar a semelhantes (criar regra)
              {learn && <input value={curPattern} onChange={e => setPattern(e.target.value.toUpperCase())} className={cx(inputClass, 'mt-2 h-9')} aria-label="Trecho da descrição" />}
              {learn && similar > 0 && <span className="mt-1 block text-xs text-primary">+{similar} pendente(s) com este trecho</span>}
            </span>
          </label>
          <div className="mt-3 flex justify-between">
            <button type="button" onClick={() => { setI(x => (x > 0 ? x - 1 : 0)); setPattern(null); }} className="h-11 px-3 text-sm text-muted" disabled={i === 0}>‹ Anterior</button>
            <button type="button" onClick={() => { setI(x => (x + 1) % items.length); setPattern(null); }} className="flex h-11 items-center gap-1 px-3 text-sm text-muted"><SkipForward size={16} /> Pular</button>
          </div>
        </div>
      )}

      {mode === 'grupos' && (
        <ul className="space-y-2">
          {groups.map(g => (
            <li key={g.key}>
              <button type="button" onClick={() => setPicker({ ids: g.items.map(x => x.id), pattern: g.items.length > 1 || learn ? g.label : '', direction: g.direction })}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left active:scale-[.99]">
                <span className="flex h-10 min-w-10 items-center justify-center rounded-full bg-warning-soft px-2 font-bold text-warning">{g.items.length}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.label}</span>
                  <span className="block truncate text-xs text-muted">{g.items.slice(0, 3).map(x => fmtDate(x.date)).join(', ')}{g.items.length > 3 ? '…' : ''}
                    {g.suggested && byId.get(g.suggested) && <> · sugestão: {byId.get(g.suggested)!.name}</>}</span>
                </span>
                <Money cents={g.total} tone="auto" className="font-semibold" />
                <ChevronRight size={18} className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picker && (
        <PickerSheet categories={categories} recentIds={recent} prefer={picker.direction}
          suggestedId={items.find(x => x.id === picker.ids[0])?.suggested_category_id}
          onClose={() => setPicker(null)}
          onPick={id => { const p = picker; setPicker(null); classify(p.ids, id, p.pattern || null, p.direction); }} />
      )}
      {mode === 'grupos' && <p className="text-xs text-muted">Tocar num grupo classifica todos de uma vez e cria a regra para os próximos. <Badge>{items.length} pendentes</Badge></p>}
      {pending && <p className="text-center text-sm text-muted">Salvando…</p>}
    </div>
  );
}
