import { catKey } from './taxonomy';
import type { Categoria, Lancamento, Natureza, Orcamento } from './types';
import { addMonthsYm, descKey, monthRange, r2, sum, ym } from './util';

const semParcela = (d: string) => d.replace(/\s*\b\d{1,2}\/\d{1,2}\b/g, '').trim() || d;

/** Mês em que o lançamento afeta o caixa (vencimento; para o cartão = vencimento da fatura). */
export const mesCaixa = (l: Pick<Lancamento, 'vencimento'>) => ym(l.vencimento);

export const ativos = (ls: Lancamento[]) => ls.filter(l => !l.ignorado);

export interface MesFluxo {
  mes: string;
  entradas: number;
  saidas: number;
  geracao: number;
  saldoInicial: number | null;
  saldoFinal: number | null;
  entradasPrev: number;
  saidasPrev: number;
  geracaoPrev: number;
  saldoFinalPrev: number | null;
  temPrevisto: boolean;
}

export interface LinhaFluxo {
  natureza: Natureza;
  grupo: string;
  subgrupo: string | null; // null = linha de grupo
  realizado: number[];
  previsto: number[];
}

export interface Fluxo {
  meses: string[];
  resumo: MesFluxo[];
  linhas: LinhaFluxo[];
}

/**
 * Réplica do CAIXA MENSAL: por subgrupo e mês, realizado (Σ CASH + Σ CARTÃO pelo mês de vencimento
 * + entradas) e previsto (orçamento). Saldo encadeado a partir do saldo inicial.
 */
export function calcFluxo(
  lancs: Lancamento[],
  categorias: Categoria[],
  orcamentos: Orcamento[],
  saldoInicial: { mes: string; valor: number } | null,
  meses: string[],
): Fluxo {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const real = new Map<string, number[]>();
  const prev = new Map<string, number[]>();
  const zero = () => meses.map(() => 0);
  const bump = (map: Map<string, number[]>, k: string, i: number, v: number) => {
    const arr = map.get(k) ?? zero();
    arr[i] += v;
    map.set(k, arr);
  };

  for (const l of ativos(lancs)) {
    const i = idx.get(mesCaixa(l));
    if (i != null) bump(real, catKey(l.natureza, l.subgrupo), i, l.valor);
  }
  for (const o of orcamentos) {
    const i = idx.get(o.mes);
    if (i != null) bump(prev, catKey(o.natureza, o.subgrupo), i, o.valor);
  }

  // Categorias usadas mas ausentes da taxonomia viram linhas no grupo "Outros".
  const cats = [...categorias];
  const known = new Set(cats.map(c => catKey(c.natureza, c.subgrupo)));
  for (const k of new Set([...real.keys(), ...prev.keys()])) {
    if (known.has(k)) continue;
    const [nat, ...rest] = k.split(':');
    cats.push({ natureza: nat as Natureza, grupo: nat === 'receita' ? 'Outras Receitas' : 'Outros', subgrupo: rest.join(':'), ordem: 9999 });
    known.add(k);
  }

  const linhas: LinhaFluxo[] = [];
  for (const nat of ['receita', 'despesa'] as Natureza[]) {
    const doNat = cats.filter(c => c.natureza === nat).sort((a, b) => a.ordem - b.ordem);
    const grupos = [...new Set(doNat.map(c => c.grupo))];
    for (const g of grupos) {
      const subs = doNat.filter(c => c.grupo === g);
      const subLinhas = subs.map(c => ({
        natureza: nat, grupo: g, subgrupo: c.subgrupo,
        realizado: (real.get(catKey(nat, c.subgrupo)) ?? zero()).map(r2),
        previsto: (prev.get(catKey(nat, c.subgrupo)) ?? zero()).map(r2),
      }));
      linhas.push({
        natureza: nat, grupo: g, subgrupo: null,
        realizado: meses.map((_, i) => sum(subLinhas.map(s => s.realizado[i]))),
        previsto: meses.map((_, i) => sum(subLinhas.map(s => s.previsto[i]))),
      });
      linhas.push(...subLinhas);
    }
  }

  const tot = (nat: Natureza, kind: 'realizado' | 'previsto', i: number) =>
    sum(linhas.filter(l => l.natureza === nat && l.subgrupo === null).map(l => l[kind][i]));

  const resumo: MesFluxo[] = [];
  let saldo: number | null = null;
  meses.forEach((mes, i) => {
    if (saldoInicial && mes === saldoInicial.mes) saldo = saldoInicial.valor;
    if (saldoInicial && mes < saldoInicial.mes) saldo = null;
    const entradas = tot('receita', 'realizado', i), saidas = tot('despesa', 'realizado', i);
    const entradasPrev = tot('receita', 'previsto', i), saidasPrev = tot('despesa', 'previsto', i);
    const geracao = r2(entradas - saidas), geracaoPrev = r2(entradasPrev - saidasPrev);
    const ini: number | null = saldo;
    const fim: number | null = ini == null ? null : r2(ini + geracao);
    resumo.push({
      mes, entradas, saidas, geracao, saldoInicial: ini, saldoFinal: fim,
      entradasPrev, saidasPrev, geracaoPrev, saldoFinalPrev: ini == null ? null : r2(ini + geracaoPrev),
      temPrevisto: entradasPrev !== 0 || saidasPrev !== 0,
    });
    saldo = fim;
  });
  return { meses, resumo, linhas };
}

