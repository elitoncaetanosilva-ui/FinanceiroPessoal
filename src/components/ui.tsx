import Link from 'next/link';
import type { Insight } from '@/lib/insights';
import { addMonthsYm, fmtBRL, fmtMesTitulo, fmtPct } from '@/lib/util';

export function Money({ v, sinal = false, className = '' }: { v: number; sinal?: boolean; className?: string }) {
  const cls = sinal ? (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '') : '';
  return <span className={`num ${cls} ${className}`}>{sinal && v > 0.004 ? '+' : ''}{fmtBRL(v)}</span>;
}

/** Navegação de mês por link (?mes=YYYY-MM), preservando os demais parâmetros. */
export function MonthNav({ mes, base, params = {}, atual }: { mes: string; base: string; params?: Record<string, string | undefined>; atual: string }) {
  const href = (m: string) => {
    const sp = new URLSearchParams(Object.entries({ ...params, mes: m }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${sp}`;
  };
  return (
    <div className="row" style={{ gap: 6 }}>
      <Link className="btn btn-icon" href={href(addMonthsYm(mes, -1))} aria-label="Mês anterior">‹</Link>
      <span style={{ minWidth: 150, textAlign: 'center', fontWeight: 600 }}>{fmtMesTitulo(mes)}</span>
      <Link className="btn btn-icon" href={href(addMonthsYm(mes, 1))} aria-label="Próximo mês">›</Link>
      {mes !== atual && <Link className="btn btn-sm" href={href(atual)}>Hoje</Link>}
    </div>
  );
}

export function Kpi({ label, valor, sub, cor, sinal }: { label: string; valor: number; sub?: React.ReactNode; cor?: string; sinal?: boolean }) {
  return (
    <div className="card">
      <div className="kpi-label">{cor && <i className="dot" style={{ background: cor }} />}{label}</div>
      <div className="kpi-value"><Money v={valor} sinal={sinal} /></div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** Texto "x% do previsto" com cor conforme o lado bom. */
export function VsPrevisto({ real, prev, maiorEhBom }: { real: number; prev: number; maiorEhBom: boolean }) {
  if (!prev) return <span className="faint">sem previsto</span>;
  const r = real / prev;
  const bom = maiorEhBom ? r >= 1 : r <= 1;
  return (
    <span>
      <span className={bom ? 'pos' : 'neg'}>{fmtPct(r)}</span> do previsto ({fmtBRL(prev)})
    </span>
  );
}

const ICONE: Record<Insight['tipo'], string> = { alerta: '!', atencao: '↑', positivo: '✓', info: 'i' };
const ROTULO: Record<Insight['tipo'], string> = { alerta: 'Alerta', atencao: 'Atenção', positivo: 'Positivo', info: 'Informação' };

export function InsightList({ itens, limite }: { itens: Insight[]; limite?: number }) {
  const lista = limite ? itens.slice(0, limite) : itens;
  if (!lista.length) return <p className="muted small">Sem destaques por enquanto.</p>;
  return (
    <div>
      {lista.map(i => (
        <div key={i.id} className={`insight insight-${i.tipo}`}>
          <div className="insight-icon" aria-label={ROTULO[i.tipo]} title={ROTULO[i.tipo]}>{ICONE[i.tipo]}</div>
          <div style={{ minWidth: 0 }}>
            <h3>{i.href ? <Link href={i.href} style={{ color: 'inherit' }}>{i.titulo}</Link> : i.titulo}</h3>
            <p>{i.texto}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barras horizontais em HTML: valor do mês com marcador da média. */
export function HBarList({ itens, cor = 'var(--s1)' }: { itens: { label: string; valor: number; ref?: number; href?: string }[]; cor?: string }) {
  const max = Math.max(1, ...itens.map(i => Math.max(i.valor, i.ref ?? 0)));
  return (
    <div role="list">
      {itens.map(i => (
        <div className="hbar" role="listitem" key={i.label}>
          <span className="hbar-label" title={i.label}>{i.href ? <Link href={i.href} style={{ color: 'inherit' }}>{i.label}</Link> : i.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${Math.max(0, (i.valor / max) * 100)}%`, background: cor, display: 'block' }} />
            {i.ref != null && i.ref > 0 && <span className="hbar-mark" style={{ left: `calc(${(i.ref / max) * 100}% - 1px)` }} title={`Média: ${fmtBRL(i.ref)}`} />}
          </span>
          <span className="num small">{fmtBRL(i.valor)}</span>
        </div>
      ))}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="card empty">
      <h2>{titulo}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}
