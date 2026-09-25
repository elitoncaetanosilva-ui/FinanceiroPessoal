import 'server-only';
import { getCartoes, getCategorias, getLancamentos, getOrcamentos, getSaldoInicial, contarPendentes } from './repo';
import { todayISO, ym } from './util';

export async function carregarBase() {
  const [lancs, categorias, orcamentos, saldoInicial, cartoes, pendentes] = await Promise.all([
    getLancamentos(), getCategorias(), getOrcamentos(), getSaldoInicial(), getCartoes(), contarPendentes(),
  ]);
  // Cartões que aparecem nos lançamentos mas não estão na lista configurada
  const extras = [...new Set(lancs.filter(l => l.origem === 'cartao' && l.conta && !cartoes.includes(l.conta)).map(l => l.conta!))];
  return { lancs, categorias, orcamentos, saldoInicial, cartoes: [...cartoes, ...extras], pendentes };
}

export const mesAtual = () => ym(todayISO());

/** Lê ?mes=YYYY-MM com fallback para o mês atual. */
export function mesParam(v: string | string[] | undefined) {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}$/.test(s) ? s : mesAtual();
}
