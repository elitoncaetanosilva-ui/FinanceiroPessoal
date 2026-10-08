'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { toCents } from '@/lib/money';
import { isISODate } from '@/lib/dates';
import { norm } from '@/lib/text';
import { safe, writeTx, type ActionResult } from '@/server/context';
import { audit } from '@/server/domain/audit';
import { assignPendingBatches } from '@/server/import/pipeline';
import { detectCardPayments } from '@/server/domain/movements';
import { deleteCheckpoint, setCheckpoint } from '@/server/domain/balances';
import { DomainError } from '@/server/domain/types';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const money = (v: FormDataEntryValue | null) => { const c = toCents(String(v ?? '').trim() || '0'); if (c == null) throw new DomainError('Valor inválido.'); return c; };
const bool = (v: FormDataEntryValue | null) => v === 'on' || v === 'true' || v === '1';
const list = (v: FormDataEntryValue | null) => String(v ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
const done = () => revalidatePath('/', 'layout');

function zodMsg(e: unknown): never {
  if (e instanceof z.ZodError) throw new DomainError(e.issues[0]?.message ?? 'Dados inválidos.');
  throw e;
}

// ------------------------------------------------------------------ Contas
const AccountSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da conta.').max(80),
  type: z.enum(['CHECKING', 'SAVINGS', 'DIGITAL', 'INVESTMENT', 'WALLET', 'CASH', 'OTHER']),
  institution_id: z.string().uuid().nullable(),
  branch: z.string().max(20).nullable(),
  number: z.string().max(30).nullable(),
  opening_balance_cents: z.number().int(),
  opening_balance_date: z.string().refine(isISODate, 'Data do saldo inicial inválida.'),
  in_available_balance: z.boolean(),
  color: z.string().max(20).nullable(),
});

