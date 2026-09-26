import * as XLSX from '@e965/xlsx';
import { norm, fixMojibake } from '@/lib/text';
import type { ISODate } from '@/lib/dates';
import type { CanonicalRow } from './types';

export type Cell = string | number | boolean | Date | null;

export function readWorkbook(bytes: Buffer) {
  return XLSX.read(bytes, { type: 'buffer', cellDates: true, dense: false });
}
export function sheetRows(ws: XLSX.WorkSheet): Cell[][] {
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
}
export const cellText = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString() : fixMojibake(String(v)).trim());
export const cellNorm = (v: Cell) => norm(cellText(v));

export const isXls = (b: Buffer) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
export const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** Decodifica texto: UTF-8 (com ou sem BOM) ou Windows-1252/latin1. */
export function decodeText(b: Buffer): string {
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { s = new TextDecoder('latin1').decode(b); }
  return s.replace(/^﻿/, '');
}

/** "Parcela 3 de 10" | "3/10" | "Parcela 3/10" */
export function parseInstallment(v: unknown): { n: number; total: number } | null {
  const s = String(v ?? '').toLowerCase();
  const m = s.match(/(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})/);
  if (!m) return null;
  const n = +m[1], total = +m[2];
  if (!n || !total || n > total || total > 120) return null;
  return total > 1 ? { n, total } : null;
}

/** Parser CSV simples com aspas (RFC 4180). */
export function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

export function periodOf(rows: CanonicalRow[]): { start: ISODate | null; end: ISODate | null } {
  const ds = rows.filter(r => !r.error).map(r => r.date).sort();
  return { start: ds[0] ?? null, end: ds[ds.length - 1] ?? null };
}

export const amountKey = (c: number) => String(Math.abs(c));
