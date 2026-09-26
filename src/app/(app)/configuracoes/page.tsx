import Link from 'next/link';
import { changePasswordAction, logoutAction } from '@/app/actions/auth';
import { ActionForm } from '@/components/forms';
import ThemeSelect from '@/components/ThemeSelect';
import { Card, CardTitle, Field, PageHeader, inputClass } from '@/components/ui';
import { requireUser } from '@/server/auth/session';

export const metadata = { title: 'Configurações' };

export default async function Configuracoes() {
  const u = await requireUser();
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Configurações" subtitle={u.email} />
      <Card>
        <CardTitle>Aparência</CardTitle>
        <ThemeSelect />
      </Card>
      <Card>
        <CardTitle>Migrar a planilha CAIXA 2026</CardTitle>
        <p className="mb-3 text-sm text-muted">Traz o histórico (CASH e CARTÃO) até o mês de corte, as entradas realizadas e os orçamentos (colunas PREVISTO). Pode ser repetida sem duplicar.</p>
        <Link href="/configuracoes/planilha" className="text-primary">Abrir migração ›</Link>
      </Card>
      <Card>
        <CardTitle>Seus dados</CardTitle>
        <p className="mb-3 text-sm text-muted">Exporte tudo a qualquer momento: você nunca fica preso ao app.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export?formato=csv" className="rounded-xl border border-border px-3 py-2 text-sm">Lançamentos (.csv)</a>
          <a href="/api/export?formato=json" className="rounded-xl border border-border px-3 py-2 text-sm">Backup completo (.json)</a>
        </div>
      </Card>
      <Card>
        <CardTitle>Trocar senha</CardTitle>
        <ActionForm action={async (p, fd) => { 'use server'; const r = await changePasswordAction({ error: '' }, fd); return r.ok ? { ok: true, message: 'Senha alterada.' } : { ok: false, error: r.error }; }} submit="Trocar senha">
          <Field label="Senha atual"><input name="current" type="password" autoComplete="current-password" required className={inputClass} /></Field>
          <Field label="Nova senha (mín. 10 caracteres)"><input name="next" type="password" autoComplete="new-password" required minLength={10} className={inputClass} /></Field>
          <Field label="Confirme a nova senha"><input name="confirm" type="password" autoComplete="new-password" required className={inputClass} /></Field>
        </ActionForm>
      </Card>
      <form action={logoutAction}><button className="h-11 w-full rounded-xl border border-border text-muted">Sair</button></form>
    </div>
  );
}