export async function saveAccountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = opt(fd.get('id'));
  const r = await safe(async () => {
    let data: z.infer<typeof AccountSchema>;
    try {
      data = AccountSchema.parse({
        name: fd.get('name'), type: fd.get('type'), institution_id: opt(fd.get('institution_id')), branch: opt(fd.get('branch')),
        number: opt(fd.get('number')), opening_balance_cents: money(fd.get('opening_balance')),
        opening_balance_date: fd.get('opening_balance_date'), in_available_balance: bool(fd.get('in_available_balance')), color: opt(fd.get('color')),
      });
    } catch (e) { zodMsg(e); }
    return writeTx(async ctx => {
      const vals = [data.name, data.type, data.institution_id, data.branch, data.number, data.opening_balance_cents, data.opening_balance_date, data.in_available_balance, data.color];
      if (id) {
        const old = (await ctx.q.query<Record<string, unknown>>('select * from accounts where id=$1 and user_id=$2', [id, ctx.userId]))[0];
        if (!old) throw new DomainError('Conta não encontrada.');
        await ctx.q.query(
          `update accounts set name=$3, type=$4, institution_id=$5, branch=$6, number=$7, opening_balance_cents=$8,
             opening_balance_date=$9, in_available_balance=$10, color=$11, updated_at=now() where id=$1 and user_id=$2`,
          [id, ctx.userId, ...vals]);
        for (const [f, col] of [['saldo inicial', 'opening_balance_cents'], ['data do saldo inicial', 'opening_balance_date'], ['nome', 'name']] as const) {
          const nv = (data as Record<string, unknown>)[col];
          if (String(old[col]) !== String(nv)) await audit(ctx, 'account', id, 'UPDATE', { field: f, old: old[col], new: nv });
        }
        return id;
      }
      const row = await ctx.q.query<{ id: string }>(
        `insert into accounts(user_id, name, type, institution_id, branch, number, opening_balance_cents, opening_balance_date, in_available_balance, color)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [ctx.userId, ...vals]);
      await audit(ctx, 'account', row[0].id, 'CREATE');
      await assignPendingBatches(ctx);
      return row[0].id;
    });
  });
  if (!r.ok) return r;
  done();
  const back = opt(fd.get('back'));
  redirect(back && back.startsWith('/') ? back : `/contas/${r.data}`);
}

export async function setAccountActiveAction(id: string, active: boolean) {
  const r = await safe(() => writeTx(async ctx => {
    await ctx.q.query('update accounts set is_active=$3, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, active]);
    await audit(ctx, 'account', id, active ? 'ACTIVATE' : 'DEACTIVATE');
  }));
  done();
  return r;
}

/** Saldo informado pelo usuário para conferir com o calculado pelo app. */
export async function saveCheckpointAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await safe(() => writeTx(async ctx => {
    const id = String(fd.get('account_id') ?? ''), date = String(fd.get('date') ?? ''), cents = toCents(fd.get('balance'));
    if (!isISODate(date)) throw new DomainError('Informe a data do saldo.');
    if (cents == null) throw new DomainError('Informe o saldo do banco.');
    await setCheckpoint(ctx, id, date, cents);
    await audit(ctx, 'account', id, 'CHECKPOINT', null, { date, balance_cents: cents });
  }), 'Saldo registrado.');
  done();
  return r;
}

export async function deleteCheckpointAction(accountId: string, date: string) {
  const r = await safe(() => writeTx(ctx => deleteCheckpoint(ctx, accountId, date)));
  done();
  return r;
}

// ------------------------------------------------------------------ Cartões
const CardSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cartão.').max(80),
  institution_id: z.string().uuid().nullable(),
  brand: z.string().max(30).nullable(),
  last4: z.string().regex(/^\d{4}$/, 'Final do cartão: 4 dígitos.').nullable(),
  extra_last4: z.array(z.string().regex(/^\d{4}$/, 'Finais adicionais: 4 dígitos cada.')),
  limit_cents: z.number().int().min(0),
  closing_day: z.number().int().min(1, 'Dia de fechamento entre 1 e 31.').max(31, 'Dia de fechamento entre 1 e 31.'),
  due_day: z.number().int().min(1, 'Dia de vencimento entre 1 e 31.').max(31, 'Dia de vencimento entre 1 e 31.'),
  payment_account_id: z.string().uuid().nullable(),
  payment_patterns: z.array(z.string().max(60)),
  color: z.string().max(20).nullable(),
});

export async function saveCardAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = opt(fd.get('id'));
  const r = await safe(async () => {
    let data: z.infer<typeof CardSchema>;
    try {
      data = CardSchema.parse({
        name: fd.get('name'), institution_id: opt(fd.get('institution_id')), brand: opt(fd.get('brand')), last4: opt(fd.get('last4')),
        extra_last4: list(fd.get('extra_last4')), limit_cents: money(fd.get('limit')), closing_day: Number(fd.get('closing_day')),
        due_day: Number(fd.get('due_day')), payment_account_id: opt(fd.get('payment_account_id')),
        payment_patterns: list(fd.get('payment_patterns')).map(norm), color: opt(fd.get('color')),
      });
    } catch (e) { zodMsg(e); }
    return writeTx(async ctx => {
      const vals = [data.name, data.institution_id, data.brand, data.last4, data.extra_last4, data.limit_cents, data.closing_day, data.due_day, data.payment_account_id, data.payment_patterns, data.color];
      if (id) {
        const old = (await ctx.q.query<Record<string, unknown>>('select * from credit_cards where id=$1 and user_id=$2', [id, ctx.userId]))[0];
        if (!old) throw new DomainError('Cartão não encontrado.');
        await ctx.q.query(
          `update credit_cards set name=$3, institution_id=$4, brand=$5, last4=$6, extra_last4=$7, limit_cents=$8, closing_day=$9, due_day=$10,
             payment_account_id=$11, payment_patterns=$12, color=$13, updated_at=now() where id=$1 and user_id=$2`, [id, ctx.userId, ...vals]);
        for (const [f, col] of [['dia de fechamento', 'closing_day'], ['dia de vencimento', 'due_day'], ['limite', 'limit_cents']] as const) {
          const nv = (data as Record<string, unknown>)[col];
          if (String(old[col]) !== String(nv)) await audit(ctx, 'card', id, 'UPDATE', { field: f, old: old[col], new: nv });
        }
        await detectCardPayments(ctx);
        // faturas futuras (ainda sem data real informada por arquivo) acompanham os novos dias
        if (old.closing_day !== data.closing_day || old.due_day !== data.due_day) {
          const { computeStatementDates } = await import('@/server/domain/statements');
          const sts = await ctx.q.query<{ id: string; due_month: string }>(
            `select id, due_month from card_statements where card_id=$1 and closing_date > current_date and reported_total_cents is null`, [id]);
          for (const s of sts) {
            const d = computeStatementDates(data, s.due_month);
            await ctx.q.query('update card_statements set closing_date=$2, due_date=$3, updated_at=now() where id=$1', [s.id, d.closing_date, d.due_date]);
          }
        }
        return id;
      }
      const row = await ctx.q.query<{ id: string }>(
        `insert into credit_cards(user_id, name, institution_id, brand, last4, extra_last4, limit_cents, closing_day, due_day, payment_account_id, payment_patterns, color)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [ctx.userId, ...vals]);
      await audit(ctx, 'card', row[0].id, 'CREATE');
      await detectCardPayments(ctx);
      await assignPendingBatches(ctx);
      return row[0].id;
    });
  });
  if (!r.ok) return r;
  done();
  const back = opt(fd.get('back'));
  redirect(back && back.startsWith('/') ? back : `/cartoes/${r.data}`);
}

