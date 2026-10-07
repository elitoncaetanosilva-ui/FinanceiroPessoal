'use server';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safe, writeTx, type ActionResult } from '@/server/context';
import { DomainError } from '@/server/domain/types';
import { applyCaixa, parseCaixa, type CaixaParsed } from '@/server/import/planilha';
import { applySync, syncOptionsFrom } from '@/server/import/planilha-sync';

export async function uploadCaixaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const file = fd.get('file');
  const r = await safe(async () => {
    if (!(file instanceof File) || !file.size) throw new DomainError('Escolha o arquivo .xlsx da planilha.');
    if (file.size > 8 * 1024 * 1024) throw new DomainError('Arquivo maior que 8 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new DomainError('Envie a planilha em .xlsx (Arquivo → Fazer download → Microsoft Excel).');
    const parsed = parseCaixa(bytes);
    return writeTx(async ctx => {
      const b = await ctx.q.query<{ id: string }>(
        `insert into import_batches(user_id, file_name, file_sha256, file_size, importer_id, institution_name, info)
         values ($1,$2,$3,$4,'caixa-planilha','Planilha CAIXA',$5) returning id`,
        [ctx.userId, file.name.slice(0, 200), createHash('sha256').update(bytes).digest('hex'), bytes.length, JSON.stringify({ caixa: parsed })]);
      return b[0].id;
    });
  });
  if (!r.ok) return r;
  redirect(`/configuracoes/planilha?lote=${r.data}`);
}

export async function applyCaixaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const batchId = String(fd.get('batch_id'));
  const r = await safe(() => writeTx(async ctx => {
    const b = (await ctx.q.query<{ status: string; info: { caixa: CaixaParsed } }>('select status, info from import_batches where id=$1 and user_id=$2 and importer_id=\'caixa-planilha\' for update', [batchId, ctx.userId]))[0];
    if (!b) throw new DomainError('Planilha não encontrada. Envie de novo.');
    const p = b.info.caixa;
    const cardMap: Record<string, string> = {};
    p.cardNames.forEach((n, i) => { const v = String(fd.get(`card_${i}`) ?? ''); if (v) cardMap[n] = v; });
    const month = (k: string) => { const v = String(fd.get(k) ?? ''); if (!/^\d{4}-\d{2}$/.test(v)) throw new DomainError('Mês de corte inválido.'); return `${v}-01`; };
    const accountId = String(fd.get('account_id') ?? '');
    if (!accountId) throw new DomainError('Escolha a conta que recebe os lançamentos da aba CASH.');
    const res = await applyCaixa(ctx, p, {
      accountId, cardMap, cashCutoff: month('cash_cutoff'), cardCutoff: month('card_cutoff'),
      importHistory: fd.get('history') === 'on', importBudgets: fd.get('budgets') === 'on',
    });
    await ctx.q.query(`update import_batches set status='COMMITTED', committed_at=now(), stats=$2 where id=$1`, [batchId, JSON.stringify(res)]);
    return res;
  }));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  const d = r.data!;
  return { ok: true, message: `Migração concluída: ${d.cash} lançamentos de conta, ${d.card} de cartão, ${d.incomes} entradas mensais e ${d.budgets} valores de orçamento.${d.unknown.length ? ` Subcategorias não encontradas: ${d.unknown.join(', ')}.` : ''}` };
}

export async function applySyncAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const batchId = String(fd.get('batch_id'));
  const r = await safe(() => writeTx(async ctx => {
    const b = (await ctx.q.query<{ status: string; info: { caixa: CaixaParsed } }>(
      `select status, info from import_batches where id=$1 and user_id=$2 and importer_id='caixa-planilha' for update`, [batchId, ctx.userId]))[0];
    if (!b) throw new DomainError('Planilha não encontrada. Envie de novo.');
    if (b.status === 'COMMITTED') throw new DomainError('Esta planilha já foi aplicada. Para sincronizar de novo, envie o arquivo outra vez.');
    const o = syncOptionsFrom(k => { const v = fd.get(k); return v == null ? null : String(v); }, b.info.caixa.cardNames);
    if (!o) throw new DomainError('Escolha a conta da aba CASH.');
    const offered = String(fd.get('novos') ?? '').split(',').filter(Boolean);
    const chosen = new Set(fd.getAll('incluir').map(String));
    o.exclude = offered.filter(k => !chosen.has(k));
    return applySync(ctx, batchId, b.info.caixa, o);
  }));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  const d = r.data!;
  return { ok: true, message: `Sincronização concluída: ${d.created} lançamento(s) incluído(s) e ${d.filled} categoria(s) preenchida(s).` };
}
