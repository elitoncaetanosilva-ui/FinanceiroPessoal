// Utilitários puros (datas como texto ISO "YYYY-MM-DD" para não sofrer com fuso horário).

export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** "YYYY-MM" de uma data ISO. */
export const ym = (iso: string) => iso.slice(0, 7);

/** Primeiro dia do mês ("YYYY-MM-01"). */
export const monthStart = (isoOrYm: string) => isoOrYm.slice(0, 7) + '-01';

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function isoFromParts(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Soma k meses a uma data ISO, preservando o dia quando possível. */
export function addMonths(iso: string, k: number) {
  const [y, m, d] = iso.split('-').map(Number);
  let yy = y, mm = m - 1 + k;
  yy += Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  const dd = Math.min(d || 1, daysInMonth(yy, mm + 1));
  return isoFromParts(yy, mm + 1, dd);
}

export const addMonthsYm = (ymStr: string, k: number) => addMonths(ymStr + '-01', k).slice(0, 7);

/** Lista de meses "YYYY-MM" de a até b (inclusive). */
export function monthRange(a: string, b: string) {
  const out: string[] = [];
  for (let cur = a.slice(0, 7); cur <= b.slice(0, 7); cur = addMonthsYm(cur, 1)) out.push(cur);
  return out;
}

export function diffDays(a: string, b: string) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

/** Data de hoje em São Paulo. */
export function todayISO(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/** Converte Date/string em ISO (data de calendário). Datas UTC à meia-noite ou com hora são tratadas pela parte de data. */
export function toISODate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // Arredonda para o dia mais próximo (SheetJS pode devolver 23:59:xx do dia anterior).
    const t = new Date(v.getTime() + 12 * 3600 * 1000);
    return isoFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return isoFromParts(y, +m[2], +m[1]);
  }
  return null;
}

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-03" → "mar/26" */
export const fmtMes = (ymStr: string) => `${MESES[+ymStr.slice(5, 7) - 1]}/${ymStr.slice(2, 4)}`;
/** "2026-03" → "março de 2026" */
export const fmtMesLongo = (ymStr: string) => `${MESES_LONGOS[+ymStr.slice(5, 7) - 1]} de ${ymStr.slice(0, 4)}`;
export const fmtMesTitulo = (ymStr: string) => { const s = fmtMesLongo(ymStr); return s[0].toUpperCase() + s.slice(1); };
/** "2026-03-07" → "07/03/2026" */
export const fmtData = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
export const fmtBRL = (n: number) => brl.format(r2(n || 0));
export const fmtBRLCompact = (n: number) => (Math.abs(n) < 1000 ? brl.format(Math.round(n)).replace(/,00$/, '') : brlCompact.format(n));
const numCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
/** Rótulo curto para eixos ("16,5 mil"); o título do gráfico já diz que é R$. */
export const fmtEixo = (n: number) => numCompact.format(n);
export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits).replace('.', ',')}%`;

export const parcelaStr = (k: number | null | undefined, n: number | null | undefined) =>
  k && n ? `${pad2(k)}/${pad2(n)}` : '';

/** "05/09", "5 de 9" → {k:5, n:9} */
export function parseParcela(raw: unknown): { k: number; n: number } {
  if (raw == null || String(raw).trim() === '') return { k: 1, n: 1 };
  const s = String(raw);
  const m = s.toLowerCase().match(/(\d+)\s*de\s*(\d+)/) || s.match(/(\d+)\s*\/\s*(\d+)/);
  if (m && +m[1] >= 1 && +m[2] >= +m[1]) return { k: +m[1], n: +m[2] };
  return { k: 1, n: 1 };
}

/** Normaliza descrição para aprender regras: remove números, parcelas, cidade/UF colados etc. */
export function descKey(desc: string) {
  return norm(desc)
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function groupBy<T, K extends string | number>(arr: T[], key: (t: T) => K) {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export const sum = (arr: number[]) => r2(arr.reduce((a, b) => a + b, 0));

const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Número com 2 casas, sem símbolo (tabelas densas). */
export const fmtNum = (n: number) => num2.format(r2(n || 0));
