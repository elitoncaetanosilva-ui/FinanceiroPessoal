'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isISODate, today, type ISODate } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { readCtx, safe, writeTx, type ActionResult } from '@/server/context';
import { learnRule } from '@/server/domain/classification';
import { balanceAt } from '@/server/domain/balances';
import * as M from '@/server/domain/movements';
import { listMovements, type MovementFilters, type MovementListItem } from '@/server/domain/queries';
import { DomainError, type SplitInput } from '@/server/domain/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const done = () => revalidatePath('/', 'layout');
function cents(v: string, field = 'Valor') {
  const c = toCents(v);
  if (c == null) throw new DomainError(`${field} inválido.`);
  return c;
}
function date(v: string, field = 'Data') {
  if (!isISODate(v)) throw new DomainError(`${field} inválida.`);
  return v;
}

/** Criação pelos formulários rápidos (despesa, receita, cartão, transferência, pagamento, ajuste). */
export async function createMovementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const tipo = str(fd, 'tipo');
  const r = await safe(() => writeTx(async ctx => {
    const d = date(str(fd, 'date'));
    const description = str(fd, 'description');
    const notes = opt(fd, 'notes');
    switch (tipo) {
      case 'despesa':
      case 'receita':
      case 'cartao': {
        const abs = Math.abs(cents(str(fd, 'amount')));
        if (!abs) throw new DomainError('Informe o valor.');
        const sign = tipo === 'receita' ? 1 : -1;
        const holder = str(fd, 'holder');                       // "a:<id>" ou "c:<id>"
        const [kind, id] = holder.split(':');
        if (!id || !['a', 'c'].includes(kind)) throw new DomainError('Escolha a conta ou o cartão.');
        const n = Math.max(1, Number(str(fd, 'installments') || '1'));
        const categoryId = opt(fd, 'category_id');
        const common = { description: description || (tipo === 'receita' ? 'Receita' : 'Despesa'), notes, categoryId };
        if (n > 1) {
          const g = await M.createInstallmentPurchase(ctx, { ...common, accountId: kind === 'a' ? id : null, cardId: kind === 'c' ? id : null, date: d, totalCents: sign * abs, installments: n });
          return g.ids[0];
        }
        return M.createSimple(ctx, { ...common, accountId: kind === 'a' ? id : null, cardId: kind === 'c' ? id : null, amountCents: sign * abs, date: d });
      }
      case 'transferencia': {
        const t = await M.createTransfer(ctx, { fromAccountId: str(fd, 'from'), toAccountId: str(fd, 'to'), amountCents: Math.abs(cents(str(fd, 'amount'))), date: d, description, notes });
        return t.outId;
      }
      case 'pagamento': {
        const p = await M.createCardPayment(ctx, { cardId: str(fd, 'card_id'), accountId: opt(fd, 'account_id'), amountCents: Math.abs(cents(str(fd, 'amount'))), date: d, statementId: opt(fd, 'statement_id'), description: description || undefined, notes });
        return p.accountSideId ?? p.cardSideId;
      }
      case 'ajuste': {
        const accountId = str(fd, 'account_id');
        let amount: number;
        if (str(fd, 'mode') === 'saldo') {
          const acc = (await ctx.q.query<{ id: string; opening_balance_cents: number; opening_balance_date: ISODate }>('select id, opening_balance_cents, opening_balance_date from accounts where id=$1 and user_id=$2', [accountId, ctx.userId]))[0];
          if (!acc) throw new DomainError('Conta não encontrada.');
          const bank = cents(str(fd, 'amount'), 'Saldo do banco');
          amount = bank - (await balanceAt(ctx, acc, d));
          if (amount === 0) throw new DomainError('O saldo do app já é igual ao informado. Nenhum ajuste necessário.');
        } else amount = cents(str(fd, 'amount'));
        return M.createAdjustment(ctx, { accountId, amountCents: amount, date: d, reason: str(fd, 'reason'), notes });
      }
      default: throw new DomainError('Tipo de lançamento inválido.');
    }
  }));
  if (!r.ok) return r;
  done();
  const next = str(fd, 'next');
  if (next === 'another') return { ok: true, message: 'Lançamento salvo. Pode lançar o próximo.' };
  redirect(`/movimentos/${r.data}?salvo=1`);
}

