/** Leitura dos cadastros (categorias, contas, cartões) com os campos derivados. */
import type { Account, Card, Category, Ctx } from './types';

export async function listCategories({ q, userId }: Ctx): Promise<Category[]> {
  return q.query<Category>(
    `select id, parent_id, name, nature, section, financial_income, system_key, is_hidden, is_active, sort_order
     from categories where user_id=$1 order by section, sort_order, name`,
    [userId],
  );
}

export interface CategoryIndex {
  all: Category[];
  byId: Map<string, Category>;
  groups: Category[];                   // categorias (nível 1), na ordem
  children: Map<string, Category[]>;    // subcategorias por categoria
  system(key: string): Category;
  label(id: string | null | undefined): string;
  path(id: string | null | undefined): { group: Category | null; sub: Category | null };
}

export function indexCategories(all: Category[]): CategoryIndex {
  const byId = new Map(all.map(c => [c.id, c]));
  const groups = all.filter(c => !c.parent_id).sort((a, b) => (a.section === b.section ? a.sort_order - b.sort_order : a.section === 'IN' ? -1 : 1));
  const children = new Map<string, Category[]>();
  for (const c of all) if (c.parent_id) {
    const l = children.get(c.parent_id) ?? [];
    l.push(c);
    children.set(c.parent_id, l);
  }
  for (const l of children.values()) l.sort((a, b) => a.sort_order - b.sort_order);
  return {
    all, byId, groups, children,
    system(key) {
      const c = all.find(x => x.system_key === key);
      if (!c) throw new Error(`Categoria de sistema ausente: ${key}`);
      return c;
    },
    label(id) {
      if (!id) return 'Sem categoria';
      const c = byId.get(id);
      if (!c) return '?';
      const p = c.parent_id ? byId.get(c.parent_id) : null;
      return p ? `${p.name} › ${c.name}` : c.name;
    },
    path(id) {
      const c = id ? byId.get(id) ?? null : null;
      if (!c) return { group: null, sub: null };
      if (!c.parent_id) return { group: c, sub: null };
      return { group: byId.get(c.parent_id) ?? null, sub: c };
    },
  };
}

export async function categoryIndex(ctx: Ctx) {
  return indexCategories(await listCategories(ctx));
}

export async function listAccounts({ q, userId }: Ctx, onlyActive = false): Promise<Account[]> {
  return q.query<Account>(
    `select a.id, a.institution_id, i.name as institution_name, a.name, a.type, a.branch, a.number,
            a.opening_balance_cents, a.opening_balance_date, a.in_available_balance, a.is_active, a.color
     from accounts a left join institutions i on i.id=a.institution_id
     where a.user_id=$1 ${onlyActive ? 'and a.is_active' : ''} order by a.is_active desc, a.sort_order, a.name`,
    [userId],
  );
}

export async function listCards({ q, userId }: Ctx, onlyActive = false): Promise<Card[]> {
  return q.query<Card>(
    `select c.id, c.institution_id, i.name as institution_name, c.name, c.brand, c.last4, c.extra_last4, c.limit_cents,
            c.closing_day, c.due_day, c.payment_account_id, c.payment_patterns, c.is_active, c.color
     from credit_cards c left join institutions i on i.id=c.institution_id
     where c.user_id=$1 ${onlyActive ? 'and c.is_active' : ''} order by c.is_active desc, c.sort_order, c.name`,
    [userId],
  );
}

export async function getCard(ctx: Ctx, id: string): Promise<Card | undefined> {
  return (await listCards(ctx)).find(c => c.id === id);
}
export async function getAccount(ctx: Ctx, id: string): Promise<Account | undefined> {
  return (await listAccounts(ctx)).find(a => a.id === id);
}

export async function listInstitutions({ q, userId }: Ctx) {
  return q.query<{ id: string; name: string; code: string | null; is_active: boolean }>(
    'select id, name, code, is_active from institutions where user_id=$1 order by is_active desc, name', [userId],
  );
}
