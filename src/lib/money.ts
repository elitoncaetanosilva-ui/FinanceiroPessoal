/** Dinheiro sempre em centavos inteiros. */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatBRL = (cents: number) => BRL.format((cents || 0) / 100).replace(/ /g, ' ');
export const formatNum = (cents: number) => NUM.format((cents || 0) / 100);
/** Formato compacto para gráficos: 1,2 mil, 3,4 mi */
export function formatCompact(cents: number) {
  const v = (cents || 0) / 100;
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (a >= 1_000) return (v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/**
 * Converte texto/número em centavos. Aceita formatos brasileiros e internacionais:
 * "1.234,56", "-1.234,56", "- 1.693,60", "R$ 24,00", "(10,00)", "1234.56", "10,5", 1234.56
 */
export function toCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim().replace(/R\$/gi, '').replace(/[\s ]/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');           // 1.234,56
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, '');        // 1,234.56
  else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234 (milhar)
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return neg ? -c : c;
}

/** Divide um total em n parcelas; a diferença de centavos fica na 1ª parcela (padrão dos bancos). */
export function splitInstallments(totalCents: number, n: number): number[] {
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / n);
  const rest = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (i === 0 ? base + rest : base));
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
