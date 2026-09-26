import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateMovementAction } from '@/app/actions/movements';
import { ActionForm } from '@/components/forms';
import { ClassifyBox, MovementActions, SplitEditor } from '@/components/movements/DetailClient';
import { Badge, Card, CardTitle, Field, Money, PageHeader, cx, inputClass, textareaClass } from '@/components/ui';
import { fmtDate, fmtMonth } from '@/lib/dates';
import { formatBRL, formatNum } from '@/lib/money';
import { suggestPattern } from '@/lib/text';
import { readCtx } from '@/server/context';
import { history } from '@/server/domain/audit';
import { categoryIndex, listAccounts, listCards, pickerCategories, recentCategoryIds } from '@/server/domain/catalog';
import { getSplits } from '@/server/domain/movements';
import type { MovementRow } from '@/server/domain/movements';

const FIELD_LABEL: Record<string, string> = { CREATE: 'Criado', UPDATE: 'Alterado', CLASSIFY: 'Classificado', DELETE: 'Excluído', LINK: 'Vinculado', CARD_PAYMENT: 'Marcado como pagamento de fatura', IMPORT: 'Importado' };
const SOURCE: Record<string, string> = { MANUAL: 'Lançamento manual', IMPORT: 'Importado de arquivo', RECURRING: 'Recorrência', INSTALLMENT: 'Parcela gerada', MIGRATION: 'Migrado da planilha', SYSTEM: 'Gerado pelo sistema', OPEN_FINANCE: 'Open Finance' };