export async function setCardActiveAction(id: string, active: boolean) {
  const r = await safe(() => writeTx(async ctx => {
    await ctx.q.query('update credit_cards set is_active=$3, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, active]);
    await audit(ctx, 'card', id, active ? 'ACTIVATE' : 'DEACTIVATE');
  }));
  done();
  return r;
}

export async function saveStatementDatesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get('id'));
  const closing = String(fd.get('closing_date')), due = String(fd.get('due_date'));
  const settled = bool(fd.get('settled_manually'));
  const r = await safe(() => writeTx(async ctx => {
    if (!isISODate(closing) || !isISODate(due)) throw new DomainError('Datas inválidas.');
    if (closing >= due) throw new DomainError('O fechamento precisa ser antes do vencimento.');
    const old = (await ctx.q.query<Record<string, unknown>>('select * from card_statements where id=$1 and user_id=$2', [id, ctx.userId]))[0];
    if (!old) throw new DomainError('Fatura não encontrada.');
    await ctx.q.query('update card_statements set closing_date=$3, due_date=$4, settled_manually=$5, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, closing, due, settled]);
    await audit(ctx, 'statement', id, 'UPDATE', { field: 'datas', old: `${old.closing_date} → ${old.due_date} ${old.settled_manually ? '(quitada)' : ''}`, new: `${closing} → ${due} ${settled ? '(quitada)' : ''}` });
  }), 'Fatura atualizada.');
  done();
  return r;
}