export async function updateMovementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, 'id');
  const r = await safe(() => writeTx(async ctx => {
    const m = await M.getMovementRow(ctx, id);
    const holder = str(fd, 'holder');
    const [hk, hid] = holder ? holder.split(':') : [null, null];
    const amountAbs = str(fd, 'amount') ? Math.abs(cents(str(fd, 'amount'))) : null;
    const sign = m.amount_cents < 0 ? -1 : 1;
    const flip = str(fd, 'direction');   // 'in' | 'out' | ''
    const newSign = flip === 'in' ? 1 : flip === 'out' ? -1 : sign;
    return M.updateMovement(ctx, id, {
      description: str(fd, 'description'),
      date: date(str(fd, 'date')),
      amountCents: amountAbs != null ? newSign * amountAbs : undefined,
      notes: str(fd, 'notes'),
      competence: str(fd, 'competence') ? `${str(fd, 'competence')}-01` : undefined,
      dueDate: str(fd, 'due_date') ? date(str(fd, 'due_date'), 'Vencimento') : m.due_date ? null : undefined,
      accountId: hk === 'a' ? hid : hk === 'c' ? null : undefined,
      cardId: hk === 'c' ? hid : hk === 'a' ? null : undefined,
      statementId: opt(fd, 'statement_id'),
    }, Number(str(fd, 'version')) || undefined);
  }), 'Alterações salvas.');
  done();
  return r;
}

export async function classifyAction(ids: string[], categoryId: string, learn?: { pattern: string; direction: 'IN' | 'OUT' | null } | null): Promise<ActionResult<{ learned: number }>> {
  const r = await safe(() => writeTx(async ctx => {
    for (const id of ids) await M.classifyMovement(ctx, id, categoryId);
    const learned = learn?.pattern ? await learnRule(ctx, { pattern: learn.pattern, categoryId, direction: learn.direction, applyToPending: true }) : 0;
    return { learned };
  }));
  done();
  return r;
}

export async function setSplitsAction(id: string, splits: { categoryId: string | null; amount: string }[], direction: 1 | -1): Promise<ActionResult> {
  const r = await safe(() => writeTx(async ctx => {
    const parsed: SplitInput[] = splits.map(s => {
      const c = toCents(s.amount);
      if (c == null || c === 0) throw new DomainError('Valor do rateio inválido.');
      if (!s.categoryId) throw new DomainError('Escolha a categoria de cada parte.');
      return { categoryId: s.categoryId, amountCents: direction * Math.abs(c) };
    });
    await M.setSplits(ctx, id, parsed);
  }), 'Rateio salvo.');
  done();
  return r;
}

export async function deleteMovementAction(id: string, scope: 'one' | 'future'): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => M.deleteMovement(ctx, id, scope)));
  if (!r.ok) return r;
  done();
  redirect('/movimentos?excluido=1');
}

export async function realizeAction(id: string, d?: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => M.realizePlanned(ctx, id, { date: d && isISODate(d) ? d : today() })), 'Marcado como realizado.');
  done();
  return r;
}

export async function markCardPaymentAction(id: string, cardId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(async ctx => {
    const m = await M.getMovementRow(ctx, id);
    if (m.account_id) await M.makeAccountMovementCardPayment(ctx, id, cardId);
    else await M.makeCardMovementPayment(ctx, id);
  }), 'Marcado como pagamento de fatura.');
  done();
  return r;
}

export async function linkTransferAction(id: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(async ctx => {
    const link = await M.linkTransferCounterpart(ctx, id);
    if (!link) throw new DomainError('Não encontrei o outro lado (conta própria, mesmo valor, até 3 dias). Importe o extrato da outra conta ou lance a transferência manualmente.');
  }), 'Transferência vinculada.');
  done();
  return r;
}

export async function loadMoreAction(filters: MovementFilters, cursor: { date: string; id: string }): Promise<{ items: MovementListItem[]; next: { date: string; id: string } | null }> {
  const ctx = await readCtx();
  return listMovements(ctx, filters, cursor, 60);
}