export default async function Movimento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await readCtx();
  const m = (await ctx.q.query<MovementRow & { account_name: string | null; card_name: string | null; statement_due: string | null; statement_month: string | null; file_name: string | null; group_desc: string | null }>(
    `select m.*, a.name as account_name, c.name as card_name, s.due_date as statement_due, s.due_month as statement_month, b.file_name, g.description as group_desc
     from movements m left join accounts a on a.id=m.account_id left join credit_cards c on c.id=m.card_id
     left join card_statements s on s.id=m.statement_id left join import_batches b on b.id=m.import_batch_id
     left join installment_groups g on g.id=m.installment_group_id
     where m.id=$1 and m.user_id=$2`, [id, ctx.userId]))[0];
  if (!m) notFound();
  const [splits, idx, accounts, cards, hist, recent] = await Promise.all([
    getSplits(ctx, id), categoryIndex(ctx), listAccounts(ctx), listCards(ctx), history(ctx, 'movement', id), recentCategoryIds(ctx),
  ]);
  const linked = m.link_id ? await ctx.q.query<{ id: string; amount_cents: number; account_name: string | null; card_name: string | null; date: string }>(
    `select x.id, x.amount_cents, a.name as account_name, c.name as card_name, x.date from movements x left join accounts a on a.id=x.account_id
     left join credit_cards c on c.id=x.card_id where x.link_id=$1 and x.id<>$2 and x.deleted_at is null`, [m.link_id, id]) : [];
  const siblings = m.installment_group_id ? await ctx.q.query<{ id: string; installment_number: number; status: string; competence: string; amount_cents: number }>(
    'select id, installment_number, status, competence, amount_cents from movements where installment_group_id=$1 and deleted_at is null order by installment_number', [m.installment_group_id]) : [];
  const deleted = !!(m as unknown as { deleted_at: Date | null }).deleted_at;
  const pending = splits.some(s => !s.category_id);
  const cats = pickerCategories(idx);
  const direction = m.amount_cents < 0 ? 'OUT' : 'IN';
  const single = splits.length === 1;
  const holderLabel = m.account_name ?? m.card_name ?? '';

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={m.description} back="/movimentos"
        subtitle={<span className="flex flex-wrap items-center gap-1.5">
          {m.status === 'PLANNED' && <Badge tone="planned">previsto</Badge>}
          {deleted && <Badge tone="danger">excluído</Badge>}
          {m.kind === 'TRANSFER' && <Badge tone="primary">transferência</Badge>}
          {m.kind === 'CARD_PAYMENT' && <Badge tone="primary">pagamento de fatura</Badge>}
          {m.kind === 'ADJUSTMENT' && <Badge tone="planned">ajuste de saldo</Badge>}
          {pending && <Badge tone="warning">pendente de classificação</Badge>}
          <span>{SOURCE[m.source]}{m.file_name ? ` · ${m.file_name}` : ''}</span>
        </span>} />
      {sp.salvo && <p className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">Lançamento salvo.</p>}

      <Card>
        <p className="text-4xl font-bold"><Money cents={m.amount_cents} tone={m.kind === 'NORMAL' ? 'auto' : 'neutral'} /></p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">{m.card_id ? 'Data da compra' : 'Data'}</dt><dd>{fmtDate(m.date)}</dd></div>
          <div><dt className="text-xs text-muted">Competência</dt><dd>{fmtMonth(m.competence)}</dd></div>
          <div><dt className="text-xs text-muted">{m.card_id ? 'Cartão' : 'Conta'}</dt><dd>{holderLabel}</dd></div>
          {m.statement_due && <div><dt className="text-xs text-muted">Fatura</dt><dd><Link className="text-primary" href={`/cartoes/${m.card_id}?fatura=${m.statement_id}`}>{fmtMonth(m.statement_month!)} · vence {fmtDate(m.statement_due)}</Link></dd></div>}
          {m.due_date && <div><dt className="text-xs text-muted">Vencimento</dt><dd>{fmtDate(m.due_date)}</dd></div>}
          {m.paid_date && <div><dt className="text-xs text-muted">Pagamento</dt><dd>{fmtDate(m.paid_date)}</dd></div>}
          {m.installment_total && m.installment_total > 1 && <div><dt className="text-xs text-muted">Parcela</dt><dd><Link className="text-primary" href={`/movimentos?grupo=${m.installment_group_id}`}>{m.installment_number} de {m.installment_total}</Link></dd></div>}
          {m.adjustment_reason && <div className="col-span-2"><dt className="text-xs text-muted">Motivo do ajuste</dt><dd>{m.adjustment_reason}</dd></div>}
        </dl>
        {m.notes && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{m.notes}</p>}
        {linked.length > 0 && (
          <div className="mt-3 border-t border-border pt-3 text-sm">
            <p className="text-xs text-muted">{m.kind === 'CARD_PAYMENT' ? 'Outro lado do pagamento' : 'Outro lado da transferência'}</p>
            {linked.map(l => <Link key={l.id} href={`/movimentos/${l.id}`} className="flex justify-between text-primary"><span>{l.account_name ?? l.card_name} · {fmtDate(l.date)}</span><Money cents={l.amount_cents} /></Link>)}
          </div>
        )}
      </Card>

      {m.kind !== 'CARD_PAYMENT' && !deleted && (
        <Card>
          <CardTitle>Classificação</CardTitle>
          {single ? (
            <ClassifyBox id={id} categories={cats} current={splits[0].category_id} suggestedId={m.suggested_category_id} recent={recent}
              defaultPattern={suggestPattern(m.description)} direction={direction} />
          ) : (
            <ul className="text-sm">{splits.map((s, i) => <li key={i} className="flex justify-between py-1"><span>{idx.label(s.category_id)}</span><Money cents={s.amount_cents} /></li>)}</ul>
          )}
          <details className="mt-4 border-t border-border pt-3" open={!single}>
            <summary className="cursor-pointer text-sm font-medium text-primary">Ratear entre categorias</summary>
            <p className="my-2 text-xs text-muted">Divide este lançamento sem duplicá-lo. Ex.: supermercado R$ 500 = 350 mercado + 100 outros + 50 pet.</p>
            <SplitEditor id={id} amount={m.amount_cents} categories={cats} splits={splits} />
          </details>
        </Card>
      )}

      {siblings.length > 1 && (
        <Card>
          <CardTitle>Parcelas {m.group_desc ? `· ${m.group_desc}` : ''}</CardTitle>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {siblings.map(s => (
              <Link key={s.id} href={`/movimentos/${s.id}`} className={cx('shrink-0 rounded-xl border px-3 py-2 text-center text-xs', s.id === id ? 'border-primary bg-primary-soft' : 'border-border')}>
                <span className="block font-semibold">{s.installment_number}/{m.installment_total}</span>
                <span className="block text-muted">{fmtMonth(s.competence)}</span>
                <span className={s.status === 'PLANNED' ? 'text-planned' : ''}>{formatBRL(Math.abs(s.amount_cents))}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!deleted && (
        <Card>
          <CardTitle>Editar</CardTitle>
          <ActionForm action={updateMovementAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={m.version} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Descrição" className="sm:col-span-2"><input name="description" defaultValue={m.description} className={inputClass} /></Field>
              <Field label="Valor (R$)" hint={splits.length > 1 ? 'Com rateio, altere o valor junto com o rateio.' : undefined}>
                <input name="amount" inputMode="decimal" defaultValue={formatNum(Math.abs(m.amount_cents))} disabled={splits.length > 1 || !!m.link_id && false} className={inputClass} />
              </Field>
              {m.kind === 'NORMAL' && (
                <Field label="Sentido"><select name="direction" defaultValue={m.amount_cents < 0 ? 'out' : 'in'} className={inputClass}><option value="out">Saída / débito</option><option value="in">Entrada / crédito</option></select></Field>
              )}
              <Field label={m.card_id ? 'Data da compra' : 'Data'}><input type="date" name="date" defaultValue={m.date} className={inputClass} /></Field>
              <Field label="Competência (mês)"><input type="month" name="competence" defaultValue={m.competence.slice(0, 7)} className={inputClass} /></Field>
              {!m.link_id && (
                <Field label="Conta ou cartão">
                  <select name="holder" defaultValue={m.account_id ? `a:${m.account_id}` : `c:${m.card_id}`} className={inputClass}>
                    <optgroup label="Contas">{accounts.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>
                    <optgroup label="Cartões">{cards.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
                  </select>
                </Field>
              )}
              <Field label="Vencimento (opcional)"><input type="date" name="due_date" defaultValue={m.due_date ?? ''} className={inputClass} /></Field>
              <Field label="Observação" className="sm:col-span-2"><textarea name="notes" defaultValue={m.notes ?? ''} rows={2} className={textareaClass} /></Field>
            </div>
          </ActionForm>
        </Card>
      )}

      {!deleted && (
        <Card>
          <CardTitle>Ações</CardTitle>
          <MovementActions id={id} planned={m.status === 'PLANNED'} hasSeries={!!m.installment_group_id || !!m.recurring_rule_id}
            isAccountOut={!!m.account_id && m.amount_cents < 0 && m.kind !== 'CARD_PAYMENT'} isCardCredit={!!m.card_id && m.amount_cents > 0 && m.kind !== 'CARD_PAYMENT'}
            isTransferCandidate={!!m.account_id && !m.link_id && m.kind !== 'CARD_PAYMENT'}
            cards={cards.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name }))} />
        </Card>
      )}

      <Card>
        <CardTitle>Histórico</CardTitle>
        {hist.length === 0 ? <p className="text-sm text-muted">Sem alterações registradas.</p> : (
          <ol className="space-y-2 text-sm">
            {hist.map(h => (
              <li key={h.id} className="border-l-2 border-border pl-3">
                <p className="font-medium">{FIELD_LABEL[h.action] ?? h.action}{h.field ? ` · ${h.field}` : ''}</p>
                {(h.old_value || h.new_value) && <p className="break-all text-xs text-muted">{fmtValue(h.field, h.old_value, idx.label)} → {fmtValue(h.field, h.new_value, idx.label)}</p>}
                <p className="text-xs text-muted">{new Date(h.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function fmtValue(field: string | null, v: string | null, label: (id: string | null) => string) {
  if (v == null) return '—';
  if (field === 'valor') return formatBRL(Number(v));
  if (field === 'categoria' && /^[0-9a-f-]{36}$/.test(v)) return label(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  return v.length > 120 ? v.slice(0, 120) + '…' : v;
}
