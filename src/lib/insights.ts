import { ativos, mesCaixa, type Fluxo, type ProjecaoMes } from './finance';
import { SUB_NAO_IDENTIFICADA, GRUPOS_NAO_CONSUMO, catKey } from './taxonomy';
import type { Categoria, Lancamento, Orcamento } from './types';
import { addMonthsYm, descKey, fmtBRL, fmtMes, fmtPct, groupBy, r2, sum } from './util';

export type TipoInsight = 'alerta' | 'atencao' | 'positivo' | 'info';
export interface Insight {
  id: string;
  tipo: TipoInsight;
  titulo: string;
  texto: string;
  href?: string;
  peso: number; // ordenação: maior primeiro
}

export interface Recorrente {
  descricao: string;
  subgrupo: string;
  conta: string | null;
  valorMedio: number;
  meses: number;
  ultimo: string;
}

/** Gastos que se repetem (mesma descrição normalizada) em ≥ 3 dos últimos 4 meses, com valor estável. */
export function detectarRecorrentes(lancs: Lancamento[], mesRef: string): Recorrente[] {
  const janela = [0, 1, 2, 3].map(k => addMonthsYm(mesRef, -k));
  const cand = ativos(lancs).filter(l => l.natureza === 'despesa' && l.valor > 0 && (l.parcelas ?? 1) <= 1 && janela.includes(mesCaixa(l)));
  const out: Recorrente[] = [];
  for (const [k, ls] of groupBy(cand, l => descKey(l.descricao))) {
    if (k.length < 3) continue;
    const porMes = groupBy(ls, l => mesCaixa(l));
    if (porMes.size < 3) continue;
    const valores = [...porMes.values()].map(x => sum(x.map(l => l.valor)));
    const media = sum(valores) / valores.length;
    const estavel = valores.every(v => Math.abs(v - media) <= Math.max(0.15 * media, 5));
    if (!estavel) continue;
    const ult = ls.reduce((a, l) => (l.vencimento > a.vencimento ? l : a));
    out.push({ descricao: ult.descricao, subgrupo: ult.subgrupo, conta: ult.conta, valorMedio: r2(media), meses: porMes.size, ultimo: mesCaixa(ult) });
  }
  return out.sort((a, b) => b.valorMedio - a.valorMedio);
}

export interface InsightInput {
  lancs: Lancamento[];
  categorias: Categoria[];
  orcamentos: Orcamento[];
  fluxo: Fluxo; // precisa conter mesRef e os 3 meses anteriores
  mesRef: string;
  projecao: ProjecaoMes[];
  pendentes: number;
}

