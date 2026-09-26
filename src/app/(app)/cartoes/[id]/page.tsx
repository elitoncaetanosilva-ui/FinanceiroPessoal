import Link from 'next/link';
import { notFound } from 'next/navigation';
import { saveStatementDatesAction, setCardActiveAction } from '@/app/actions/cadastros';
import CardForm from '@/components/cadastros/CardForm';
import { ActionButton, ActionForm } from '@/components/forms';
import { MovementItem } from '@/components/movements/MovementItem';
import { Badge, ButtonLink, Card, CardTitle, Field, Money, PageHeader, cx, inputClass } from '@/components/ui';
import { fmtDate, fmtMonth, fmtMonthLong } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { activeInstallments, cardSummaries, statementViews } from '@/server/domain/cards';
import { listAccounts, listCards, listInstitutions } from '@/server/domain/catalog';
import { autoRealizeInstallments } from '@/server/domain/movements';
import { listMovements } from '@/server/domain/queries';
import { STATEMENT_STATUS_LABEL } from '@/server/domain/statements';

export default async function Cartao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fatura?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await readCtx();
  await autoRealizeInstallments(ctx);
  const card = (await listCards(ctx)).find(c => c.id === id);
  if (!card) notFound();
  const summary = (await cardSummaries(ctx, false)).find(c => c.id === id)!;
  const sts = await statementViews(ctx, id);
  const def = summary.closed ?? summary.current ?? sts[sts.length - 1];
  const sel = sts.find(s => s.id === sp.fatura) ?? def;
  const [movs, inst, accounts, institutions] = await Promise.all([
    sel ? listMovements(ctx, { statementId: sel.id }, null, 300) : Promise.resolve({ items: [], next: null }),
    activeInstallments(ctx, id), listAccounts(ctx, true), listInstitutions(ctx),
  ]);
  const idx = sel ? sts.findIndex(s => s.id === sel.id) : -1;
  const window = sts.slice(Math.max(0, idx - 4), idx + 7);

  return (
    <div className="space-y-4">
      <PageHeader title={card.name} back="/cartoes"
        subtitle={[card.institution_name, card.brand, card.last4 && `final ${card.last4}`, `fecha dia ${card.closing_day}`, `vence dia ${card.due_day}`].filter(Boolean).join(' · ')}
        actions={<ButtonLink size="sm" href={`/movimentos/novo?tipo=cartao&cartao=${id}`}>Nova compra</ButtonLink>} />

      {card.limit_cents > 0 && (
        <Card>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>Limite <Money cents={card.limit_cents} strong /></span>
            <span>Utilizado <Money cents={summary.used} strong /></span>
            <span>Disponível <Money cents={summary.available} strong tone={summary.available < 0 ? 'expense' : 'income'} /></span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (summary.used / card.limit_cents) * 100)}%` }} /></div>
          <p className="mt-1 text-xs text-muted">O utilizado inclui as parcelas futuras já contratadas.</p>
        </Card>
      )}

      {/* Faturas: linha do tempo */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0" aria-label="Faturas">
        {window.map(s => (
          <Link key={s.id} href={`/cartoes/${id}?fatura=${s.id}`} className={cx('shrink-0 rounded-xl border px-3 py-2 text-sm', s.id === sel?.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
            <span className="block text-xs text-muted">{fmtMonth(s.due_month)}</span>
            <Money cents={s.total} className="font-semibold" />
          </Link>
        ))}
      </nav>

      {sel && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted capitalize">Fatura de {fmtMonthLong(sel.due_month)}</p>
              <p className="text-3xl font-bold"><Money cents={sel.total} /></p>
              <p className="text-sm text-muted">Fecha {fmtDate(sel.closing_date)} · vence {fmtDate(sel.due_date)}</p>
            </div>
            <Badge tone={sel.status === 'OVERDUE' ? 'danger' : sel.status === 'CLOSED' ? 'warning' : sel.status === 'PAID' ? 'income' : 'neutral'}>{STATEMENT_STATUS_LABEL[sel.status]}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-xs text-muted">Pago</dt><dd><Money cents={sel.paid} /></dd></div>
            <div><dt className="text-xs text-muted">Falta pagar</dt><dd><Money cents={Math.max(0, sel.remaining)} strong /></dd></div>
            <div><dt className="text-xs text-muted">Previsto</dt><dd><Money cents={sel.planned} className="text-planned" /></dd></div>
          </dl>
          {sel.reported_total_cents != null && (
            <p className={cx('mt-2 text-sm', Math.abs(sel.reported_total_cents - sel.total) <= 1 ? 'text-income' : 'text-warning')}>
              Total informado pelo banco no último arquivo: <Money cents={sel.reported_total_cents} />{Math.abs(sel.reported_total_cents - sel.total) <= 1 ? ' ✓ confere' : ` · diferença ${((sel.total - sel.reported_total_cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
            </p>
          )}
          {sel.remaining > 0 && (
            <ButtonLink className="mt-3" href={`/movimentos/novo?tipo=pagamento&cartao=${id}&fatura=${sel.id}&valor=${sel.remaining}`}>Registrar pagamento</ButtonLink>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-primary">Ajustar datas desta fatura</summary>
            <ActionForm action={saveStatementDatesAction} className="mt-3">
              <input type="hidden" name="id" value={sel.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fechamento"><input type="date" name="closing_date" defaultValue={sel.closing_date} className={inputClass} /></Field>
                <Field label="Vencimento"><input type="date" name="due_date" defaultValue={sel.due_date} className={inputClass} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="settled_manually" defaultChecked={sel.settled_manually} className="h-5 w-5" /> Quitada fora do app (histórico)</label>
            </ActionForm>
          </details>
        </Card>
      )}

      {sel && (
        <Card className="p-0">
          <div className="px-4 pt-4"><CardTitle>Lançamentos da fatura ({movs.items.length})</CardTitle></div>
          {movs.items.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">Nenhum lançamento nesta fatura.</p> : (
            <div className="divide-y divide-border">{movs.items.map(m => <MovementItem key={m.id} m={m} showDate />)}</div>
          )}
        </Card>
      )}

      {inst.length > 0 && (
        <Card>
          <CardTitle>Parcelamentos em andamento</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {inst.map(g => (
              <li key={g.group_id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/movimentos?grupo=${g.group_id}`} className="min-w-0">
                  <span className="block truncate font-medium">{g.description}</span>
                  <span className="text-xs text-muted">{g.remaining_count} de {g.installment_count} restantes · <Money cents={-g.installment_amount_cents} />/mês</span>
                </Link>
                <Money cents={g.remaining_cents} strong />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Dados do cartão</CardTitle>
        <CardForm values={card} institutions={institutions.filter(i => i.is_active || i.id === card.institution_id)} accounts={accounts} />
      </Card>
      {card.is_active
        ? <ActionButton run={setCardActiveAction.bind(null, id, false)} confirm="Confirmar inativação">Inativar cartão</ActionButton>
        : <ActionButton run={setCardActiveAction.bind(null, id, true)}>Reativar cartão</ActionButton>}
    </div>
  );
}
