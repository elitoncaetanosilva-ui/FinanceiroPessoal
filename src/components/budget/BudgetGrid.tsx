'use client';
import { useMemo, useState, useTransition } from 'react';
import { applyForwardAction, setBudgetCellAction } from '@/app/actions/budget';
import { ErrorText, cx } from '@/components/ui';
import { monthShort } from '@/lib/dates';
import { formatNum, toCents } from '@/lib/money';

export interface GridGroup { id: string; name: string; section: 'IN' | 'OUT'; subs: { id: string; name: string }[] }

const fmt = (c: number) => (c ? formatNum(c) : '');

/** Grade anual (Categoria × meses). Notebook: tabela editável. Celular: lista com meses por subcategoria. */
export default function BudgetGrid({ year, groups, values: initial }: { year: number; groups: GridGroup[]; values: Record<string, number[]> }) {
  const [values, setValues] = useState(initial);
  const [err, setErr] = useState('');
  const [saving, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const get = (id: string, m: number) => values[id]?.[m] ?? 0;
  const setLocal = (id: string, months: number[], v: number) => setValues(x => {
    const arr = [...(x[id] ?? Array(12).fill(0))];
    months.forEach(m => { arr[m] = v; });
    return { ...x, [id]: arr };
  });
  const save = (id: string, m: number, raw: string) => {
    const c = toCents(raw.trim() || '0');
    if (c == null) { setErr('Valor inválido.'); return; }
    if (c === get(id, m)) return;
    setLocal(id, [m], c);
    start(async () => { const r = await setBudgetCellAction(year, id, m + 1, raw); setErr(r.ok ? '' : r.error); });
  };
  const forward = (id: string, m: number) => {
    const v = get(id, m);
    setLocal(id, Array.from({ length: 12 - m }, (_, k) => m + k), v);
    start(async () => { const r = await applyForwardAction(year, id, m + 1, formatNum(v)); setErr(r.ok ? '' : r.error); });
  };
  const totals = useMemo(() => {
    const t: Record<'IN' | 'OUT', number[]> = { IN: Array(12).fill(0), OUT: Array(12).fill(0) };
    for (const g of groups) for (let m = 0; m < 12; m++) {
      const subs = g.subs.reduce((s, x) => s + (values[x.id]?.[m] ?? 0), 0);
      t[g.section][m] += (values[g.id]?.[m] ?? 0) || subs;
    }
    return t;
  }, [groups, values]);
  const rowTotal = (id: string) => (values[id] ?? []).reduce((s, v) => s + (v || 0), 0);

  return (
    <div>
      <ErrorText>{err}</ErrorText>
      {saving && <p className="mb-2 text-xs text-muted">Salvando…</p>}
      {/* notebook */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface lg:block">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs uppercase text-muted">
            <tr><th className="w-56 p-2 text-left">Categoria</th>{Array.from({ length: 12 }, (_, m) => <th key={m} className="p-2 text-right">{monthShort(m + 1)}</th>)}<th className="p-2 text-right">Ano</th></tr>
          </thead>
          <tbody>
            {(['IN', 'OUT'] as const).map(section => (
              <SectionRows key={section} section={section} groups={groups.filter(g => g.section === section)} totals={totals[section]}
                get={get} save={save} forward={forward} rowTotal={rowTotal} values={values} />
            ))}
          </tbody>
        </table>
      </div>
      {/* celular */}
      <div className="space-y-2 lg:hidden">
        {groups.map(g => (
          <details key={g.id} className="rounded-2xl border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between p-3">
              <span className="font-semibold">{g.name}</span>
              <span className="text-sm text-muted">{formatNum(g.subs.reduce((s, x) => s + rowTotal(x.id), 0) || rowTotal(g.id))} no ano</span>
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {g.subs.map(s => (
                <div key={s.id}>
                  <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center justify-between px-3 py-3 text-left">
                    <span>{s.name}</span><span className="text-sm text-muted">{formatNum(rowTotal(s.id))}</span>
                  </button>
                  {open === s.id && (
                    <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                      {Array.from({ length: 12 }, (_, m) => (
                        <label key={m} className="rounded-xl bg-surface-2 p-2">
                          <span className="flex justify-between text-xs text-muted">{monthShort(m + 1)}
                            {m < 11 && <button type="button" onClick={() => forward(s.id, m)} className="text-primary">→ seguintes</button>}
                          </span>
                          <input key={`${s.id}-${m}-${get(s.id, m)}`} defaultValue={fmt(get(s.id, m))} inputMode="decimal" placeholder="0,00"
                            onBlur={e => save(s.id, m, e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-2 text-right" />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function SectionRows({ section, groups, totals, get, save, forward, rowTotal, values }: {
  section: 'IN' | 'OUT'; groups: GridGroup[]; totals: number[]; get: (id: string, m: number) => number;
  save: (id: string, m: number, raw: string) => void; forward: (id: string, m: number) => void; rowTotal: (id: string) => number; values: Record<string, number[]>;
}) {
  return (
    <>
      <tr className="bg-primary-soft font-semibold"><td className="p-2">{section === 'IN' ? 'TOTAL DE ENTRADAS' : 'TOTAL DE SAÍDAS'}</td>
        {totals.map((t, m) => <td key={m} className="p-2 text-right tnum">{fmt(t)}</td>)}<td className="p-2 text-right tnum">{fmt(totals.reduce((a, b) => a + b, 0))}</td></tr>
      {groups.map(g => {
        const gm = Array.from({ length: 12 }, (_, m) => (values[g.id]?.[m] ?? 0) || g.subs.reduce((s, x) => s + (values[x.id]?.[m] ?? 0), 0));
        return (
          <FragmentRows key={g.id}>
            <tr className="border-t border-border bg-surface-2/60 font-medium"><td className="p-2">{g.name}</td>{gm.map((v, m) => <td key={m} className="p-2 text-right tnum text-muted">{fmt(v)}</td>)}<td className="p-2 text-right tnum">{fmt(gm.reduce((a, b) => a + b, 0))}</td></tr>
            {g.subs.map(s => (
              <tr key={s.id} className="border-t border-border/60">
                <td className="p-1 pl-5 text-muted">{s.name}</td>
                {Array.from({ length: 12 }, (_, m) => (
                  <td key={m} className="group relative p-0.5">
                    <input key={`${s.id}-${m}-${get(s.id, m)}`} defaultValue={fmt(get(s.id, m))} inputMode="decimal"
                      onBlur={e => save(s.id, m, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className={cx('h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-right tnum hover:border-border focus:border-primary focus:bg-surface focus:outline-none')} />
                    {m < 11 && get(s.id, m) !== 0 && (
                      <button type="button" title="Aplicar aos meses seguintes" onClick={() => forward(s.id, m)}
                        className="absolute -top-2 right-0 hidden rounded bg-primary px-1 text-[10px] text-on-primary group-hover:block">→</button>
                    )}
                  </td>
                ))}
                <td className="p-2 text-right tnum text-muted">{fmt(rowTotal(s.id))}</td>
              </tr>
            ))}
          </FragmentRows>
        );
      })}
    </>
  );
}
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }
