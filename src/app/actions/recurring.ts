'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isISODate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { safe, writeTx, type ActionResult } from '@/server/context';
import { deactivateRule, saveRule, type RuleInput } from '@/server/domain/recurring';
import { DomainError } from '@/server/domain/types';

export async function saveRecurringAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const id = s('id') || undefined;
  const r = await safe(() => writeTx(async ctx => {
    const abs = toCents(s('amount'));
    if (!abs) throw new DomainError('Informe o valor.');
    const [hk, hid] = s('holder').split(':');
    if (!isISODate(s('start_date'))) throw new DomainError('Data de início inválida.');
    if (s('end_date') && !isISODate(s('end_date'))) throw new DomainError('Data de fim inválida.');
    const freq = s('frequency') as RuleInput['frequency'];
    if (!['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'].includes(freq)) throw new DomainError('Frequência inválida.');
    const input: RuleInput = {
      description: s('description'), amount_cents: (s('direction') === 'in' ? 1 : -1) * Math.abs(abs),
      account_id: hk === 'a' ? hid : null, card_id: hk === 'c' ? hid : null, category_id: s('category_id') || null,
      frequency: freq, interval_count: Number(s('interval_count')) || 1, interval_unit: (s('interval_unit') || 'MONTH') as RuleInput['interval_unit'],
      start_date: s('start_date'), end_date: s('end_date') || null, day_of_month: s('day_of_month') ? Number(s('day_of_month')) : null,
      match_pattern: s('match_pattern') || null, amount_tolerance_pct: Number(s('tolerance')) || 10, is_active: true,
    };
    return saveRule(ctx, input, id);
  }));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  redirect('/recorrencias');
}

export async function deactivateRecurringAction(id: string) {
  const r = await safe(() => writeTx(ctx => deactivateRule(ctx, id)), 'Recorrência desativada.');
  revalidatePath('/', 'layout');
  return r;
}