export function gerarInsights(inp: InsightInput): Insight[] {
  const { lancs, categorias, orcamentos, fluxo, mesRef, projecao } = inp;
  const out: Insight[] = [];
  const at = ativos(lancs);
  const grupoDe = new Map(categorias.map(c => [catKey(c.natureza, c.subgrupo), c.grupo]));
  const anteriores = [1, 2, 3].map(k => addMonthsYm(mesRef, -k));
  const res = fluxo.resumo.find(r => r.mes === mesRef);

  // 1. Geração de caixa do mês
  if (res && res.entradas > 0) {
    const taxa = res.geracao / res.entradas;
    out.push({
      id: 'geracao', tipo: res.geracao >= 0 ? 'positivo' : 'alerta', peso: res.geracao >= 0 ? 40 : 90,
      titulo: res.geracao >= 0 ? `Sobraram ${fmtBRL(res.geracao)} em ${fmtMes(mesRef)}` : `Faltaram ${fmtBRL(-res.geracao)} em ${fmtMes(mesRef)}`,
      texto: res.geracao >= 0
        ? `Você guardou ${fmtPct(taxa)} do que entrou. A referência saudável é 10% a 20%.`
        : `As saídas superaram as entradas em ${fmtPct(-taxa)}. Veja abaixo o que puxou o mês para cima.`,
      href: '/fluxo',
    });
  }

  // 2. Projeção de saldo negativo
  const neg = projecao.find(p => p.saldoFinal < 0);
  if (neg) {
    out.push({
      id: 'projecao-negativa', tipo: 'alerta', peso: 100,
      titulo: `Saldo projetado negativo em ${fmtMes(neg.mes)}`,
      texto: `Com entradas de ${fmtBRL(neg.entradas)} (${neg.base === 'previsto' ? 'previsto' : 'média dos 3 últimos meses'}) e saídas no ritmo dos últimos 3 meses (${fmtBRL(neg.saidas)}), o saldo chega a ${fmtBRL(neg.saldoFinal)}. Só as parcelas já contratadas do cartão somam ${fmtBRL(neg.parcelasCartao)} nesse mês.`,
      href: '/insights',
    });
  } else if (projecao.length) {
    const last = projecao[projecao.length - 1];
    out.push({
      id: 'projecao-ok', tipo: 'positivo', peso: 20,
      titulo: `Saldo projetado positivo até ${fmtMes(last.mes)}`,
      texto: `Mantido o ritmo dos últimos 3 meses, você fecha ${fmtMes(last.mes)} com cerca de ${fmtBRL(last.saldoFinal)}.`,
      href: '/insights',
    });
  }

  // 3. Subgrupos que mais cresceram vs média dos 3 meses anteriores
  const porSubMes = new Map<string, number[]>();
  for (const l of at) {
    if (l.natureza !== 'despesa') continue;
    const m = mesCaixa(l);
    const j = anteriores.indexOf(m);
    const i = m === mesRef ? 0 : j >= 0 ? j + 1 : -1;
    if (i < 0) continue;
    const arr = porSubMes.get(l.subgrupo) ?? [0, 0, 0, 0];
    arr[i] += l.valor;
    porSubMes.set(l.subgrupo, arr);
  }
  const altas = [...porSubMes.entries()]
    .filter(([sub]) => !GRUPOS_NAO_CONSUMO.has(grupoDe.get(catKey('despesa', sub)) ?? ''))
    .map(([sub, v]) => ({ sub, atual: r2(v[0]), media: r2((v[1] + v[2] + v[3]) / 3) }))
    .map(x => ({ ...x, delta: r2(x.atual - x.media) }))
    .filter(x => x.delta > 150 && x.atual > x.media * 1.3)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  for (const a of altas) {
    out.push({
      id: `alta-${a.sub}`, tipo: 'atencao', peso: 60 + Math.min(a.delta / 100, 25),
      titulo: `${a.sub}: +${fmtBRL(a.delta)} acima da média`,
      texto: `${fmtBRL(a.atual)} em ${fmtMes(mesRef)}, contra média de ${fmtBRL(a.media)} nos 3 meses anteriores.`,
      href: `/lancamentos?mes=${mesRef}&sub=${encodeURIComponent(a.sub)}`,
    });
  }
  const quedas = [...porSubMes.entries()]
    .map(([sub, v]) => ({ sub, atual: r2(v[0]), media: r2((v[1] + v[2] + v[3]) / 3) }))
    .filter(x => x.media - x.atual > 200 && x.atual < x.media * 0.6 && !GRUPOS_NAO_CONSUMO.has(grupoDe.get(catKey('despesa', x.sub)) ?? ''))
    .sort((a, b) => b.media - b.atual - (a.media - a.atual))[0];
  if (quedas) {
    out.push({
      id: `queda-${quedas.sub}`, tipo: 'positivo', peso: 30,
      titulo: `${quedas.sub}: ${fmtBRL(quedas.media - quedas.atual)} a menos`,
      texto: `Você gastou ${fmtBRL(quedas.atual)} em ${fmtMes(mesRef)}, abaixo da média de ${fmtBRL(quedas.media)}.`,
    });
  }

  // 4. Estouro do previsto
  const prevMes = orcamentos.filter(o => o.mes === mesRef && o.natureza === 'despesa' && o.valor > 0);
  const estouros = prevMes
    .map(o => ({ sub: o.subgrupo, prev: o.valor, real: r2((porSubMes.get(o.subgrupo) ?? [0])[0]) }))
    .filter(x => x.real > x.prev * 1.1 && x.real - x.prev > 50)
    .sort((a, b) => b.real - b.prev - (a.real - a.prev));
  if (estouros.length) {
    const tot = sum(estouros.map(e => e.real - e.prev));
    out.push({
      id: 'estouro', tipo: 'atencao', peso: 70,
      titulo: `${estouros.length} subgrupo${estouros.length > 1 ? 's' : ''} acima do previsto (+${fmtBRL(tot)})`,
      texto: estouros.slice(0, 3).map(e => `${e.sub}: ${fmtBRL(e.real)} de ${fmtBRL(e.prev)}`).join(' · '),
      href: '/fluxo',
    });
  }

  // 5. Parcelas futuras e alívio
  const futuras = at.filter(l => l.origem === 'cartao' && mesCaixa(l) > mesRef);
  if (futuras.length) {
    const porMes = groupBy(futuras, l => mesCaixa(l));
    const total = sum(futuras.map(l => l.valor));
    const prox = sum((porMes.get(addMonthsYm(mesRef, 1)) ?? []).map(l => l.valor));
    let alivio: { mes: string; valor: number } | null = null;
    for (let k = 2; k <= 12; k++) {
      const m = addMonthsYm(mesRef, k), ant = addMonthsYm(mesRef, k - 1);
      const d = sum((porMes.get(ant) ?? []).map(l => l.valor)) - sum((porMes.get(m) ?? []).map(l => l.valor));
      if (d > 250 && (!alivio || d > alivio.valor)) alivio = { mes: m, valor: r2(d) };
    }
    out.push({
      id: 'parcelas', tipo: 'info', peso: 50,
      titulo: `${fmtBRL(total)} já comprometidos em parcelas`,
      texto: `A próxima fatura já começa com ${fmtBRL(prox)} de parcelas.` + (alivio ? ` Em ${fmtMes(alivio.mes)} as parcelas caem ${fmtBRL(alivio.valor)}.` : ''),
      href: '/cartoes',
    });
  }

  // 6. Assinaturas e gastos recorrentes
  const rec = detectarRecorrentes(lancs, mesRef);
  if (rec.length) {
    const tot = sum(rec.map(r => r.valorMedio));
    out.push({
      id: 'recorrentes', tipo: 'info', peso: 35,
      titulo: `${rec.length} gastos recorrentes somam ${fmtBRL(tot)}/mês`,
      texto: rec.slice(0, 4).map(r => `${r.descricao} (${fmtBRL(r.valorMedio)})`).join(' · ') + (rec.length > 4 ? '…' : ''),
      href: '/insights#recorrentes',
    });
  }

  // 7. Despesa não identificada
  const janela = [mesRef, ...anteriores];
  const saidasJanela = sum(at.filter(l => l.natureza === 'despesa' && janela.includes(mesCaixa(l))).map(l => l.valor));
  const naoId = sum(at.filter(l => l.subgrupo === SUB_NAO_IDENTIFICADA && janela.includes(mesCaixa(l))).map(l => l.valor));
  if (saidasJanela > 0 && naoId / saidasJanela > 0.04) {
    out.push({
      id: 'nao-identificada', tipo: 'atencao', peso: 55,
      titulo: `${fmtPct(naoId / saidasJanela)} das saídas sem categoria`,
      texto: `${fmtBRL(naoId)} em "${SUB_NAO_IDENTIFICADA}" nos últimos 4 meses. Classificar esses lançamentos deixa os gráficos mais fiéis.`,
      href: `/lancamentos?sub=${encodeURIComponent(SUB_NAO_IDENTIFICADA)}`,
    });
  }

  // 8. Pendências
  if (inp.pendentes > 0) {
    out.push({
      id: 'pendentes', tipo: 'info', peso: 80,
      titulo: `${inp.pendentes} lançamento${inp.pendentes > 1 ? 's' : ''} para revisar`,
      texto: 'Movimentos que chegaram do banco sem uma categoria confiável. Confirme o subgrupo e marque "lembrar" para as próximas vezes.',
      href: '/lancamentos?pendentes=1',
    });
  }

  // 9. Maior gasto do mês
  const doMes = at.filter(l => l.natureza === 'despesa' && mesCaixa(l) === mesRef && !GRUPOS_NAO_CONSUMO.has(grupoDe.get(catKey('despesa', l.subgrupo)) ?? ''));
  if (doMes.length) {
    const maior = doMes.reduce((a, l) => (l.valor > a.valor ? l : a));
    out.push({
      id: 'maior', tipo: 'info', peso: 25,
      titulo: `Maior saída do mês: ${fmtBRL(maior.valor)}`,
      texto: `${maior.descricao} · ${maior.subgrupo}${maior.parcelas && maior.parcelas > 1 ? ` · parcela ${maior.parcela}/${maior.parcelas}` : ''}`,
    });
  }

  // 10. Peso do cartão nas saídas
  if (res && res.saidas > 0) {
    const cartao = sum(at.filter(l => l.origem === 'cartao' && mesCaixa(l) === mesRef).map(l => l.valor));
    const share = cartao / res.saidas;
    if (share > 0.5) {
      out.push({
        id: 'cartao-share', tipo: 'info', peso: 15,
        titulo: `O cartão respondeu por ${fmtPct(share)} das saídas`,
        texto: `${fmtBRL(cartao)} em faturas com vencimento em ${fmtMes(mesRef)}.`,
        href: '/cartoes',
      });
    }
  }

  return out.sort((a, b) => b.peso - a.peso);
}
