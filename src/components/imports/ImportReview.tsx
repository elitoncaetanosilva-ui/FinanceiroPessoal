'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Receipt } from 'lucide-react';
import { classifySimilarAction, commitAction, discardAction, setRowAction } from '@/app/actions/imports';
import { CategoryPicker, type PickerCategory } from '@/components/CategoryPicker';
import { Badge, Button, ErrorText, Money, cx } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { suggestPattern } from '@/lib/text';

export interface ReviewRow {
  id: string; date: string; description: string; amount_cents: number; status: string; action: 'IMPORT' | 'SKIP' | 'LINK';
  category_id: string | null; suggested_category_id: string | null; confidence: number | null; classification_source: string | null;
  message: string | null; row_kind: string; installment_number: number | null; installment_total: number | null; target_card_name: string | null;
  matched_movement_id: string | null;
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'warning' | 'danger' | 'income' | 'planned' }> = {
  NEW: { label: 'novo', tone: 'primary' }, DUPLICATE: { label: 'duplicado', tone: 'neutral' }, MATCHED: { label: 'realiza previsto', tone: 'planned' },
  POSSIBLE_DUPLICATE: { label: 'possível duplicado', tone: 'warning' }, ERROR: { label: 'erro', tone: 'danger' }, IGNORED: { label: 'ignorado', tone: 'neutral' },
};
type Tab = 'todos' | 'pendentes' | 'novos' | 'vinculos' | 'duplicados';

export default function ImportReview({ batchId, rows: initial, categories, recent, draft }: {
  batchId: string; rows: ReviewRow[]; categories: PickerCategory[]; recent: string[]; draft: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.some(r => r.action === 'IMPORT' && r.row_kind === 'NORMAL' && !r.category_id) ? 'pendentes' : 'todos');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const router = useRouter();

  const counts = useMemo(() => ({
    todos: rows.length,
    pendentes: rows.filter(r => r.action === 'IMPORT' && r.row_kind === 'NORMAL' && !r.category_id).length,
    novos: rows.filter(r => r.action === 'IMPORT').length,
    vinculos: rows.filter(r => r.action === 'LINK').length,
    duplicados: rows.filter(r => r.status === 'DUPLICATE').length,
  }), [rows]);
  const visible = rows.filter(r => tab === 'todos' ? true : tab === 'pendentes' ? r.action === 'IMPORT' && r.row_kind === 'NORMAL' && !r.category_id
    : tab === 'novos' ? r.action === 'IMPORT' : tab === 'vinculos' ? r.action === 'LINK' : r.status === 'DUPLICATE');

  const patch = (id: string, p: Partial<ReviewRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)));
  const setAction = (r: ReviewRow, action: ReviewRow['action']) => start(async () => {
    const res = await setRowAction(r.id, { action });
    if (!res.ok) setErr(res.error); else { setErr(''); patch(r.id, { action }); }
  });
  const setCat = (r: ReviewRow, categoryId: string, similar: boolean) => start(async () => {
    const res = similar ? await classifySimilarAction(batchId, r.id, categoryId) : await setRowAction(r.id, { categoryId, learnPattern: suggestPattern(r.description) });
    if (!res.ok) { setErr(res.error); return; }
    setErr('');
    if (similar) router.refresh(); else patch(r.id, { category_id: categoryId });
  });
  const commit = () => start(async () => { const r = await commitAction(batchId); if (r && !r.ok) setErr(r.error); });
  const discard = () => {
    if (!confirmDiscard) { setConfirmDiscard(true); setTimeout(() => setConfirmDiscard(false), 4000); return; }
    start(async () => { const r = await discardAction(batchId); if (r && !r.ok) setErr(r.error); });
  };
  const catName = (id: string | null) => { const c = categories.find(x => x.id === id); return c ? `${c.group} › ${c.name}` : ''; };
  const toImport = rows.filter(r => r.action === 'IMPORT').length, toLink = rows.filter(r => r.action === 'LINK').length;

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0">
        {(['pendentes', 'todos', 'novos', 'vinculos', 'duplicados'] as Tab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cx('shrink-0 rounded-full border px-3 py-1.5 text-sm', tab === t ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface')}>
            {{ pendentes: 'Sem categoria', todos: 'Todos', novos: 'A importar', vinculos: 'Vínculos', duplicados: 'Duplicados' }[t]} ({counts[t]})
          </button>
        ))}
      </div>
      <ErrorText>{err}</ErrorText>
      <ul className="space-y-2">
        {visible.map(r => {
          const st = STATUS[r.status] ?? STATUS.NEW;
          const skipped = r.action === 'SKIP';
          return (
            <li key={r.id} className={cx('rounded-2xl border border-border bg-surface p-3', skipped && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.description}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    {fmtDate(r.date)}
                    {r.installment_total ? <Badge>{r.installment_number}/{r.installment_total}</Badge> : null}
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {r.row_kind === 'CARD_PAYMENT' && <Badge tone="primary"><Receipt size={12} /> pagamento de fatura{r.target_card_name ? ` · ${r.target_card_name}` : ''}</Badge>}
                  </p>
                </div>
                <Money cents={r.amount_cents} tone={r.row_kind === 'CARD_PAYMENT' ? 'muted' : 'auto'} className="font-semibold" />
              </div>
              {r.message && <p className="mt-1 flex items-center gap-1 text-xs text-muted">{r.action === 'LINK' && <Link2 size={12} />} {r.message}</p>}
              {draft && r.status !== 'DUPLICATE' && r.status !== 'ERROR' && (
                <div className="mt-2 space-y-2">
                  {r.row_kind === 'NORMAL' && r.action === 'IMPORT' && (
                    <div>
                      <CategoryPicker categories={categories} value={r.category_id} suggestedId={r.suggested_category_id} recentIds={recent}
                        prefer={r.amount_cents < 0 ? 'OUT' : 'IN'} placeholder={r.suggested_category_id ? `Sugestão: ${catName(r.suggested_category_id)}` : 'Deixar pendente ou escolher'}
                        onChange={id => setCat(r, id, false)} />
                      {r.category_id && r.classification_source && r.category_id === r.suggested_category_id && <p className="mt-1 text-xs text-muted">Classificado por {r.classification_source}</p>}
                      {r.category_id && <button type="button" className="mt-1 text-xs text-primary" onClick={() => setCat(r, r.category_id!, true)} disabled={pending}>Aplicar esta categoria às linhas semelhantes</button>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {r.matched_movement_id && <Seg on={r.action === 'LINK'} onClick={() => setAction(r, 'LINK')}>Vincular ao existente</Seg>}
                    <Seg on={r.action === 'IMPORT'} onClick={() => setAction(r, 'IMPORT')}>{r.matched_movement_id ? 'Importar como novo' : 'Importar'}</Seg>
                    <Seg on={r.action === 'SKIP'} onClick={() => setAction(r, 'SKIP')}>Não importar</Seg>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">Nada aqui.</li>}
      </ul>
      {draft && (
        <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <Button onClick={commit} disabled={pending} size="lg" className="flex-1">{pending ? 'Processando…' : `Confirmar: ${toImport} novos, ${toLink} vínculos`}</Button>
          <Button variant={confirmDiscard ? 'danger' : 'secondary'} onClick={discard} disabled={pending}>{confirmDiscard ? 'Confirmar descarte' : 'Descartar'}</Button>
          <p className="w-full text-xs text-muted">Linhas sem categoria entram como pendentes; dá para classificar depois em Pendentes.</p>
        </div>
      )}
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cx('rounded-full border px-2.5 py-1', on ? 'border-primary bg-primary text-on-primary' : 'border-border')}>{children}</button>;
}