/** Saldo inicial encadeado até um mês qualquer (inclusive meses antes do intervalo exibido). */
export function saldoAte(lancs: Lancamento[], saldoInicial: { mes: string; valor: number } | null, mesAlvo: string) {
  if (!saldoInicial || mesAlvo < saldoInicial.mes) return null;
  let s = saldoInicial.valor;
  for (const l of ativos(lancs)) {
    const m = mesCaixa(l);
    if (m >= saldoInicial.mes && m < mesAlvo) s += l.natureza === 'receita' ? l.valor : -l.valor;
  }
  return r2(s);
}

export function intervaloMeses(lancs: Lancamento[], fallback: string) {
  let min = fallback, max = fallback;
  for (const l of lancs) {
    const m = mesCaixa(l);
    if (m < min) min = m;
    if (m > max) max = m;
  }
  return { min, max };
}

// ---------- cartões ----------

export interface FaturaMes { mes: string; porCartao: Record<string, number>; total: number; }

export function faturasPorMes(lancs: Lancamento[], meses: string[], cartoes: string[]): FaturaMes[] {
  const cards = ativos(lancs).filter(l => l.origem === 'cartao');
  return meses.map(mes => {
    const porCartao: Record<string, number> = Object.fromEntries(cartoes.map(c => [c, 0]));
    for (const l of cards) if (mesCaixa(l) === mes) porCartao[l.conta ?? 'Outro'] = r2((porCartao[l.conta ?? 'Outro'] ?? 0) + l.valor);
    return { mes, porCartao, total: sum(Object.values(porCartao)) };
  });
}

export interface CompraParcelada {
  chave: string;
  descricao: string;
  conta: string | null;
  subgrupo: string;
  valorParcela: number;
  parcelas: number;
  pagas: number; // parcelas com vencimento até o mês atual
  restante: number; // valor ainda a vencer
  ultimaParcela: string; // YYYY-MM
}

/** Compras parceladas com parcelas a vencer depois do mês de referência. */
export function parceladasEmAberto(lancs: Lancamento[], mesRef: string): CompraParcelada[] {
  const map = new Map<string, Lancamento[]>();
  for (const l of ativos(lancs)) {
    if (l.origem !== 'cartao' || !l.parcelas || l.parcelas < 2) continue;
    // A planilha repete a compra em cada parcela, às vezes com "NN/MM" na descrição e datas diferentes.
    const k = [l.conta, descKey(semParcela(l.descricao)), l.parcelas, l.valor.toFixed(2)].join('|');
    const arr = map.get(k) ?? [];
    arr.push(l);
    map.set(k, arr);
  }
  const out: CompraParcelada[] = [];
  for (const [chave, ls] of map) {
    const futuras = ls.filter(l => mesCaixa(l) > mesRef);
    if (!futuras.length) continue;
    const ult = ls.reduce((a, l) => (mesCaixa(l) > a ? mesCaixa(l) : a), '0000-00');
    const n = ls[0].parcelas!;
    out.push({
      chave, descricao: semParcela(ls[0].descricao), conta: ls[0].conta, subgrupo: ls[0].subgrupo,
      valorParcela: ls[0].valor, parcelas: n, pagas: n - futuras.length, restante: sum(futuras.map(l => l.valor)), ultimaParcela: ult,
    });
  }
  return out.sort((a, b) => b.restante - a.restante);
}

// ---------- gastos por grupo ----------

