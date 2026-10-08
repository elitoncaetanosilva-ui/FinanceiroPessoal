/**
 * Classificação automática.
 * Ordem: 1) regras do usuário/aprendidas  2) regras do sistema  3) histórico (mesma descrição já classificada).
 * Só classifica sozinho com confiança ≥ AUTO_THRESHOLD; abaixo disso fica como SUGESTÃO e o movimento vai para Pendentes.
 */
import { coreDescription, norm } from '@/lib/text';
import { audit } from './audit';
import { classifyMovement } from './movements';
import type { Ctx } from './types';

export const AUTO_THRESHOLD = 0.85;

export interface RuleRow {
  id: string; pattern: string; match_type: 'CONTAINS' | 'STARTS_WITH' | 'EXACT' | 'REGEX'; direction: 'IN' | 'OUT' | null;
  account_id: string | null; card_id: string | null; min_amount_cents: number | null; max_amount_cents: number | null;
  category_id: string; priority: number; origin: 'SYSTEM' | 'USER' | 'LEARNED';
}
export interface ClassifyInput { description: string; amountCents: number; accountId?: string | null; cardId?: string | null }
export interface ClassifyResult { categoryId: string; confidence: number; source: string; ruleId: string | null }

export interface Classifier {
  rules: RuleRow[];
  history: Map<string, Map<string, number>>;   // núcleo da descrição → categoria → ocorrências
  classify(i: ClassifyInput): ClassifyResult | null;
}

export function ruleMatches(r: RuleRow, i: ClassifyInput, d = norm(i.description)) {
  const dir = i.amountCents < 0 ? 'OUT' : 'IN';
  if (r.direction && r.direction !== dir) return false;
  if (r.account_id && r.account_id !== i.accountId) return false;
  if (r.card_id && r.card_id !== i.cardId) return false;
  const abs = Math.abs(i.amountCents);
  if (r.min_amount_cents != null && abs < r.min_amount_cents) return false;
  if (r.max_amount_cents != null && abs > r.max_amount_cents) return false;
  const p = norm(r.pattern);
  switch (r.match_type) {
    case 'EXACT': return d === p || coreDescription(d) === p;
    case 'STARTS_WITH': return d.startsWith(p) || coreDescription(d).startsWith(p);
    case 'REGEX': try { return new RegExp(r.pattern, 'i').test(d); } catch { return false; }
    default: return d.includes(p);
  }
}

export function buildClassifier(rules: RuleRow[], history: Map<string, Map<string, number>>): Classifier {
  const sorted = [...rules].sort((a, b) => {
    const oa = a.origin === 'SYSTEM' ? 1 : 0, ob = b.origin === 'SYSTEM' ? 1 : 0;
    if (oa !== ob) return oa - ob;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.pattern.length - a.pattern.length;
  });
  return {
    rules: sorted, history,
    classify(i) {
      const d = norm(i.description);
      for (const r of sorted) {
        if (!ruleMatches(r, i, d)) continue;
        return { categoryId: r.category_id, confidence: r.origin === 'SYSTEM' ? 0.9 : 0.98, source: r.origin === 'SYSTEM' ? 'regra do sistema' : 'sua regra', ruleId: r.id };
      }
      const h = history.get(historyKey(i));
      if (h?.size) {
        const [[cat, n], ...rest] = [...h.entries()].sort((a, b) => b[1] - a[1]);
        const others = rest.reduce((s, [, k]) => s + k, 0);
        if (n >= 2 && others === 0) return { categoryId: cat, confidence: 0.9, source: 'histórico', ruleId: null };
        return { categoryId: cat, confidence: n > others ? 0.6 : 0.4, source: 'histórico', ruleId: null };
      }
      return null;
    },
  };
}

const historyKey = (i: { description: string; amountCents: number }) => `${i.amountCents < 0 ? 'O' : 'I'}|${coreDescription(i.description)}`;

export async function loadClassifier(ctx: Ctx): Promise<Classifier> {
  const rules = await ctx.q.query<RuleRow>(
    `select id, pattern, match_type, direction, account_id, card_id, min_amount_cents, max_amount_cents, category_id, priority, origin
     from classification_rules r where user_id=$1 and is_active
       and exists (select 1 from categories c where c.id=r.category_id and c.is_active)`,
    [ctx.userId],
  );
  const rows = await ctx.q.query<{ description: string; amount_cents: number; category_id: string }>(
    `select m.description, m.amount_cents, s.category_id from movements m join movement_splits s on s.movement_id=m.id
     join categories c on c.id=s.category_id
     where m.user_id=$1 and m.deleted_at is null and m.kind='NORMAL' and c.system_key is null and c.is_active
       and m.source <> 'SYSTEM' and m.date > current_date - interval '24 months'
       and (select count(*) from movement_splits x where x.movement_id=m.id)=1
     order by m.date desc limit 20000`,
    [ctx.userId],
  );
  const history = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = historyKey({ description: r.description, amountCents: r.amount_cents });
    const m = history.get(k) ?? new Map<string, number>();
    m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
    history.set(k, m);
  }
  return buildClassifier(rules, history);
}

/** Registra uso das regras (contagem de acertos). */
export async function bumpRuleHits(ctx: Ctx, ruleIds: string[]) {
  const counts = new Map<string, number>();
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) await ctx.q.query('update classification_rules set hits=hits+$2, last_hit_at=now() where id=$1 and user_id=$3', [id, n, ctx.userId]);
}

/**
 * Aprende uma regra a partir de uma classificação manual e aplica aos pendentes semelhantes.
 * Retorna quantos pendentes foram classificados.
 */
export async function learnRule(ctx: Ctx, p: { pattern: string; categoryId: string; direction: 'IN' | 'OUT' | null; applyToPending?: boolean }) {
  const pattern = norm(p.pattern);
  if (pattern.length < 3) return 0;
  const existing = await ctx.q.query<{ id: string }>(
    `select id from classification_rules where user_id=$1 and origin<>'SYSTEM' and pattern=$2 and match_type='CONTAINS' and direction is not distinct from $3`,
    [ctx.userId, pattern, p.direction],
  );
  if (existing[0]) {
    await ctx.q.query('update classification_rules set category_id=$2, is_active=true, updated_at=now() where id=$1', [existing[0].id, p.categoryId]);
  } else {
    const r = await ctx.q.query<{ id: string }>(
      `insert into classification_rules(user_id, pattern, match_type, direction, category_id, priority, origin) values ($1,$2,'CONTAINS',$3,$4,100,'LEARNED') returning id`,
      [ctx.userId, pattern, p.direction, p.categoryId],
    );
    await audit(ctx, 'rule', r[0].id, 'CREATE', { field: 'padrão', old: null, new: pattern }, { category: p.categoryId });
  }
  if (!p.applyToPending) return 0;
  const pend = await ctx.q.query<{ id: string }>(
    `select distinct m.id from movements m join movement_splits s on s.movement_id=m.id
     where m.user_id=$1 and m.deleted_at is null and s.category_id is null and m.normalized_description like $2
       and ($3::text is null or ($3='OUT' and m.amount_cents<0) or ($3='IN' and m.amount_cents>0))
       and (select count(*) from movement_splits x where x.movement_id=m.id)=1`,
    [ctx.userId, `%${pattern}%`, p.direction],
  );
  for (const m of pend) await classifyMovement(ctx, m.id, p.categoryId, { via: 'regra aprendida' });
  return pend.length;
}
