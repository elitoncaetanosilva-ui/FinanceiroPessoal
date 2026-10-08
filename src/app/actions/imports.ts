'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isISODate } from '@/lib/dates';
import { safe, writeTx, type ActionResult } from '@/server/context';
import { audit } from '@/server/domain/audit';
import { deleteMovement } from '@/server/domain/movements';
import { DomainError } from '@/server/domain/types';
import * as P from '@/server/import/pipeline';

const done = () => revalidatePath('/', 'layout');

export async function uploadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const file = fd.get('file');
  const r = await safe(async () => {
    if (!(file instanceof File) || !file.size) throw new DomainError('Escolha um arquivo.');
    if (file.size > P.MAX_FILE_BYTES) throw new DomainError('Arquivo maior que 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    return writeTx(ctx => P.createBatch(ctx, { name: file.name, bytes }));
  });
  if (!r.ok) return r;
  redirect(`/importacoes/${r.data}`);
}

export async function setHolderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const batchId = String(fd.get('batch_id'));
  const holder = String(fd.get('holder') ?? '');
  const due = String(fd.get('due_date') ?? '');
  const [k, id] = holder.split(':');
  const r = await safe(() => writeTx(ctx => P.setBatchHolder(ctx, batchId, {
    accountId: k === 'a' ? id : null, cardId: k === 'c' ? id : null, dueDate: isISODate(due) ? due : null,
  })));
  done();
  return r;
}

export async function setRowAction(rowId: string, d: { action?: 'IMPORT' | 'SKIP' | 'LINK'; categoryId?: string | null; kind?: 'NORMAL' | 'CARD_PAYMENT'; targetCardId?: string | null; learnPattern?: string | null }) {
  return safe(() => writeTx(ctx => P.setRowDecision(ctx, rowId, d)));
}

export async function classifySimilarAction(batchId: string, rowId: string, categoryId: string) {
  const r = await safe(() => writeTx(ctx => P.classifySimilarRows(ctx, batchId, rowId, categoryId)));
  return r;
}

export async function commitAction(batchId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => P.commitBatch(ctx, batchId)));
  if (!r.ok) return r;
  done();
  redirect(`/importacoes/${batchId}?confirmado=1`);
}

export async function discardAction(batchId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => P.discardBatch(ctx, batchId)));
  if (!r.ok) return r;
  done();
  redirect('/importacoes');
}

export async function revertAction(batchId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => P.revertBatch(ctx, batchId)), 'Lote desfeito.');
  done();
  return r;
}

/** Usa o "SALDO ANTERIOR" do extrato como saldo inicial da conta (implantação). */
export async function applyOpeningBalanceAction(batchId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(async ctx => {
    const b = await P.getBatch(ctx, batchId);
    const ob = b.info.parsed.openingBalance;
    if (!b.account_id || !ob) throw new DomainError('Este arquivo não traz saldo anterior.');
    const old = (await ctx.q.query<{ opening_balance_cents: number; opening_balance_date: string }>('select opening_balance_cents, opening_balance_date from accounts where id=$1 and user_id=$2', [b.account_id, ctx.userId]))[0];
    await ctx.q.query('update accounts set opening_balance_cents=$3, opening_balance_date=$4, updated_at=now() where id=$1 and user_id=$2', [b.account_id, ctx.userId, ob.balanceCents, ob.date]);
    await audit(ctx, 'account', b.account_id, 'UPDATE', { field: 'saldo inicial', old: `${old.opening_balance_cents} em ${old.opening_balance_date}`, new: `${ob.balanceCents} em ${ob.date}` }, { batchId });
  }), 'Saldo inicial da conta atualizado.');
  done();
  return r;
}

/** Remove um lançamento que sumiu da fatura aberta (estorno/alteração do banco). */
export async function removeMissingAction(movementId: string): Promise<ActionResult> {
  const r = await safe(() => writeTx(ctx => deleteMovement(ctx, movementId, 'one')), 'Removido.');
  done();
  return r;
}
