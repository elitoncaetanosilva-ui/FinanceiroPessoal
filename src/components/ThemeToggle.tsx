'use client';

import { useEffect, useState } from 'react';

type Tema = 'auto' | 'light' | 'dark';
const ROTULO: Record<Tema, string> = { auto: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' };
const ICONE: Record<Tema, string> = { auto: '◐', light: '☀', dark: '☾' };

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>('auto');
  useEffect(() => {
    try {
      const t = localStorage.getItem('tema');
      if (t === 'light' || t === 'dark') setTema(t);
    } catch {}
  }, []);
  const proximo = () => {
    const t: Tema = tema === 'auto' ? 'light' : tema === 'light' ? 'dark' : 'auto';
    setTema(t);
    try {
      if (t === 'auto') localStorage.removeItem('tema');
      else localStorage.setItem('tema', t);
    } catch {}
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return (
    <button className="btn btn-ghost btn-icon" onClick={proximo} title={ROTULO[tema]} aria-label={ROTULO[tema]}>
      <span aria-hidden>{ICONE[tema]}</span>
    </button>
  );
}
