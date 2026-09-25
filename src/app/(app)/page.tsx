import Link from 'next/link';
import { FaturasChart, FluxoChart } from '@/components/charts';
import { COR, corCartao } from '@/lib/cores';
import { HBarList, InsightList, Kpi, MonthNav, Money, Vazio, VsPrevisto } from '@/components/ui';
import { carregarBase, mesAtual, mesParam } from '@/lib/dados';
import { calcFluxo, faturasPorMes, gastosPorGrupo, intervaloMeses, projetar } from '@/lib/finance';
import { gerarInsights } from '@/lib/insights';
import { getContas } from '@/lib/repo';
import { addMonthsYm, fmtBRL, fmtMes, monthRange } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const mes = mesParam(sp.mes);
  const atual = mesAtual();
  const [b, contas] = await Promise.all([carregarBase(), getContas()]);

  if (!b.lancs.length) {
    return (
      <>
        <div className="page-head"><div><h1>Painel</h1><p className="muted">Comece trazendo seus dados.</p></div></div>
        <Vazio titulo="Nenhum lançamento ainda">
          <p>1. Importe a planilha <b>CAIXA 2026</b> (.xlsx) para trazer o histórico das abas CASH, CARTÃO e CAIXA MENSAL.</p>
          <p>2. Conecte Itaú e Nubank via Open Finance para os próximos meses entrarem sozinhos.</p>
          <p style={{ marginTop: 16 }}><Link className="btn btn-primary" href="/conexoes">Ir para Dados & bancos</Link></p>
        </Vazio>
      </>
    );
  }

  const { min } = intervaloMeses(b.lancs, mes);
  const inicio = b.saldoInicial && b.saldoInicial.mes < min ? b.saldoInicial.mes : min;
  const fim = addMonthsYm(atual > mes ? atual : mes, 6);
  const fluxo = calcFluxo(b.lancs, b.categorias, b.orcamentos, b.saldoInicial, monthRange(inicio, fim));
  const r = fluxo.resumo.find(x => x.mes === mes)!;
  const rAtual = fluxo.resumo.find(x => x.mes === atual);
  const projecao = projetar(b.lancs, b.orcamentos, atual, rAtual?.saldoFinal ?? 0, 6);
  const insights = gerarInsights({ lancs: b.lancs, categorias: b.categorias, orcamentos: b.orcamentos, fluxo, mesRef: mes, projecao, pendentes: b.pendentes });

  const meses12 = monthRange(addMonthsYm(mes, -11), mes).filter(m => m >= inicio);
  const serie = meses12.map(m => {
    const x = fluxo.resumo.find(y => y.mes === m)!;
    return { mes: m, entradas: x.entradas, saidas: x.saidas, saldo: x.saldoFinal };
  });

  const anteriores = [1, 2, 3].map(k => addMonthsYm(mes, -k));
  const grpMes = gastosPorGrupo(b.lancs, b.categorias, [mes]);
  const grpMedia = new Map(gastosPorGrupo(b.lancs, b.categorias, anteriores).map(g => [g.grupo, g.valor]));
  const grupos = grpMes.filter(g => g.valor > 0).sort((a, b2) => b2.valor - a.valor).slice(0, 10)
    .map(g => ({ label: g.grupo, valor: g.valor, ref: grpMedia.get(g.grupo), href: `/lancamentos?mes=${mes}&grupo=${encodeURIComponent(g.grupo)}` }));

  const mesesFat = monthRange(addMonthsYm(mes, -2), addMonthsYm(mes, 6));
  const faturas = faturasPorMes(b.lancs, mesesFat, b.cartoes).map(f => ({ mes: f.mes, total: f.total, ...f.porCartao }));
  const fatMes = faturasPorMes(b.lancs, [mes], b.cartoes)[0];
  const bancos = contas.filter(c => c.tipo === 'BANK');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Painel</h1>
          <p className="muted small">Regime de caixa: o cartão entra no mês de vencimento da fatura, como na planilha.</p>
        </div>
        <MonthNav mes={mes} base="/" atual={atual} />
      </div>

      <div className="grid g-kpi">
        <Kpi label="Entradas" cor={COR.entradas} valor={r.entradas} sub={<VsPrevisto real={r.entradas} prev={r.entradasPrev} maiorEhBom />} />
        <Kpi label="Saídas" cor={COR.saidas} valor={r.saidas} sub={<VsPrevisto real={r.saidas} prev={r.saidasPrev} maiorEhBom={false} />} />
        <Kpi label="Geração de caixa" valor={r.geracao} sinal sub={r.entradas > 0 ? `${Math.round((r.geracao / r.entradas) * 100)}% das entradas` : undefined} />
        <Kpi label="Saldo final" cor={COR.saldo} valor={r.saldoFinal ?? 0}
          sub={r.saldoInicial != null ? <>Saldo inicial {fmtBRL(r.saldoInicial)}</> : <Link href="/conexoes#saldo">Definir saldo inicial</Link>} />
      </div>

      <div className="grid g-3-1" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-head"><div><h2>Fluxo dos últimos 12 meses</h2><p className="muted small">Entradas e saídas realizadas; linha = saldo no fim do mês</p></div><Link className="small" href="/fluxo">Ver CAIXA MENSAL →</Link></div>
          <FluxoChart dados={serie} altura={360} />
        </section>
        <section className="card">
          <div className="card-head"><h2>Destaques</h2><Link className="small" href="/insights">Todos →</Link></div>
          <InsightList itens={insights} limite={5} />
        </section>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-head">
            <div><h2>Para onde foi o dinheiro</h2><p className="muted small">Saídas de {fmtMes(mes)} por grupo · traço = média dos 3 meses anteriores</p></div>
          </div>
          {grupos.length ? <HBarList itens={grupos} cor={COR.saidas} /> : <p className="muted small">Sem saídas neste mês.</p>}
        </section>
        <section className="card">
          <div className="card-head">
            <div><h2>Faturas do cartão</h2><p className="muted small">Por mês de vencimento · meses futuros = parcelas já contratadas</p></div>
            <Link className="small" href="/cartoes">Cartões →</Link>
          </div>
          <FaturasChart dados={faturas} cartoes={b.cartoes} mesAtual={mes} />
          <div className="row small" style={{ marginTop: 8, gap: 16 }}>
            {b.cartoes.map((c, i) => (
              <span key={c}><i className="dot" style={{ background: corCartao(i) }} /> {c} em {fmtMes(mes)}: <Money v={fatMes.porCartao[c] ?? 0} /></span>
            ))}
          </div>
        </section>
      </div>

      {bancos.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="card-head"><h2>Saldos nos bancos</h2><span className="faint small">via Open Finance</span></div>
          <div className="row" style={{ gap: 24 }}>
            {bancos.map(c => (
              <div key={c.id}><div className="muted small">{c.apelido}</div><div className="kpi-value" style={{ fontSize: 20 }}><Money v={c.saldo ?? 0} /></div></div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
