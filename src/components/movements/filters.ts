import { monthStart, today } from '@/lib/dates';
import type { MovementFilters } from '@/server/domain/queries';

/** Converte os parâmetros da URL em filtros. Sem mês explícito: mês atual (exceto em buscas e drill-downs por grupo/lote/fatura). */
export function parseFilters(sp: Record<string, string | undefined>): MovementFilters {
  const f: MovementFilters = {};
  const broad = !!(sp.q || sp.grupo || sp.lote || sp.fatura || sp.regra || sp.todos || sp.pend || sp.de || sp.ate || sp.cde);
  if (sp.mes && /^\d{4}-\d{2}$/.test(sp.mes)) f.month = `${sp.mes}-01`;
  else if (!broad) f.month = monthStart(today());
  if (sp.de) f.from = sp.de;
  if (sp.ate) f.to = sp.ate;
  if (sp.cde && /^\d{4}-\d{2}$/.test(sp.cde)) f.compFrom = `${sp.cde}-01`;
  if (sp.cate && /^\d{4}-\d{2}$/.test(sp.cate)) f.compTo = `${sp.cate}-01`;
  if (sp.q) f.text = sp.q;
  if (sp.conta) f.accountId = sp.conta;
  if (sp.cartao) f.cardId = sp.cartao;
  if (sp.fatura) f.statementId = sp.fatura;
  if (sp.cat) f.categoryId = sp.cat;
  if (sp.natureza && ['INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT', 'FINANCING', 'ADJUSTMENT'].includes(sp.natureza)) f.nature = sp.natureza as MovementFilters['nature'];
  if (sp.pend === '1') f.pending = true;
  if (sp.prev === '1') f.planned = 'only';
  if (sp.prev === '0') f.planned = 'exclude';
  if (sp.portador === 'cartao') f.holderKind = 'card';
  if (sp.portador === 'conta') f.holderKind = 'account';
  if (sp.grupo) f.groupId = sp.grupo;
  if (sp.lote) f.batchId = sp.lote;
  if (sp.regra) f.ruleId = sp.regra;
  return f;
}
