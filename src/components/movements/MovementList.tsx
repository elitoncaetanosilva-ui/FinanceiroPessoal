'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { classifyAction, loadMoreAction } from '@/app/actions/movements';
import { CategoryPicker, type PickerCategory } from '@/components/CategoryPicker';
import { Badge, Button, Money, cx } from '@/components/ui';
import { fmtDate, fmtMonth } from '@/lib/dates';
import type { MovementFilters, MovementListItem } from '@/server/domain/queries';
import { MovementGroups } from './MovementItem';

/** Lista com "carregar mais" (paginação no servidor). Celular: cards por dia. Notebook: tabela com seleção em lote. */
export default function MovementList({ initial, next, filters, categories }: {
  initial: MovementListItem[]; next: { date: string; id: string } | null; filters: MovementFilters; categories: PickerCategory[];
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(next);
  const [loading, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  const more = () => start(async () => {
    if (!cursor) return;
    const r = await loadMoreAction(filters, cursor);
    setItems(x => [...x, ...r.items]);
    setCursor(r.next);
  });
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const applyBulk = () => start(async () => {
    if (!bulkCat || !sel.size) return;
    const r = await classifyAction([...sel], bulkCat);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`${sel.size} lançamento(s) classificados.`);
    setSel(new Set());
    router.refresh();
  });

  return (
    <div>
      <div className="lg:hidden"><MovementGroups items={items} /></div>

      <div className="hidden lg:block">
        {sel.size > 0 && (
          <div className="sticky top-0 z-10 mb-2 flex items-center gap-3 rounded-xl border border-primary bg-primary-soft p-2">
            <span className="text-sm font-medium">{sel.size} selecionado(s)</span>
            <div className="w-80"><CategoryPicker categories={categories} onChange={setBulkCat} placeholder="Classificar como…" /></div>
            <Button size="sm" onClick={applyBulk} disabled={!bulkCat || loading}>Aplicar</Button>
            <button className="text-sm text-muted" onClick={() => setSel(new Set())}>Limpar</button>
          </div>
        )}
        {msg && <p className="mb-2 text-sm text-primary">{msg}</p>}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 p-2"><input type="checkbox" aria-label="Selecionar todos" checked={sel.size > 0 && sel.size === items.length} onChange={e => setSel(e.target.checked ? new Set(items.map(i => i.id)) : new Set())} /></th>
                <th className="p-2">Data</th><th className="p-2">Descrição</th><th className="p-2">Categoria</th><th className="p-2">Conta / cartão</th>
                <th className="p-2">Competência</th><th className="p-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map(m => (
                <tr key={m.id} className={cx('hover:bg-surface-2', sel.has(m.id) && 'bg-primary-soft/50')}>
                  <td className="p-2"><input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} aria-label="Selecionar" /></td>
                  <td className="whitespace-nowrap p-2 tnum">{fmtDate(m.date)}</td>
                  <td className="max-w-80 p-2">
                    <Link href={`/movimentos/${m.id}`} className="block truncate font-medium hover:text-primary">{m.description}</Link>
                    <span className="flex gap-1">
                      {m.status === 'PLANNED' && <Badge tone="planned">previsto</Badge>}
                      {m.installment_total && m.installment_total > 1 ? <Badge>{m.installment_number}/{m.installment_total}</Badge> : null}
                      {m.kind === 'TRANSFER' && <Badge tone="primary">transferência</Badge>}
                      {m.kind === 'CARD_PAYMENT' && <Badge tone="primary">pagamento de fatura</Badge>}
                      {m.kind === 'ADJUSTMENT' && <Badge tone="planned">ajuste</Badge>}
                    </span>
                  </td>
                  <td className="max-w-64 truncate p-2">{m.pending ? <Badge tone="warning">classificar</Badge> : m.split_count > 1 ? 'Rateado' : <><span className="text-muted">{m.group_name} › </span>{m.category_name}</>}</td>
                  <td className="p-2 text-muted">{m.account_name ?? m.card_name}</td>
                  <td className="p-2 text-muted">{fmtMonth(m.competence)}</td>
                  <td className="p-2 text-right"><Money cents={m.category_amount ?? m.amount_cents} tone={m.kind === 'NORMAL' ? 'auto' : 'muted'} className="font-semibold" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {items.length === 0 && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">Nenhum lançamento com estes filtros.</p>}
      {cursor && <Button variant="secondary" className="mt-4 w-full" onClick={more} disabled={loading}>{loading ? 'Carregando…' : 'Carregar mais'}</Button>}
    </div>
  );
}
