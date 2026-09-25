import type { Lancamento, NovoLancamento } from './types';
import { diffDays, ym } from './util';

type Base = Pick<Lancamento, 'origem' | 'natureza' | 'conta' | 'data' | 'vencimento' | 'valor' | 'parcela' | 'parcelas'>;

/**
 * Dois lançamentos representam o mesmo movimento?
 * - Conta: mesmo valor e data a até 3 dias. Linhas antigas da planilha usam o dia 1º como data:
 *   nesse caso basta o mesmo mês.
 * - Cartão: mesmo cartão, valor, parcela NN/MM e mês de vencimento
 *   (a chave do conciliador: valor | parcela | ano-mês do vencimento).
 */
export function mesmoMovimento(a: Base, b: Base) {
  if (a.origem !== b.origem || a.natureza !== b.natureza) return false;
  if (Math.abs(a.valor - b.valor) > 0.005) return false;
  if (a.origem === 'cartao') {
    if (a.conta && b.conta && a.conta !== b.conta) return false;
    if ((a.parcela ?? 1) !== (b.parcela ?? 1) || (a.parcelas ?? 1) !== (b.parcelas ?? 1)) return false;
    return ym(a.vencimento) === ym(b.vencimento);
  }
  if (Math.abs(diffDays(a.data, b.data)) <= 3) return true;
  const primeiroDia = (x: Base) => x.data.endsWith('-01');
  return (primeiroDia(a) || primeiroDia(b)) && ym(a.data) === ym(b.data);
}

export interface ResultadoReconc {
  novos: NovoLancamento[];
  /** entrante já existe com o mesmo external_id → atualizar */
  atualizar: { id: number; entrante: NovoLancamento; existente: Lancamento }[];
  /** entrante casou com uma linha sem vínculo (planilha/manual) → vincular */
  vincular: { id: number; entrante: NovoLancamento; existente: Lancamento }[];
  descartados: number;
}

/**
 * modo "pluggy": entrantes vêm do banco com external_id.
 * modo "planilha": entrantes vêm da planilha; os que já existem (vindos do banco ou manuais) são descartados.
 */
export function reconciliar(entrantes: NovoLancamento[], existentes: Lancamento[], opts: { modo: 'pluggy' | 'planilha' }): ResultadoReconc {
  const res: ResultadoReconc = { novos: [], atualizar: [], vincular: [], descartados: 0 };
  const porExt = new Map(existentes.filter(e => e.external_id).map(e => [e.external_id!, e]));
  const usados = new Set<number>();
  const livres = existentes.filter(e => (opts.modo === 'pluggy' ? !e.external_id && e.fonte !== 'projecao' : true));

  for (const x of entrantes) {
    if (opts.modo === 'pluggy' && x.external_id) {
      const e = porExt.get(x.external_id);
      if (e) {
        usados.add(e.id);
        res.atualizar.push({ id: e.id, entrante: x, existente: e });
        continue;
      }
    }
    // Pagamento de fatura (ignorado) não concilia com nada da planilha.
    const hit = x.ignorado ? undefined : livres.find(e => !usados.has(e.id) && mesmoMovimento(x, e));
    if (hit) {
      usados.add(hit.id);
      if (opts.modo === 'pluggy') res.vincular.push({ id: hit.id, entrante: x, existente: hit });
      else res.descartados++;
      continue;
    }
    res.novos.push(x);
  }
  return res;
}
