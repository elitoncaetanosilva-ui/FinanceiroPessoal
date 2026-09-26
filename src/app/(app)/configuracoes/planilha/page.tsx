import { applyCaixaAction } from '@/app/actions/settings';
import CaixaUpload from '@/components/CaixaUpload';
import { ActionForm } from '@/components/forms';
import { ButtonLink, Card, CardTitle, Field, PageHeader, inputClass } from '@/components/ui';
import { addMonths, monthStart, today } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { norm } from '@/lib/text';
import { readCtx } from '@/server/context';
import { listAccounts, listCards } from '@/server/domain/catalog';
import type { CaixaParsed } from '@/server/import/planilha';

export const metadata = { title: 'Migrar planilha' };

export default async function Planilha({ searchParams }: { searchParams: Promise<{ lote?: string }> }) {
  const sp = await searchParams;
  const ctx = await readCtx();
  const [accounts, cards] = await Promise.all([listAccounts(ctx, true), listCards(ctx, true)]);
  const batch = sp.lote ? (await ctx.q.query<{ id: string; status: string; file_name: string; info: { caixa: CaixaParsed }; stats: Record<string, unknown> }>(
    `select id, status, file_name, info, stats from import_batches where id=$1 and user_id=$2 and importer_id='caixa-planilha'`, [sp.lote, ctx.userId]))[0] : null;
  const p = batch?.info.caixa;
  const m = monthStart(today());
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Migrar planilha CAIXA 2026" back="/configuracoes" />
      {!p && (
        <Card>
          <p className="mb-3 text-sm text-muted">No Google Sheets: <b>Arquivo → Fazer download → Microsoft Excel (.xlsx)</b>. Envie o arquivo aqui.</p>
          <CaixaUpload />
        </Card>
      )}
      {p && batch && (
        <>
          <Card>
            <CardTitle>{batch.file_name}</CardTitle>
            <ul className="space-y-1 text-sm">
              <li>CASH: <b>{p.cash.length}</b> lançamentos · total {formatBRL(p.cash.reduce((s, r) => s + r.valueCents, 0))}</li>
              <li>CARTÃO: <b>{p.card.length}</b> parcelas/compras ({p.cardNames.join(', ')})</li>
              <li>Entradas realizadas (CAIXA MENSAL): <b>{p.incomes.length}</b> valores mensais</li>
              <li>Orçamento (PREVISTO): <b>{p.budgets.length}</b> valores · anos {p.years.join(', ')}</li>
            </ul>
            {p.warnings.length > 0 && <p className="mt-2 text-xs text-muted">{p.warnings.length} linha(s) ignoradas por falta de data.</p>}
          </Card>
          {batch.status === 'COMMITTED' ? (
            <Card>
              <p className="font-semibold text-primary">Migração concluída.</p>
              <p className="text-sm">{String(batch.stats.cash ?? 0)} lançamentos de conta · {String(batch.stats.card ?? 0)} de cartão · {String(batch.stats.incomes ?? 0)} entradas mensais · {String(batch.stats.budgets ?? 0)} valores de orçamento</p>
              {Array.isArray(batch.stats.unknown) && batch.stats.unknown.length > 0 && <p className="text-sm text-warning">Subcategorias não encontradas (ficaram sem categoria): {(batch.stats.unknown as string[]).join(', ')}</p>}
              <p className="mt-1 text-sm text-muted">Pode aplicar de novo (não duplica) enviando o arquivo outra vez.</p>
              <div className="mt-3 flex gap-2"><ButtonLink href="/orcamento" size="sm">Ver orçamento</ButtonLink><ButtonLink href="/movimentos?todos=1" size="sm" variant="secondary">Ver lançamentos</ButtonLink></div>
            </Card>
          ) : (
            <Card>
              <CardTitle>Como aplicar</CardTitle>
              {accounts.length === 0 ? <p className="text-sm text-muted">Cadastre primeiro a conta (e os cartões) em Cadastros.</p> : (
                <ActionForm action={applyCaixaAction} submit="Aplicar migração">
                  <input type="hidden" name="batch_id" value={batch.id} />
                  <Field label="Conta dos lançamentos da aba CASH"><select name="account_id" className={inputClass}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                  {p.cardNames.map((n, i) => (
                    <Field key={n} label={`Cartão “${n}” da planilha`}>
                      <select name={`card_${i}`} defaultValue={cards.find(c => norm(c.name).includes(norm(n).split(' ')[0]))?.id ?? ''} className={inputClass}>
                        <option value="">Não importar</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Conta: até o mês (inclusive)" hint="Depois disso valem os extratos."><input type="month" name="cash_cutoff" defaultValue="2026-08" className={inputClass} /></Field>
                    <Field label="Cartões: faturas que vencem até" hint="Faturas seguintes vêm dos arquivos."><input type="month" name="card_cutoff" defaultValue="2026-09" className={inputClass} /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="history" defaultChecked className="h-5 w-5" /> Importar histórico (CASH, CARTÃO e entradas)</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="budgets" defaultChecked className="h-5 w-5" /> Importar orçamentos (PREVISTO)</label>
                  <p className="text-xs text-muted">O histórico anterior ao saldo inicial da conta não altera o saldo — só alimenta relatórios e orçamento. Faturas até o corte ficam marcadas como quitadas. Sugestão: conta até {addMonths(m, -1, 1).slice(0, 7)}; cartões até {m.slice(0, 7)}.</p>
                </ActionForm>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
