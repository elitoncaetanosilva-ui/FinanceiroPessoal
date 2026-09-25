import Link from 'next/link';
import { ProjecaoChart, SerieChart } from '@/components/charts';
import { InsightList, MonthNav, Money, Vazio } from '@/components/ui';
import { carregarBase, mesAtual, mesParam } from '@/lib/dados';
import { calcFluxo, gastosPorGrupo, intervaloMeses, projetar } from '@/lib/finance';
import { detectarRecorrentes, gerarInsights } from '@/lib/insights';
import { addMonthsYm, fmtBRL, fmtMes, fmtNum, fmtPct, monthRange, sum } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const atual = mesAtual();
  const mes = mesParam(sp.mes);
  const b = await carregarBase();
  if (!b.lancs.length) return <Vazio titulo="Sem dados para analisar">Importe a planilha ou conecte seus bancos.</Vazio>;

  const { min } = intervaloMeses(b.lancs, mes);
  const inicio = b.saldoInicial && b.saldoInicial.mes < min ? b.saldoInicial.mes : min;
  const fluxo = calcFluxo(b.lancs, b.categorias, b.orcamentos, b.saldoInicial, monthRange(inicio, addMonthsYm(atual > mes ? atual : mes, 12)));
  const rAtual = fluxo.resumo.find(x => x.mes === atual);
  const cenario = sp.cenario === 'previsto' ? 'previsto' : 'media';
  const projecao = projetar(b.lancs, b.orcamentos, atual, rAtual?.saldoFinal ?? 0, 6, cenario);
  const insights = gerarInsights({ lancs: b.lancs, categorias: b.categorias, orcamentos: b.orcamentos, fluxo, mesRef: mes, projecao, pendentes: b.pendentes });

  const passados = monthRange(addMonthsYm(atual, -6), atual).filter(m => m >= inicio);
  const pontos = [
    ...passados.map(m => ({ mes: m, saldo: fluxo.resumo.find(x => x.mes === m)?.saldoFinal ?? 0, real: true })),
    ...projecao.map(p => ({ mes: p.mes, saldo: p.saldoFinal, parcelas: p.parcelasCartao })),
  ];

  const ult12 = monthRange(addMonthsYm(mes, -11), mes).filter(m => m >= inicio);
  const geracao = ult12.map(m => ({ mes: m, valor: fluxo.resumo.find(x => x.mes === m)?.geracao ?? 0 }));
  const entr12 = sum(ult12.map(m => fluxo.resumo.find(x => x.mes === m)?.entradas ?? 0));
  const ger12 = sum(geracao.map(g => g.valor));

  const recorrentes = detectarRecorrentes(b.lancs, mes);
  const meses6 = monthRange(addMonthsYm(mes, -5), mes);
  const porGrupoMes = meses6.map(m => new Map(gastosPorGrupo(b.lancs, b.categorias, [m]).map(g => [g.grupo, g.valor])));
  const grupos = [...new Set(porGrupoMes.flatMap(m => [...m.keys()]))]
    .map(g => {
      const vals = porGrupoMes.map(m => m.get(g) ?? 0);
      const media = sum(vals.slice(0, 5)) / 5;
      return { g, vals, media, delta: vals[5] - media };
    })
    .filter(x => x.vals.some(v => v !== 0))
    .sort((a, c) => c.vals[5] - a.vals[5]);

  return (
    <>
      <div className="page-head">
        <div><h1>Insights</h1><p className="muted small">Análises automáticas a partir dos seus lançamentos, do previsto e das parcelas já contratadas.</p></div>
        <MonthNav mes={mes} base="/insights" atual={atual} />
      </div>

      <div className="grid g-3-1">
        <section className="card">
          <div className="card-head">
            <div><h2>Projeção de saldo</h2><p className="muted small">Próximos 6 meses no ritmo dos últimos 3 meses fechados, somando as parcelas já contratadas</p></div>
            <nav className="seg" aria-label="Cenário de entradas">
              <Link href={`/insights?mes=${mes}`} aria-current={cenario === 'media'}>Entradas: média</Link>
              <Link href={`/insights?mes=${mes}&cenario=previsto`} aria-current={cenario === 'previsto'}>Entradas: previsto</Link>
            </nav>
          </div>
          <ProjecaoChart dados={pontos} />
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Mês</th><th className="r">Entradas</th><th className="r">Conta</th><th className="r">Parcelas já contratadas</th><th className="r">Cartão novo (estimado)</th><th className="r">Saldo final</th></tr></thead>
              <tbody>
                {projecao.map(p => (
                  <tr key={p.mes}>
                    <td>{fmtMes(p.mes)} {p.base === 'previsto' && <span className="badge">previsto</span>}</td>
                    <td className="r"><Money v={p.entradas} /></td>
                    <td className="r"><Money v={p.saidasConta} /></td>
                    <td className="r"><Money v={p.parcelasCartao} /></td>
                    <td className="r"><Money v={p.cartaoNovo} /></td>
                    <td className="r"><Money v={p.saldoFinal} sinal /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Destaques de {fmtMes(mes)}</h2></div>
          <InsightList itens={insights} />
        </section>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-head">
            <div><h2>Geração de caixa por mês</h2><p className="muted small">Entradas − saídas</p></div>
            <div className="small" style={{ textAlign: 'right' }}>12 meses: <Money v={ger12} sinal /><br /><span className="muted">{entr12 > 0 ? `${fmtPct(ger12 / entr12)} das entradas` : ''}</span></div>
          </div>
          <SerieChart dados={geracao} nome="Geração de caixa" cor="var(--s3)" />
        </section>

        <section className="card" id="recorrentes">
          <div className="card-head"><div><h2>Gastos recorrentes</h2><p className="muted small">Mesma descrição em ≥ 3 dos últimos 4 meses, valor estável</p></div><span className="num small">{fmtBRL(sum(recorrentes.map(r => r.valorMedio)))}/mês</span></div>
          {recorrentes.length ? (
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Descrição</th><th>Subgrupo</th><th className="r">Média</th><th className="r">Meses</th></tr></thead>
                <tbody>
                  {recorrentes.map(r => (
                    <tr key={r.descricao + r.conta}>
                      <td className="desc-cell" title={r.descricao}>{r.descricao}<div className="tiny faint">{r.conta ?? 'Conta'}</div></td>
                      <td className="small">{r.subgrupo}</td>
                      <td className="r"><Money v={r.valorMedio} /></td>
                      <td className="r num">{r.meses}/4</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small">Nenhum padrão recorrente encontrado.</p>}
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div><h2>Tendência por grupo</h2><p className="muted small">Saídas dos últimos 6 meses · variação de {fmtMes(mes)} contra a média dos 5 anteriores</p></div></div>
        <div className="table-wrap">
          <table className="fluxo">
            <thead><tr><th>Grupo</th>{meses6.map(m => <th key={m} className="r">{fmtMes(m)}</th>)}<th className="r">Variação</th></tr></thead>
            <tbody>
              {grupos.map(x => (
                <tr key={x.g}>
                  <td>{x.g}</td>
                  {x.vals.map((v, i) => <td key={i} className={`r num ${v === 0 ? 'zero' : ''}`}>{v === 0 ? '–' : fmtNum(v)}</td>)}
                  <td className={`r num ${x.delta > 50 ? 'neg' : x.delta < -50 ? 'pos' : 'faint'}`}>
                    {Math.abs(x.delta) < 0.5 ? '–' : `${x.delta > 0 ? '▲ +' : '▼ '}${fmtNum(x.delta)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