export function gastosPorGrupo(lancs: Lancamento[], categorias: Categoria[], meses: string[]) {
  const grupoDe = new Map(categorias.map(c => [catKey(c.natureza, c.subgrupo), c.grupo]));
  const set = new Set(meses);
  const out = new Map<string, number>();
  for (const l of ativos(lancs)) {
    if (l.natureza !== 'despesa' || !set.has(mesCaixa(l))) continue;
    const g = grupoDe.get(catKey('despesa', l.subgrupo)) ?? 'Outros';
    out.set(g, (out.get(g) ?? 0) + l.valor);
  }
  return [...out.entries()].map(([grupo, v]) => ({ grupo, valor: r2(v / meses.length) }));
}

export function gastosPorSubgrupo(lancs: Lancamento[], meses: string[], filtro?: (l: Lancamento) => boolean) {
  const set = new Set(meses);
  const out = new Map<string, number>();
  for (const l of ativos(lancs)) {
    if (l.natureza !== 'despesa' || !set.has(mesCaixa(l)) || (filtro && !filtro(l))) continue;
    out.set(l.subgrupo, (out.get(l.subgrupo) ?? 0) + l.valor);
  }
  return out;
}

// ---------- projeção ----------

export interface ProjecaoMes {
  mes: string;
  entradas: number;
  saidasConta: number;
  parcelasCartao: number;
  cartaoNovo: number;
  saidas: number;
  saldoFinal: number;
  base: 'previsto' | 'media';
}

export type CenarioEntradas = 'media' | 'previsto';

/**
 * Projeta o saldo dos próximos meses:
 * - entradas: média dos últimos 3 meses fechados (cenário "media") ou o previsto do mês, quando houver ("previsto");
 * - saídas da conta: média dos 3 últimos meses fechados;
 * - cartão: parcelas já lançadas para o mês + média das compras à vista (1/1) + novas compras parceladas,
 *   que se acumulam por no máximo a duração média dos parcelamentos (depois as mais antigas terminam).
 */
export function projetar(lancs: Lancamento[], orcamentos: Orcamento[], mesAtual: string, saldoFimMesAtual: number, n = 6, cenario: CenarioEntradas = 'media'): ProjecaoMes[] {
  const fechados = [1, 2, 3].map(k => addMonthsYm(mesAtual, -k));
  const at = ativos(lancs);
  const naJanela = at.filter(l => fechados.includes(mesCaixa(l)));
  const media = (f: (l: Lancamento) => boolean) => r2(sum(naJanela.filter(f).map(l => l.valor)) / fechados.length);
  const entradasMedia = media(l => l.natureza === 'receita');
  const contaMedia = media(l => l.natureza === 'despesa' && l.origem === 'cash');
  const cartaoVistaMedia = media(l => l.origem === 'cartao' && (l.parcelas ?? 1) <= 1);
  const primeiras = naJanela.filter(l => l.origem === 'cartao' && (l.parcelas ?? 1) > 1 && l.parcela === 1);
  const novasParceladas = r2(sum(primeiras.map(l => l.valor)) / fechados.length);
  const duracaoMedia = primeiras.length ? Math.max(1, Math.round(sum(primeiras.map(l => l.parcelas ?? 1)) / primeiras.length)) : 1;

  const out: ProjecaoMes[] = [];
  let saldo = saldoFimMesAtual;
  for (let k = 1; k <= n; k++) {
    const mes = addMonthsYm(mesAtual, k);
    const prevEntr = sum(orcamentos.filter(o => o.mes === mes && o.natureza === 'receita').map(o => o.valor));
    const usaPrev = cenario === 'previsto' && prevEntr > 0;
    const entradas = usaPrev ? prevEntr : entradasMedia;
    const parcelasCartao = sum(at.filter(l => l.origem === 'cartao' && mesCaixa(l) === mes).map(l => l.valor));
    const cartaoNovo = r2(cartaoVistaMedia + novasParceladas * Math.min(k, duracaoMedia));
    const saidas = r2(contaMedia + parcelasCartao + cartaoNovo);
    saldo = r2(saldo + entradas - saidas);
    out.push({ mes, entradas, saidasConta: contaMedia, parcelasCartao, cartaoNovo, saidas, saldoFinal: saldo, base: usaPrev ? 'previsto' : 'media' });
  }
  return out;
}

export function mesesAno(ano: number) {
  return monthRange(`${ano}-01`, `${ano}-12`);
}
