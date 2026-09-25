import Link from 'next/link';
import { FluxoTable } from './FluxoTable';
import { carregarBase, mesAtual } from '@/lib/dados';
import { calcFluxo, intervaloMeses, mesesAno } from '@/lib/finance';
import { monthRange } from '@/lib/util';
import { copiarPrevistoAction } from '../../actions';
import { fmtMes } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function FluxoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const atual = mesAtual();
  const ano = Number(sp.ano) || Number(atual.slice(0, 4));
  const modo = (['realizado', 'previsto', 'ambos'].includes(sp.modo ?? '') ? sp.modo : 'ambos') as 'realizado' | 'previsto' | 'ambos';
  const b = await carregarBase();
  const meses = mesesAno(ano);
  // Encadeia o saldo desde o início dos dados para o saldo inicial do ano ficar certo.
  const { min } = intervaloMeses(b.lancs, meses[0]);
  const inicio = [min, b.saldoInicial?.mes ?? min, meses[0]].sort()[0];
  const fluxoTodo = calcFluxo(b.lancs, b.categorias, b.orcamentos, b.saldoInicial, monthRange(inicio, meses[11]));
  const off = fluxoTodo.meses.indexOf(meses[0]);
  const fluxo = {
    meses,
    resumo: fluxoTodo.resumo.slice(off),
    linhas: fluxoTodo.linhas.map(l => ({ ...l, realizado: l.realizado.slice(off), previsto: l.previsto.slice(off) })),
  };
  const anos = [...new Set([...monthRange(inicio, atual).map(m => Number(m.slice(0, 4))), ano, Number(atual.slice(0, 4)) + 1])].sort();
  const q = (o: Record<string, string | number>) => `/fluxo?${new URLSearchParams({ ano: String(ano), modo, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fluxo de caixa {ano}</h1>
          <p className="muted small">O CAIXA MENSAL: realizado vem dos lançamentos (CASH + CARTÃO pelo vencimento + entradas). Clique num valor previsto para editar.</p>
        </div>
        <div className="row">
          <nav className="seg" aria-label="Ano">
            {anos.map(a => <Link key={a} href={q({ ano: a })} aria-current={a === ano}>{a}</Link>)}
          </nav>
          <nav className="seg" aria-label="Visão">
            {(['realizado', 'previsto', 'ambos'] as const).map(m => <Link key={m} href={q({ modo: m })} aria-current={m === modo}>{m === 'ambos' ? 'Previsto × realizado' : m[0].toUpperCase() + m.slice(1)}</Link>)}
          </nav>
          <a className="btn btn-sm" href={`/api/export?ano=${ano}`}>Baixar .xlsx</a>
        </div>
      </div>

      <section className="card" style={{ padding: '4px 16px 8px' }}>
        <FluxoTable fluxo={fluxo} modo={modo} mesAtual={atual} />
      </section>

      <details className="card disclosure" style={{ marginTop: 14 }}>
        <summary><h2 style={{ display: 'inline' }}>Replicar previsto</h2> <span className="muted small">copiar o previsto de um mês para os meses seguintes</span></summary>
        <form action={copiarPrevistoAction} className="row" style={{ marginTop: 12 }}>
          <label className="field">De
            <select name="de" defaultValue={atual}>{meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}</select>
          </label>
          <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted">Para</legend>
            {meses.map(m => <label key={m} className="small row" style={{ gap: 4 }}><input type="checkbox" name="para" value={m} />{fmtMes(m)}</label>)}
          </fieldset>
          <button className="btn">Copiar</button>
        </form>
      </details>
    </>
  );
}
