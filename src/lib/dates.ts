/**
 * Datas de negócio como strings 'YYYY-MM-DD' (sem fuso horário).
 * Toda aritmética é feita em UTC sobre o calendário, então nunca "volta um dia".
 */
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;
export const parts = (d: ISODate) => { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd }; };
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isISODate = (s: unknown): s is ISODate => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/** Hoje no fuso de São Paulo. */
export function today(tz = 'America/Sao_Paulo'): ISODate {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = Date.parse(d + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export function diffDays(a: ISODate, b: ISODate) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
/** Soma meses mantendo o dia (limitado ao fim do mês): 31/01 + 1 = 28/02 */
export function addMonths(d: ISODate, n: number, day?: number): ISODate {
  const p = parts(d);
  let y = p.y, m = p.m + n;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  return ymd(y, m, Math.min(day ?? p.d, daysInMonth(y, m)));
}
export const monthStart = (d: ISODate): ISODate => d.slice(0, 7) + '-01';

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
export function easter(y: number): ISODate {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}
/** Feriados bancários nacionais (inclui Carnaval e Corpus Christi, sem expediente bancário). */
export function bankHolidays(y: number): Set<ISODate> {
  const e = easter(y);
  return new Set([
    ...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(md => `${y}-${md}`),
    addDays(e, -48), addDays(e, -47), addDays(e, -2), addDays(e, 60),
  ]);
}
export function isBusinessDay(d: ISODate) {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  return wd !== 0 && wd !== 6 && !bankHolidays(parts(d).y).has(d);
}
/** Primeiro dia útil do mês de `d`. */
export function firstBusinessDay(d: ISODate): ISODate {
  let x = monthStart(d);
  while (!isBusinessDay(x)) x = addDays(x, 1);
  return x;
}
export const monthEnd = (d: ISODate): ISODate => { const p = parts(d); return ymd(p.y, p.m, daysInMonth(p.y, p.m)); };
/** '2026-09' → '2026-09-01' */
export const monthKeyToDate = (k: string): ISODate => k.slice(0, 7) + '-01';
export const monthKey = (d: ISODate) => d.slice(0, 7);
export const dayOfMonth = (y: number, m: number, day: number) => ymd(y, m, Math.min(day, daysInMonth(y, m)));

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthShort = (m: number) => MESES[m - 1];
export const monthLong = (m: number) => MESES_LONGOS[m - 1];
/** '2026-09-05' → '05/09/2026' */
export const fmtDate = (d: ISODate | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
/** '2026-09-05' → '05/09' */
export const fmtDayMonth = (d: ISODate | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
/** '2026-09-01' → 'set/26' */
export const fmtMonth = (d: ISODate) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`;
/** '2026-09-01' → 'setembro de 2026' */
export const fmtMonthLong = (d: ISODate) => `${MESES_LONGOS[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const weekday = (d: ISODate) => DIAS[new Date(d + 'T00:00:00Z').getUTCDay()];

/**
 * Interpreta datas vindas de arquivos: Date do SheetJS, número serial do Excel,
 * 'dd/mm/aaaa', 'dd/mm/aa', 'aaaa-mm-dd', 'aaaa-mm-ddT00:00:00Z'.
 * Datas do Excel/SheetJS são tratadas como calendário (componentes UTC) — nunca convertidas de fuso.
 */
export function parseDate(v: unknown, refYear?: number): ISODate | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS cria datas "meia-noite UTC" (ou deslocadas alguns segundos); arredonda para o dia mais próximo.
    const t = new Date(v.getTime() + 12 * 3600 * 1000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const mo = +m[2], d = +m[1];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return ymd(y, mo, d);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return ymd(y, mo, d);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m && refYear) return ymd(refYear, +m[2], +m[1]);
  return null;
}
