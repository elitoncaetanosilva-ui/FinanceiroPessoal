import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { removeMissingAction, revertAction, setHolderAction, applyOpeningBalanceAction } from '@/app/actions/imports';
import { ActionButton, ActionForm } from '@/components/forms';
import ImportReview, { type ReviewRow } from '@/components/imports/ImportReview';
import { Badge, ButtonLink, Card, CardTitle, Field, Money, PageHeader, inputClass } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { accountBalances } from '@/server/domain/balances';
import { categoryIndex, listAccounts, listCards, pickerCategories, recentCategoryIds } from '@/server/domain/catalog';
import { DomainError } from '@/server/domain/types';
import { batchRows, getBatch, sameFileImported } from '@/server/import/pipeline';
import { importerById } from '@/server/import/registry';

export const metadata = { title: 'Revisão da importação' };

export default async function Lote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmado?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await readCtx();
  let b;
  try { b = await getBatch(ctx, id); } catch (e) { if (e instanceof DomainError) notFound(); throw e; }
  const [rows, idx, accounts, cards, recent, same] = await Promise.all([
    batchRows(ctx, id), categoryIndex(ctx), listAccounts(ctx, true), listCards(ctx, true), recentCategoryIds(ctx), sameFileImported(ctx, id),
  ]);
  const p = b.info.parsed;
  const draft = b.status === 'DRAFT';
  const holderMissing = !b.account_id && !b.card_id;
  const cardNames = new Map(cards.map(c => [c.id, c.name]));
  const holder = b.account_id ? accounts.find(a => a.id === b.account_id)?.name : b.card_id ? cardNames.get(b.card_id) : null;
  const acc = b.account_id ? (await accountBalances(ctx)).find(a => a.id === b.account_id) : null;
  const inst = p.institution;
  const createAccountHref = `/contas/nova?voltar=/importacoes/${id}&nome=${encodeURIComponent(`${inst} conta corrente`)}&banco=${encodeURIComponent(inst)}&agencia=${p.account?.branch ?? ''}&conta=${p.account?.number ?? ''}${p.openingBalance ? `&saldo=${p.openingBalance.balanceCents}&data=${p.openingBalance.date}` : ''}`;
  const createCardHref = `/cartoes/novo?voltar=/importacoes/${id}&nome=${encodeURIComponent(p.card?.title?.replace(/\s*-\s*final.*$/i, '') || inst)}&banco=${encodeURIComponent(inst)}&final=${p.card?.last4 ?? ''}&finais=${(p.card?.otherLast4 ?? []).join(',')}${p.card?.dueDate ? `&vencimento=${Number(p.card.dueDate.slice(8, 10))}` : ''}`;
  const stats = b.stats ?? {};
  const sumRows = rows.filter(r => r.row_kind !== 'CARD_PAYMENT').reduce((s, r) => s + r.amount_cents, 0);

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={b.file_name} back="/importacoes"
        subtitle={<span className="flex flex-wrap items-center gap-1.5">{importerById(b.importer_id)?.label} {holder && <>· <b>{holder}</b></>} {b.period_start && <>· {fmtDate(b.period_start)} a {fmtDate(b.period_end)}</>}
          <Badge tone={draft ? 'warning' : b.status === 'COMMITTED' ? 'income' : 'neutral'}>{draft ? 'aguardando revisão' : b.status === 'COMMITTED' ? 'importado' : b.status === 'REVERTED' ? 'desfeito' : 'descartado'}</Badge></span>} />

      {sp.confirmado && b.status === 'COMMITTED' && (
        <Card className="border-primary">
          <p className="font-semibold text-primary">Importação concluída</p>
          <p className="text-sm">{stats.imported ?? 0} lançamentos importados · {stats.linked ?? 0} vinculados a lançamentos existentes · {stats.payments ?? 0} pagamentos de fatura · {stats.planned ?? 0} parcelas futuras previstas · {stats.skipped ?? 0} ignorados/duplicados</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/pendentes" size="sm">Classificar pendentes</ButtonLink>
            <ButtonLink href={`/movimentos?lote=${id}`} size="sm" variant="secondary">Ver lançamentos do lote</ButtonLink>
          </div>
        </Card>
      )}

      {same[0] && draft && (
        <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning"><TriangleAlert size={16} /> Este mesmo arquivo já foi importado em {new Date(same[0].committed_at).toLocaleDateString('pt-BR')}. Nada será duplicado.</p>
      )}
      {p.warnings?.length > 0 && <Card><CardTitle>Avisos da leitura</CardTitle><ul className="text-sm text-muted">{p.warnings.slice(0, 10).map((w, i) => <li key={i}>• {w}</li>)}</ul></Card>}

      {holderMissing && draft && (
        <Card className="border-warning">
          <CardTitle>{p.kind === 'ACCOUNT' ? 'De qual conta é este extrato?' : 'De qual cartão é esta fatura?'}</CardTitle>
          <p className="mb-3 text-sm text-muted">
            {p.kind === 'ACCOUNT' ? `Não encontrei a conta ${p.account?.branch ? `ag. ${p.account.branch} ` : ''}${p.account?.number ? `cc ${p.account.number}` : ''} nos cadastros.` : `Não encontrei o cartão ${p.card?.last4 ? `final ${p.card.last4}` : inst} nos cadastros.`}
          </p>
          <ActionForm action={setHolderAction} submit="Usar este">
            <input type="hidden" name="batch_id" value={id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={p.kind === 'ACCOUNT' ? 'Conta' : 'Cartão'}>
                <select name="holder" className={inputClass} required>
                  {(p.kind === 'ACCOUNT' ? accounts.map(a => ({ v: `a:${a.id}`, l: a.name })) : cards.map(c => ({ v: `c:${c.id}`, l: c.name }))).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </Field>
              {p.kind === 'CARD' && !b.statement_due_date && <Field label="Vencimento da fatura"><input type="date" name="due_date" className={inputClass} /></Field>}
            </div>
          </ActionForm>
          <div className="mt-3 border-t border-border pt-3">
            <ButtonLink href={p.kind === 'ACCOUNT' ? createAccountHref : createCardHref} variant="secondary" size="sm">{p.kind === 'ACCOUNT' ? 'Cadastrar esta conta com os dados do arquivo' : 'Cadastrar este cartão com os dados do arquivo'}</ButtonLink>
          </div>
        </Card>
      )}

      {!holderMissing && (
        <Card>
          <CardTitle>Prévia</CardTitle>
          <div className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
            {[['Encontrados', stats.total], ['Novos', stats.new], ['Duplicados', stats.duplicate], ['Realizam previstos', stats.matched], ['Possíveis duplicados', stats.possible], ['Classificados', stats.classified], ['Pendentes', stats.pending], ['Pagamentos de fatura', stats.payments], ['Erros', stats.errors]]
              .filter(([, v]) => v != null).map(([l, v]) => <div key={String(l)} className="rounded-xl bg-surface-2 p-2"><p className="text-lg font-bold">{v ?? 0}</p><p className="text-xs text-muted">{l}</p></div>)}
          </div>
          {p.kind === 'ACCOUNT' && p.openingBalance && acc && (
            <div className="mt-3 rounded-xl border border-border p-3 text-sm">
              <p>Saldo anterior no arquivo: <Money cents={p.openingBalance.balanceCents} strong /> em {fmtDate(p.openingBalance.date)}.</p>
              {acc.opening_balance_date !== p.openingBalance.date || acc.opening_balance_cents !== p.openingBalance.balanceCents ? (
                <div className="mt-1">
                  <p className="text-muted">Saldo inicial da conta hoje: <Money cents={acc.opening_balance_cents} /> em {fmtDate(acc.opening_balance_date)}.</p>
                  {draft && <div className="mt-2"><ActionButton run={applyOpeningBalanceAction.bind(null, id)}>Usar o saldo do arquivo como saldo inicial</ActionButton></div>}
                </div>
              ) : <p className="flex items-center gap-1 text-income"><CircleCheck size={14} /> Igual ao saldo inicial da conta.</p>}
            </div>
          )}
          {p.kind === 'ACCOUNT' && p.balances?.length > 0 && <p className="mt-2 text-xs text-muted">{p.balances.length} saldos diários do banco serão usados para conferir o saldo calculado (tela da conta).</p>}
          {p.kind === 'CARD' && p.card?.reportedTotalCents != null && (
            <p className={`mt-3 text-sm ${Math.abs(p.card.reportedTotalCents + sumRows) <= 1 ? 'text-income' : 'text-warning'}`}>
              Total informado pelo banco: <Money cents={p.card.reportedTotalCents} /> · soma das compras do arquivo: <Money cents={-sumRows} /> {Math.abs(p.card.reportedTotalCents + sumRows) <= 1 ? '✓ confere' : '(diferença: confira linhas ignoradas)'}
            </p>
          )}
          {p.kind === 'CARD' && b.statement_due_date && <p className="mt-1 text-sm text-muted">Fatura com vencimento em {fmtDate(b.statement_due_date)}{p.card?.open ? ' (fatura aberta: novas compras podem aparecer até o fechamento)' : ''}.</p>}
        </Card>
      )}

      {b.info.missing && b.info.missing.length > 0 && (
        <Card className="border-warning">
          <CardTitle>Sumiram desta fatura</CardTitle>
          <p className="mb-2 text-sm text-muted">Estavam numa importação anterior desta mesma fatura e não aparecem no arquivo novo (estorno, compra que virou parcelada…). Confira e remova se for o caso.</p>
          <ul className="divide-y divide-border text-sm">
            {b.info.missing.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/movimentos/${m.id}`} className="min-w-0 truncate">{fmtDate(m.date)} · {m.description}</Link>
                <span className="flex items-center gap-2"><Money cents={m.amount_cents} /><ActionButton run={removeMissingAction.bind(null, m.id)} confirm="Remover?">Remover</ActionButton></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!holderMissing && (
        <ImportReview batchId={id} draft={draft} categories={pickerCategories(idx)} recent={recent}
          rows={rows.map(r => ({ ...r, target_card_name: r.target_card_id ? cardNames.get(r.target_card_id) ?? null : null })) as ReviewRow[]} />
      )}

      {b.status === 'COMMITTED' && (
        <Card>
          <CardTitle>Desfazer</CardTitle>
          <p className="mb-2 text-sm text-muted">Exclui os lançamentos criados por este lote e devolve os previstos que ele realizou ao estado anterior. O histórico fica registrado.</p>
          <ActionButton run={revertAction.bind(null, id)} confirm="Confirmar: desfazer lote">Desfazer este lote</ActionButton>
        </Card>
      )}
    </div>
  );
}
