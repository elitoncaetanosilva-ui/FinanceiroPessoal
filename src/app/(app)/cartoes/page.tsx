import Link from 'next/link';
import { FaturasChart } from '@/components/charts';
import { corCartao } from '@/lib/cores';
import { MonthNav, Money, Vazio } from '@/components/ui';
import { carregarBase, mesAtual, mesParam } from '@/lib/dados';
import { faturasPorMes, gastosPorSubgrupo, mesCaixa, parceladasEmAberto } from '@/lib/finance';
import { getContas } from '@/lib/repo';
import { addMonthsYm, fmtBRL, fmtData, fmtMes, fmtNum, monthRange, parcelaStr, sum } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function CartoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const atual = mesAtual();
  const mes = mesParam(sp.mes);
  const [b, contas] = await Promise.all([carregarBase(), getContas()]);
  const cartoes = b.cartoes;
  const cartao = sp.cartao && cartoes.includes(sp.cartao) ? sp.cartao : 'todos';
  const doCartao = (conta: string | null) => cartao === 'todos' || conta === cartao;

  const cardLancs = b.lancs.filter(l => l.origem === 'cartao' && !l.ignorado);
  if (!cardLancs.length) return <Vazio titulo="Sem lançamentos de cartão">Importe a planilha ou conecte os cartões em <Link href="/conexoes">Dados & bancos</Link>.</Vazio>;

  const mesesGraf = monthRange(addMonthsYm(mes, -6), addMonthsYm(mes, 9));
  const faturas = faturasPorMes(b.lancs, mesesGraf, cartoes).map(f => ({ mes: f.mes, total: f.total, ...f.porCartao }));
  const fatMes = faturasPorMes(b.lancs, [mes, addMonthsYm(mes, 1)], cartoes);
  const futuras = (c: string) => sum(cardLancs.filter(l => l.conta === c && mesCaixa(l) > mes).map(l => l.valor));

  const mesesRes = monthRange(addMonthsYm(mes, -5), addMonthsYm(mes, 3));
  const porSub = mesesRes.map(m => gastosPorSubgrupo(b.lancs, [m], l => l.origem === 'cartao' && doCartao(l.conta)));
  const subs = [...new Set(porSub.flatMap(m => [...m.keys()]))]
    .map(s => ({ s, tot: sum(porSub.map(m => m.get(s) ?? 0)) }))
    .filter(x => Math.abs(x.tot) > 0.005)
    .sort((a, c) => c.tot - a.tot);

  const abertas = parceladasEmAberto(b.lancs, mes).filter(p => doCartao(p.conta));
  const itensFatura = cardLancs.filter(l => mesCaixa(l) === mes && doCartao(l.conta)).sort((a, c) => c.valor - a.valor);
  const qs = (o: Record<string, string>) => `/cartoes?${new URLSearchParams({ mes, cartao, ...o })}`;

  return (
    <>
      <div className="page-head">
        <div><h1>Cartões</h1><p className="muted small">Cada parcela entra no mês de vencimento da fatura. Meses futuros mostram o que já está contratado.</p></div>
        <MonthNav mes={mes} base="/cartoes" params={{ cartao }} atual={atual} />
      </div>

      <div className="grid g-kpi">
        {cartoes.map((c, i) => {
          const conta = contas.find(x => x.tipo === 'CREDIT' && x.apelido === c);
          return (
            <div className="card" key={c}>
              <div className="kpi-label"><i className="dot" style={{ background: corCartao(i) }} />{c} · fatura {fmtMes(mes)}</div>
              <div className="kpi-value"><Money v={fatMes[0].porCartao[c] ?? 0} /></div>
              <div className="kpi-sub">
                Próxima: {fmtBRL(fatMes[1].porCartao[c] ?? 0)} · a vencer depois: {fmtBRL(futuras(c))}
                {conta?.limite ? <><br />Limite disponível {fmtBRL(conta.limite_disponivel ?? 0)} de {fmtBRL(conta.limite)}</> : null}
              </div>
            </div>
          );
        })}
        <div className="card">
          <div className="kpi-label">Total em {fmtMes(mes)}</div>
          <div className="kpi-value"><Money v={fatMes[0].total} /></div>
          <div className="kpi-sub">{abertas.length} compras parceladas em aberto</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div><h2>Faturas por mês</h2><p className="muted small">Linha tracejada = mês selecionado</p></div></div>
        <FaturasChart dados={faturas} cartoes={cartoes} mesAtual={mes} altura={260} />
      </section>

      <div className="row" style={{ margin: '18px 0 10px' }}>
        <nav className="seg" aria-label="Cartão">
          <Link href={qs({ cartao: 'todos' })} aria-current={cartao === 'todos'}>Todos</Link>
          {cartoes.map(c => <Link key={c} href={qs({ cartao: c })} aria-current={cartao === c}>{c}</Link>)}
        </nav>
      </div>

      <div className="grid g-2">
        <section className="card">
          <div className="card-head"><h2>Fatura de {fmtMes(mes)}</h2><Link className="small" href={`/lancamentos?mes=${mes}&tipo=cartao${cartao !== 'todos' ? `&conta=${encodeURIComponent(cartao)}` : ''}`}>Editar →</Link></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Compra</th><th>Descrição</th><th className="r">Valor</th></tr></thead>
              <tbody>
                {itensFatura.map(l => (
                  <tr key={l.id}>
                    <td className="num small">{fmtData(l.data)}</td>
                    <td className="desc-cell" title={l.descricao}>
                      {l.descricao} {l.parcelas && l.parcelas > 1 ? <span className="badge">{parcelaStr(l.parcela, l.parcelas)}</span> : null}
                      <div className="tiny faint">{cartao === 'todos' ? `${l.conta} · ` : ''}{l.subgrupo}</div>
                    </td>
                    <td className="r"><Money v={l.valor} /></td>
                  </tr>
                ))}
                {!itensFatura.length && <tr><td colSpan={3} className="muted">Sem lançamentos neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Parcelados em aberto</h2><p className="muted small">Compras com parcelas depois de {fmtMes(mes)}</p></div><span className="num small">Total {fmtBRL(sum(abertas.map(a => a.restante)))}</span></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Compra</th><th className="r">Parcela</th><th className="r">Restam</th><th className="r">A pagar</th></tr></thead>
              <tbody>
                {abertas.map(a => (
                  <tr key={a.chave}>
                    <td className="desc-cell" title={a.descricao}>{a.descricao}<div className="tiny faint">{a.conta} · {a.subgrupo} · até {fmtMes(a.ultimaParcela)}</div></td>
                    <td className="r"><Money v={a.valorParcela} /></td>
                    <td className="r num">{a.parcelas - a.pagas}/{a.parcelas}</td>
                    <td className="r"><Money v={a.restante} /></td>
                  </tr>
                ))}
                {!abertas.length && <tr><td colSpan={4} className="muted">Nenhuma parcela futura.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div><h2>Resumo por subgrupo</h2><p className="muted small">Como a aba “Resumo Cartão”: soma por mês de vencimento</p></div></div>
        <div className="table-wrap">
          <table className="fluxo">
            <thead><tr><th>Subgrupo</th>{mesesRes.map(m => <th key={m} className={`r ${m === mes ? 'cur' : ''}`}>{fmtMes(m)}</th>)}</tr></thead>
            <tbody>
              {subs.map(({ s }) => (
                <tr key={s}>
                  <td>{s}</td>
                  {porSub.map((m, i) => { const v = m.get(s) ?? 0; return <td key={i} className={`r num ${mesesRes[i] === mes ? 'cur' : ''} ${v === 0 ? 'zero' : ''}`}>{v === 0 ? '–' : fmtNum(v)}</td>; })}
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td>
                {porSub.map((m, i) => <td key={i} className={`r num ${mesesRes[i] === mes ? 'cur' : ''}`}>{fmtNum(sum([...m.values()]))}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
