import { CircleCheck, TriangleAlert } from 'lucide-react';
import { applyCaixaAction, applySyncAction } from '@/app/actions/settings';
import CaixaUpload from '@/components/CaixaUpload';
import { ActionForm } from '@/components/forms';
import { Badge, Button, ButtonLink, Card, CardTitle, Field, Money, PageHeader, inputClass } from '@/components/ui';
import { addDays, addMonths, fmtDate, fmtDayMonth, monthStart, today } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { norm } from '@/lib/text';
import { readCtx } from '@/server/context';
import { listAccounts, listCards } from '@/server/domain/catalog';
import type { CaixaParsed } from '@/server/import/planilha';
import { planSync, syncOptionsFrom, type SyncItem } from '@/server/import/planilha-sync';

export const metadata = { title: 'Planilha CAIXA' };

type SP = Record<string, string | undefined>;

export default async function Planilha({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const [accounts, cards] = await Promise.all([listAccounts(ctx, true), listCards(ctx, true)]);
  const batch = sp.lote ? (await ctx.q.query<{ id: string; status: string; file_name: string; info: { caixa: CaixaParsed }; stats: Record<string, unknown> }>(
    `select id, status, file_name, info, stats from import_batches where id=$1 and user_id=$2 and importer_id='caixa-planilha'`, [sp.lote, ctx.userId]))[0] : null;
  const p = batch?.info.caixa;
  const m = monthStart(today());

  // opções da prévia: da URL ou padrão (conta corrente; cartões pelo nome)
  const defAccount = accounts.find(a => a.type === 'CHECKING')?.id ?? accounts[0]?.id ?? '';
  const defCard = (n: string) => cards.find(c => norm(c.name).includes(norm(n).split(' ')[0]))?.id ?? '';
  const get = (k: string): string | undefined => {
    if (k in sp) return sp[k];
    if (k === 'conta') return defAccount;
    const i = /^c(\d+)$/.exec(k);
    if (i && p) return defCard(p.cardNames[+i[1]] ?? '');
    if (k === 'saldo_data') return addDays(m, -1);
    return undefined;
  };
  const opts = p ? syncOptionsFrom(get, p.cardNames) : null;
  const plan = p && opts && batch?.status !== 'COMMITTED' ? await planSync(ctx, p, opts) : null;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Planilha CAIXA" back="/configuracoes" />
      {!p && (
        <Card>
          <CardTitle>Sincronizar com a planilha</CardTitle>
          <p className="mb-3 text-sm text-muted">
            Envie a planilha atualizada: o app compara linha a linha com o que já está aqui, inclui só o que falta e preenche a categoria dos
            pendentes. Você vê tudo numa prévia antes de aplicar. No Google Sheets: <b>Arquivo → Fazer download → Microsoft Excel (.xlsx)</b>.
          </p>
          <CaixaUpload />
        </Card>
      )}

      {p && batch && batch.status === 'COMMITTED' && (
        <Card>
          <p className="font-semibold text-primary">Planilha aplicada.</p>
          {'created' in batch.stats ? (
            <p className="text-sm">{String(batch.stats.created)} lançamento(s) incluído(s) · {String(batch.stats.filled)} categoria(s) preenchida(s) · {String(batch.stats.matched)} já estavam no app</p>
          ) : (
            <p className="text-sm">{String(batch.stats.cash ?? 0)} lançamentos de conta · {String(batch.stats.card ?? 0)} de cartão · {String(batch.stats.incomes ?? 0)} entradas mensais · {String(batch.stats.budgets ?? 0)} valores de orçamento</p>
          )}
          <p className="mt-1 text-sm text-muted">Atualizou a planilha de novo? Envie o arquivo outra vez: nada é duplicado.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/movimentos" size="sm">Ver lançamentos</ButtonLink>
            <ButtonLink href="/contas" size="sm" variant="secondary">Ver contas</ButtonLink>
            <ButtonLink href="/configuracoes/planilha" size="sm" variant="secondary">Enviar outra</ButtonLink>
          </div>
        </Card>
      )}

      {p && batch && batch.status !== 'COMMITTED' && (
        <>
          <Card>
            <CardTitle>{batch.file_name}</CardTitle>
            <p className="text-sm text-muted">CASH: {p.cash.length} linhas · CARTÃO: {p.card.length} linhas ({p.cardNames.join(', ')})</p>
            {accounts.length === 0 ? <p className="mt-2 text-sm text-muted">Cadastre primeiro a conta (e os cartões) em Cadastros.</p> : (
              <form method="get" className="mt-3 space-y-3">
                <input type="hidden" name="lote" value={batch.id} />
                <Field label="Conta da aba CASH">
                  <select name="conta" defaultValue={opts?.accountId} className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                </Field>
                {p.cardNames.map((n, i) => (
                  <Field key={n} label={`Cartão “${n}” da planilha`}>
                    <select name={`c${i}`} defaultValue={get(`c${i}`) ?? ''} className={inputClass}>
                      <option value="">Não sincronizar</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Saldo no banco em" hint="Opcional: confere o saldo."><input type="date" name="saldo_data" defaultValue={get('saldo_data')} className={inputClass} /></Field>
                  <Field label="Saldo (R$)"><input name="saldo" inputMode="decimal" placeholder="0,00" defaultValue={get('saldo')} className={inputClass} /></Field>
                </div>
                <Button type="submit" variant="secondary" size="sm">Atualizar prévia</Button>
              </form>
            )}
          </Card>

          {plan && opts && (
            <ActionForm action={applySyncAction} submit={plan.newItems.length || plan.fills.length ? 'Aplicar sincronização' : 'Registrar'}>
              <input type="hidden" name="batch_id" value={batch.id} />
              <input type="hidden" name="conta" value={opts.accountId} />
              {p.cardNames.map((n, i) => <input key={n} type="hidden" name={`c${i}`} value={opts.cardMap[n] ?? ''} />)}
              {opts.checkpoint && <><input type="hidden" name="saldo_data" value={opts.checkpoint.date} /><input type="hidden" name="saldo" value={(opts.checkpoint.balanceCents / 100).toFixed(2)} /></>}
              <input type="hidden" name="novos" value={plan.items.filter(i => !i.match && !i.covered).map(i => i.key).join(',')} />

              {plan.balanceCheck && (
                <Card>
                  <CardTitle>Conferência do saldo</CardTitle>
                  <p className="text-sm">Saldo calculado em {fmtDate(plan.balanceCheck.date)}, depois de aplicar: <Money cents={plan.balanceCheck.computed} strong /></p>
                  <p className="text-sm">Banco: <Money cents={plan.balanceCheck.reported} /></p>
                  {plan.balanceCheck.diff === 0
                    ? <p className="mt-1 flex items-center gap-1 text-sm text-income"><CircleCheck size={16} /> Confere com o banco no centavo.</p>
                    : <p className="mt-1 flex items-center gap-1 text-sm text-danger"><TriangleAlert size={16} /> Diferença de <Money cents={plan.balanceCheck.diff} signed />. Revise os lançamentos abaixo antes de aplicar.</p>}
                  <p className="mt-1 text-xs text-muted">Ao aplicar, o saldo informado fica registrado na conta para conferência.</p>
                </Card>
              )}

              {(plan.unmappedCards.length > 0 || plan.unknownCategories.length > 0) && (
                <Card className="text-sm text-warning">
                  {plan.unmappedCards.length > 0 && <p>Cartões não sincronizados: {plan.unmappedCards.join(', ')}.</p>}
                  {plan.unknownCategories.length > 0 && <p>Subcategorias da planilha que não existem no app (entram sem categoria): {plan.unknownCategories.join(', ')}.</p>}
                </Card>
              )}

              <Card>
                <CardTitle>Vão entrar ({plan.newItems.length})</CardTitle>
                {plan.newItems.length === 0 ? <p className="text-sm text-muted">Nada novo: tudo o que está na planilha já está no app.</p> : (
                  <>
                    <p className="mb-2 text-sm text-muted">
                      Conta {formatBRL(plan.totals.newCashCents)} · cartões {formatBRL(plan.totals.newCardCents)}. Desmarque o que não quiser incluir.
                    </p>
                    <ul className="divide-y divide-border">
                      {plan.newItems.map(i => (
                        <li key={i.key}>
                          <label className="flex items-start gap-3 py-2">
                            <input type="checkbox" name="incluir" value={i.key} defaultChecked className="mt-1 h-5 w-5 shrink-0" />
                            <ItemText i={i} />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>

              <Card>
                <CardTitle>Categorias preenchidas ({plan.fills.length})</CardTitle>
                <p className="text-sm text-muted">Lançamentos pendentes no app que a planilha já classifica.</p>
                {plan.fills.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-primary">Ver lista</summary>
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {plan.fills.map(i => (
                        <li key={i.key} className="flex justify-between gap-3 py-2">
                          <span className="min-w-0"><span className="block truncate">{i.match!.description}</span><span className="text-xs text-muted">{fmtDayMonth(i.date)} · {i.holder.name} → <b>{i.sub}</b></span></span>
                          <Money cents={i.amountCents} tone="auto" />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>

              <Card>
                <CardTitle>Já no app ({plan.matched.length})</CardTitle>
                <p className="text-sm text-muted">Linhas que já estão no app (importadas do banco, migradas ou parcelas previstas). Nada muda nelas além da categoria.</p>
              </Card>

              {plan.ignored.length > 0 && (
                <Card>
                  <CardTitle>Ignoradas ({plan.ignored.length})</CardTitle>
                  <p className="text-sm text-muted">
                    Linhas de um período que já veio do arquivo do banco ({plan.coverage.filter(c => c.until).map(c => `${c.name} até ${fmtDayMonth(c.until)}`).join(' · ')}),
                    mas que não aparecem nele. O arquivo do banco vale: se faltar algo de verdade, lance à mão.
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-primary">Ver lista</summary>
                    <ul className="mt-2 divide-y divide-border">
                      {plan.ignored.map(i => <li key={i.key} className="py-2"><ItemText i={i} /></li>)}
                    </ul>
                  </details>
                </Card>
              )}
            </ActionForm>
          )}

          <details className="rounded-2xl border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium">Migração inicial completa (primeira vez)</summary>
            <p className="mt-2 text-sm text-muted">Traz todo o histórico até o mês de corte, as entradas mensais e os orçamentos (PREVISTO). Use só na primeira vez ou para reimportar orçamentos.</p>
            {accounts.length > 0 && (
              <ActionForm action={applyCaixaAction} submit="Aplicar migração" className="mt-3">
                <input type="hidden" name="batch_id" value={batch.id} />
                <Field label="Conta dos lançamentos da aba CASH"><select name="account_id" defaultValue={opts?.accountId} className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                {p.cardNames.map((n, i) => (
                  <Field key={n} label={`Cartão “${n}” da planilha`}>
                    <select name={`card_${i}`} defaultValue={defCard(n)} className={inputClass}>
                      <option value="">Não importar</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Conta: até o mês (inclusive)" hint="Depois disso valem os extratos."><input type="month" name="cash_cutoff" defaultValue={addMonths(m, -1, 1).slice(0, 7)} className={inputClass} /></Field>
                  <Field label="Cartões: faturas que vencem até" hint="Faturas seguintes vêm dos arquivos."><input type="month" name="card_cutoff" defaultValue={m.slice(0, 7)} className={inputClass} /></Field>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="history" defaultChecked className="h-5 w-5" /> Importar histórico (CASH, CARTÃO e entradas)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="budgets" defaultChecked className="h-5 w-5" /> Importar orçamentos (PREVISTO)</label>
                <p className="text-xs text-muted">O histórico anterior ao saldo inicial da conta não altera o saldo. Faturas até o corte ficam marcadas como quitadas.</p>
              </ActionForm>
            )}
          </details>
        </>
      )}
    </div>
  );
}

function ItemText({ i }: { i: SyncItem }) {
  return (
    <span className="flex min-w-0 flex-1 justify-between gap-3">
      <span className="min-w-0">
        <span className="block truncate text-sm">{i.description}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {fmtDayMonth(i.date)} · {i.holder.name}{i.sheet === 'CARTÃO' && ` · fatura ${fmtMonthShort(i.due)}`}{i.installment && ` · ${i.installment.n}/${i.installment.total}`}{i.sub && ` · ${i.sub}`}
          {i.future && <Badge tone="planned">previsto</Badge>}
        </span>
      </span>
      <Money cents={i.amountCents} tone="auto" className="text-sm" />
    </span>
  );
}

const fmtMonthShort = (d: string) => `${d.slice(5, 7)}/${d.slice(2, 4)}`;
