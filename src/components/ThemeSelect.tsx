'use client';
import { useEffect, useState } from 'react';
import { cx } from './ui';

export default function ThemeSelect() {
  const [t, setT] = useState('');
  useEffect(() => { try { setT(localStorage.getItem('fp.theme') ?? ''); } catch { /* */ } }, []);
  const set = (v: string) => {
    setT(v);
    try { if (v) localStorage.setItem('fp.theme', v); else localStorage.removeItem('fp.theme'); } catch { /* */ }
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  };
  return (
    <div className="flex gap-2">
      {[['', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => (
        <button key={v} type="button" onClick={() => set(v)} className={cx('flex-1 rounded-xl border py-2 text-sm', t === v ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border')}>{l}</button>
      ))}
    </div>
  );
}
