'use server';
import { revalidatePath } from 'next/cache';
import { toCents } from '@/lib/money';
import { safe, writeTx } from '@/server/context';
import { copyBudgetYear, setBudgetValues } from '@/server/domain/budget';
import { DomainError } from '@/server/domain/types';

const parse = (v: string) => { const c = toCents(v.trim() || '0'); if (c == null) throw new DomainError('Valor inválido.'); return c; };

export async function setBudgetCellAction(year: number, categoryId: string, month: number, value: string) {
  const r = await safe(() => writeTx(ctx => setBudgetValues(ctx, year, categoryId, [month], parse(value))));
  revalidatePath('/orcamento', 'layout');
  return r;
}

export async function applyForwardAction(year: number, categoryId: string, fromMonth: number, value: string) {
  const months = Array.from({ length: 12 - fromMonth + 1 }, (_, i) => fromMonth + i);
  const r = await safe(() => writeTx(ctx => setBudgetValues(ctx, year, categoryId, months, parse(value))), 'Aplicado aos meses seguintes.');
  revalidatePath('/orcamento', 'layout');
  return r;
}

export async function copyYearAction(fromYear: number, toYear: number) {
  const r = await safe(() => writeTx(ctx => copyBudgetYear(ctx, fromYear, toYear)), `Orçamento de ${fromYear} copiado para ${toYear}.`);
  revalidatePath('/orcamento', 'layout');
  return r;
}
