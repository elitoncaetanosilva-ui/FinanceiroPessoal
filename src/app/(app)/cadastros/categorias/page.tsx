import { saveCategoryAction, setCategoryActiveAction } from '@/app/actions/cadastros';
import { ActionButton, ActionForm } from '@/components/forms';
import { Badge, Card, Field, PageHeader, cx, inputClass } from '@/components/ui';
import { readCtx } from '@/server/context';
import { categoryIndex } from '@/server/domain/catalog';
import { NATURE_LABEL, type Category, type Nature } from '@/server/domain/types';

export const metadata = { title: 'Categorias' };

const NATURES = Object.entries(NATURE_LABEL) as [Nature, string][];
const tone = (n: Nature) => ({ INCOME: 'income', EXPENSE: 'neutral', TRANSFER: 'primary', INVESTMENT: 'primary', FINANCING: 'warning', ADJUSTMENT: 'planned' } as const)[n];

function NatureSelect({ value }: { value: Nature }) {
  return <select name="nature" defaultValue={value} className={inputClass}>{NATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

function EditRow({ c }: { c: Category }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2">
        <span className={cx('min-w-0 truncate', !c.is_active && 'text-muted line-through')}>{c.name}</span>
        <span className="flex shrink-0 items-center gap-1">
          {c.financial_income && <Badge tone="income">financeira</Badge>}
          {c.system_key && <Badge>sistema</Badge>}
          <Badge tone={tone(c.nature)}>{NATURE_LABEL[c.nature]}</Badge>
        </span>
      </summary>
      <div className="mb-3 rounded-xl bg-surface-2 p-3">
        <ActionForm action={saveCategoryAction}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="section" value={c.section} />
          {c.parent_id && <input type="hidden" name="parent_id" value={c.parent_id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome"><input name="name" defaultValue={c.name} className={inputClass} /></Field>
            <Field label="Natureza econômica" hint="Define se entra como receita, despesa ou movimentação patrimonial."><NatureSelect value={c.nature} /></Field>
          </div>
        </ActionForm>
        {!c.system_key && (
          <div className="mt-2">
            {c.is_active
              ? <ActionButton run={setCategoryActiveAction.bind(null, c.id, false)} confirm="Confirmar inativação">Inativar</ActionButton>
              : <ActionButton run={setCategoryActiveAction.bind(null, c.id, true)}>Reativar</ActionButton>}
          </div>
        )}
      </div>
    </details>
  );
}

export default async function Categorias() {
  const idx = await categoryIndex(await readCtx());
  return (
    <div className="space-y-4">
      <PageHeader title="Categorias" back="/cadastros" subtitle="A natureza da subcategoria define como ela entra nos relatórios: Aporte e Resgate não são despesa nem receita; Rendimento é receita financeira; Transferência é neutra." />
      {(['IN', 'OUT'] as const).map(section => (
        <div key={section} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{section === 'IN' ? 'Total de entradas' : 'Total de saídas'}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {idx.groups.filter(g => g.section === section && !g.is_hidden).map(g => (
              <Card key={g.id}>
                <div className="border-b border-border pb-1 font-semibold"><EditRow c={g} /></div>
                <div className="divide-y divide-border pl-3 text-[15px]">
                  {(idx.children.get(g.id) ?? []).filter(c => !c.is_hidden).map(c => <EditRow key={c.id} c={c} />)}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-primary">+ Nova subcategoria</summary>
                  <ActionForm action={saveCategoryAction} className="mt-2" submit="Adicionar">
                    <input type="hidden" name="parent_id" value={g.id} />
                    <input type="hidden" name="section" value={g.section} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nome"><input name="name" required className={inputClass} /></Field>
                      <Field label="Natureza"><NatureSelect value={g.nature} /></Field>
                    </div>
                  </ActionForm>
                </details>
              </Card>
            ))}
          </div>
        </div>
      ))}
      <Card>
        <h2 className="mb-2 font-semibold">Nova categoria (1º nível)</h2>
        <ActionForm action={saveCategoryAction} submit="Criar categoria">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome"><input name="name" required className={inputClass} /></Field>
            <Field label="Grupo"><select name="section" className={inputClass}><option value="OUT">Saídas</option><option value="IN">Entradas</option></select></Field>
            <Field label="Natureza padrão"><NatureSelect value="EXPENSE" /></Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
