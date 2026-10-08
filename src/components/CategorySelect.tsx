import type { Category } from '@/server/domain/types';
import { inputClass } from './ui';

/** <select> de subcategorias agrupadas por categoria (entradas e saídas). */
export function CategorySelect({ categories, name = 'category_id', defaultValue, required, includeEmpty = true, onlyActive = true, className }: {
  categories: Category[]; name?: string; defaultValue?: string | null; required?: boolean; includeEmpty?: boolean; onlyActive?: boolean; className?: string;
}) {
  const groups = categories.filter(c => !c.parent_id && !c.is_hidden && (!onlyActive || c.is_active));
  const kids = (id: string) => categories.filter(c => c.parent_id === id && !c.is_hidden && (!onlyActive || c.is_active || c.id === defaultValue));
  return (
    <select name={name} defaultValue={defaultValue ?? ''} required={required} className={className ?? inputClass}>
      {includeEmpty && <option value="">— escolha —</option>}
      {(['IN', 'OUT'] as const).map(section => groups.filter(g => g.section === section).map(g => (
        <optgroup key={g.id} label={`${section === 'IN' ? 'Entradas' : 'Saídas'} · ${g.name}`}>
          {kids(g.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )))}
    </select>
  );
}