// ------------------------------------------------------------------ Instituições
export async function saveInstitutionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = opt(fd.get('id'));
  const name = String(fd.get('name') ?? '').trim();
  const code = opt(fd.get('code'));
  const r = await safe(() => writeTx(async ctx => {
    if (!name) throw new DomainError('Informe o nome.');
    const dup = await ctx.q.query('select 1 from institutions where user_id=$1 and lower(name)=lower($2) and id is distinct from $3::uuid', [ctx.userId, name, id]);
    if (dup[0]) throw new DomainError('Já existe uma instituição com esse nome.');
    if (id) await ctx.q.query('update institutions set name=$3, code=$4, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, name, code]);
    else await ctx.q.query('insert into institutions(user_id, name, code) values ($1,$2,$3)', [ctx.userId, name, code]);
  }), 'Instituição salva.');
  done();
  return r;
}
export async function setInstitutionActiveAction(id: string, active: boolean) {
  const r = await safe(() => writeTx(ctx => ctx.q.query('update institutions set is_active=$3, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, active])));
  done();
  return r;
}

// ------------------------------------------------------------------ Categorias
export async function saveCategoryAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = opt(fd.get('id'));
  const name = String(fd.get('name') ?? '').trim();
  const parentId = opt(fd.get('parent_id'));
  const nature = String(fd.get('nature') ?? '');
  const section = String(fd.get('section') ?? 'OUT');
  const r = await safe(() => writeTx(async ctx => {
    if (!name) throw new DomainError('Informe o nome.');
    if (!['INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT', 'FINANCING', 'ADJUSTMENT'].includes(nature)) throw new DomainError('Natureza inválida.');
    if (!['IN', 'OUT'].includes(section)) throw new DomainError('Seção inválida.');
    let sec = section;
    if (parentId) {
      const p = (await ctx.q.query<{ section: string; parent_id: string | null }>('select section, parent_id from categories where id=$1 and user_id=$2', [parentId, ctx.userId]))[0];
      if (!p || p.parent_id) throw new DomainError('Categoria pai inválida (use uma categoria de 1º nível).');
      sec = p.section;
    }
    const dup = await ctx.q.query('select 1 from categories where user_id=$1 and coalesce(parent_id::text,\'\')=coalesce($2::text,\'\') and lower(name)=lower($3) and id is distinct from $4::uuid', [ctx.userId, parentId, name, id]);
    if (dup[0]) throw new DomainError('Já existe uma categoria com esse nome neste nível.');
    if (id) {
      const old = (await ctx.q.query<{ name: string; nature: string; system_key: string | null }>('select name, nature, system_key from categories where id=$1 and user_id=$2', [id, ctx.userId]))[0];
      if (!old) throw new DomainError('Categoria não encontrada.');
      if (old.system_key && old.nature !== nature) throw new DomainError('A natureza de uma categoria de sistema não pode ser alterada.');
      await ctx.q.query('update categories set name=$3, nature=$4, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, name, nature]);
      if (old.nature !== nature) await audit(ctx, 'category', id, 'UPDATE', { field: 'natureza', old: old.nature, new: nature });
      if (old.name !== name) await audit(ctx, 'category', id, 'UPDATE', { field: 'nome', old: old.name, new: name });
    } else {
      const ord = await ctx.q.query<{ n: number }>('select coalesce(max(sort_order),0)+1 as n from categories where user_id=$1 and coalesce(parent_id::text,\'\')=coalesce($2::text,\'\')', [ctx.userId, parentId]);
      await ctx.q.query('insert into categories(user_id, parent_id, name, nature, section, sort_order) values ($1,$2,$3,$4,$5,$6)', [ctx.userId, parentId, name, nature, sec, ord[0].n]);
    }
  }), 'Categoria salva.');
  done();
  return r;
}
export async function setCategoryActiveAction(id: string, active: boolean) {
  const r = await safe(() => writeTx(async ctx => {
    const c = (await ctx.q.query<{ system_key: string | null }>('select system_key from categories where id=$1 and user_id=$2', [id, ctx.userId]))[0];
    if (!c) throw new DomainError('Categoria não encontrada.');
    if (c.system_key && !active) throw new DomainError('Categorias de sistema não podem ser inativadas.');
    await ctx.q.query('update categories set is_active=$3, updated_at=now() where (id=$1 or parent_id=$1) and user_id=$2', [id, ctx.userId, active]);
    await audit(ctx, 'category', id, active ? 'ACTIVATE' : 'DEACTIVATE');
  }));
  done();
  return r;
}

// ------------------------------------------------------------------ Regras de classificação
export async function saveRuleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = opt(fd.get('id'));
  const pattern = norm(fd.get('pattern'));
  const matchType = String(fd.get('match_type') ?? 'CONTAINS');
  const categoryId = opt(fd.get('category_id'));
  const direction = opt(fd.get('direction'));
  const priority = Number(fd.get('priority') ?? 50) || 50;
  const r = await safe(() => writeTx(async ctx => {
    if (pattern.length < 2) throw new DomainError('O padrão precisa ter pelo menos 2 caracteres.');
    if (!['CONTAINS', 'STARTS_WITH', 'EXACT', 'REGEX'].includes(matchType)) throw new DomainError('Tipo inválido.');
    if (matchType === 'REGEX') { try { new RegExp(pattern); } catch { throw new DomainError('Expressão regular inválida.'); } }
    if (!categoryId) throw new DomainError('Escolha a subcategoria.');
    if (direction && !['IN', 'OUT'].includes(direction)) throw new DomainError('Sentido inválido.');
    const cat = await ctx.q.query('select 1 from categories where id=$1 and user_id=$2 and parent_id is not null', [categoryId, ctx.userId]);
    if (!cat[0]) throw new DomainError('Escolha uma subcategoria.');
    if (id) await ctx.q.query('update classification_rules set pattern=$3, match_type=$4, category_id=$5, direction=$6, priority=$7, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, pattern, matchType, categoryId, direction, priority]);
    else await ctx.q.query(`insert into classification_rules(user_id, pattern, match_type, category_id, direction, priority, origin) values ($1,$2,$3,$4,$5,$6,'USER')`, [ctx.userId, pattern, matchType, categoryId, direction, priority]);
  }), 'Regra salva.');
  done();
  return r;
}
export async function setRuleActiveAction(id: string, active: boolean) {
  const r = await safe(() => writeTx(ctx => ctx.q.query('update classification_rules set is_active=$3, updated_at=now() where id=$1 and user_id=$2', [id, ctx.userId, active])));
  done();
  return r;
}
