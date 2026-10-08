'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cx, inputClass } from './ui';

export interface PickerCategory { id: string; name: string; group: string; section: 'IN' | 'OUT'; nature: string }

const strip = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Seletor de subcategoria pensado para o celular: busca, sugestão e recentes em uma folha inferior. */
export function CategoryPicker({ categories, value, onChange, name, suggestedId, recentIds = [], prefer, placeholder = 'Escolher categoria', className, autoOpen }: {
  categories: PickerCategory[]; value?: string | null; onChange?: (id: string) => void; name?: string; suggestedId?: string | null;
  recentIds?: string[]; prefer?: 'IN' | 'OUT'; placeholder?: string; className?: string; autoOpen?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(value ?? null);
  const [open, setOpen] = useState(!!autoOpen);
  useEffect(() => { setSel(value ?? null); }, [value]);
  const current = categories.find(c => c.id === sel);
  const choose = (id: string) => { setSel(id); onChange?.(id); setOpen(false); };
  return (
    <>
      {name && <input type="hidden" name={name} value={sel ?? ''} />}
      <button type="button" onClick={() => setOpen(true)}
        className={cx(inputClass, 'flex items-center justify-between gap-2 text-left', !current && 'text-muted', className)}>
        <span className="truncate">{current ? <><span className="text-muted">{current.group} › </span>{current.name}</> : placeholder}</span>
        <ChevronDown size={18} className="shrink-0 text-muted" />
      </button>
      {open && <PickerSheet categories={categories} onClose={() => setOpen(false)} onPick={choose} selected={sel} suggestedId={suggestedId} recentIds={recentIds} prefer={prefer} />}
    </>
  );
}

export function PickerSheet({ categories, onClose, onPick, selected, suggestedId, recentIds = [], prefer }: {
  categories: PickerCategory[]; onClose: () => void; onPick: (id: string) => void; selected?: string | null; suggestedId?: string | null;
  recentIds?: string[]; prefer?: 'IN' | 'OUT';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const byId = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const filtered = useMemo(() => {
    const t = strip(q.trim());
    const list = t ? categories.filter(c => strip(`${c.group} ${c.name}`).includes(t)) : categories;
    const order = (c: PickerCategory) => (prefer && c.section !== prefer ? 1 : 0);
    return [...list].sort((a, b) => order(a) - order(b));
  }, [q, categories, prefer]);
  const groups: { group: string; items: PickerCategory[] }[] = [];
  for (const c of filtered) {
    const g = groups.find(x => x.group === c.group);
    if (g) g.items.push(c); else groups.push({ group: c.group, items: [c] });
  }
  const chips = [...new Set([suggestedId, ...recentIds].filter((x): x is string => !!x && byId.has(x)))].slice(0, 8);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
      <div className="flex max-h-[88dvh] flex-col">
        <div className="border-b border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Categoria</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2"><X size={20} /></button>
          </div>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: mercado, combustível…" className={cx(inputClass, 'pl-10')} />
          </div>
          {!q && chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {chips.map(id => {
                const c = byId.get(id)!;
                return (
                  <button key={id} type="button" onClick={() => onPick(id)}
                    className={cx('rounded-full border px-3 py-1.5 text-sm', id === suggestedId ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface-2')}>
                    {id === suggestedId && '★ '}{c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-safe">
          {groups.map(g => (
            <div key={g.group}>
              <p className="sticky top-0 bg-surface-2 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</p>
              {g.items.map(c => (
                <button key={c.id} type="button" onClick={() => onPick(c.id)} className="flex min-h-12 w-full items-center justify-between px-4 text-left hover:bg-surface-2 active:bg-surface-2">
                  <span>{c.name}</span>
                  {c.id === selected && <Check size={18} className="text-primary" />}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="p-6 text-center text-sm text-muted">Nada encontrado.</p>}
        </div>
      </div>
    </dialog>
  );
}
