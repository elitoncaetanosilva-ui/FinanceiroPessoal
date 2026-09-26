import { saveInstitutionAction, setInstitutionActiveAction } from '@/app/actions/cadastros';
import { ActionButton, ActionForm } from '@/components/forms';
import { Card, Field, PageHeader, cx, inputClass } from '@/components/ui';
import { readCtx } from '@/server/context';
import { listInstitutions } from '@/server/domain/catalog';

export const metadata = { title: 'Bancos' };

export default async function Bancos() {
  const list = await listInstitutions(await readCtx());
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Bancos e instituições" back="/cadastros" />
      <Card>
        <ActionForm action={saveInstitutionAction} submit="Adicionar">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Nome" className="col-span-2"><input name="name" required className={inputClass} /></Field>
            <Field label="Código"><input name="code" inputMode="numeric" className={inputClass} /></Field>
          </div>
        </ActionForm>
      </Card>
      <Card>
        <ul className="divide-y divide-border">
          {list.map(i => (
            <li key={i.id} className="py-2">
              <details>
                <summary className={cx('flex cursor-pointer list-none items-center justify-between', !i.is_active && 'text-muted line-through')}>
                  <span>{i.name}</span><span className="text-sm text-muted">{i.code}</span>
                </summary>
                <div className="mt-2 rounded-xl bg-surface-2 p-3">
                  <ActionForm action={saveInstitutionAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Nome" className="col-span-2"><input name="name" defaultValue={i.name} className={inputClass} /></Field>
                      <Field label="Código"><input name="code" defaultValue={i.code ?? ''} className={inputClass} /></Field>
                    </div>
                  </ActionForm>
                  <div className="mt-2">{i.is_active ? <ActionButton run={setInstitutionActiveAction.bind(null, i.id, false)}>Inativar</ActionButton> : <ActionButton run={setInstitutionActiveAction.bind(null, i.id, true)}>Reativar</ActionButton>}</div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
