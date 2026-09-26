import { saveRuleAction, setRuleActiveAction } from '@/app/actions/cadastros';
import { CategorySelect } from '@/components/CategorySelect';
import { ActionButton, ActionForm } from '@/components/forms';
import { Badge, Card, Field, PageHeader, cx, inputClass } from '@/components/ui';
import { readCtx } from '@/server/context';
import { categoryIndex } from '@/server/domain/catalog';

export const metadata = { title: 'Regras de classificação' };

interface Rule { id: string; pattern: string; match_type: string; direction: string | null; category_id: string; priority: number; origin: string; hits: number; is_active: boolean }
const MATCH = { CONTAINS: 'contém', STARTS_WITH: 'começa com', EXACT: 'igual a', REGEX: 'expressão' } as Record<string, string>;

export default async function Regras() {
  const ctx = await readCtx();
  const [idx, rules] = await Promise.all([
    categoryIndex(ctx),
    ctx.q.query<Rule>('select id, pattern, match_type, direction, category_id, priority, origin, hits, is_active from classification_rules where user_id=$1 order by origin=\'SYSTEM\', is_active desc, priority desc, pattern', [ctx.userId]),
  ]);
  const mine = rules.filter(r => r.origin !== 'SYSTEM'), sys = rules.filter(r => r.origin === 'SYSTEM');
  const row = (r: Rule) => (
    <li key={r.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2', !r.is_active && 'opacity-50')}>
      <span className="min-w-0">
        <span className="block font-medium"><span className="text-muted">{MATCH[r.match_type]}</span> “{r.pattern}”</span>
        <span className="text-xs text-muted">→ {idx.label(r.category_id)}{r.direction ? ` · só ${r.direction === 'IN' ? 'entradas' : 'saídas'}` : ''} · prioridade {r.priority} · usada {r.hits}×</span>
      </span>
      <span className="flex items-center gap-2">
        {r.origin === 'LEARNED' && <Badge tone="primary">aprendida</Badge>}
        {r.is_active ? <ActionButton run={setRuleActiveAction.bind(null, r.id, false)}>Desativar</ActionButton> : <ActionButton run={setRuleActiveAction.bind(null, r.id, true)}>Ativar</ActionButton>}
      </span>
    </li>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Regras de classificação" back="/cadastros" subtitle="Ordem: suas regras → regras do sistema → histórico. Com confiança baixa o lançamento vai para Pendentes, nunca é classificado no chute." />
      <Card>
        <h2 className="mb-2 font-semibold">Nova regra</h2>
        <ActionForm action={saveRuleAction} submit="Criar regra">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Descrição contém…"><input name="pattern" required className={inputClass} placeholder="SUPERMERCADO ZAFFARI" /></Field>
            <Field label="Tipo"><select name="match_type" className={inputClass}><option value="CONTAINS">Contém</option><option value="STARTS_WITH">Começa com</option><option value="EXACT">Igual a</option><option value="REGEX">Expressão regular</option></select></Field>
            <Field label="Sentido"><select name="direction" className={inputClass}><option value="">Entradas e saídas</option><option value="OUT">Só saídas</option><option value="IN">Só entradas</option></select></Field>
            <Field label="Subcategoria"><CategorySelect categories={idx.all} required /></Field>
          </div>
          <input type="hidden" name="priority" value="100" />
        </ActionForm>
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Suas regras ({mine.length})</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">Ao classificar um pendente com “aplicar a semelhantes”, a regra aparece aqui.</p> : <ul className="divide-y divide-border">{mine.map(row)}</ul>}
      </Card>
      <details className="rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-semibold">Regras do sistema ({sys.length})</summary>
        <ul className="mt-2 divide-y divide-border">{sys.map(row)}</ul>
      </details>
    </div>
  );
}
