import Link from 'next/link';
import { CatSelect, NovoLancamento, RowActions } from './client';
import { MonthNav, Money } from '@/components/ui';
import { carregarBase, mesAtual, mesParam } from '@/lib/dados';
import { mesCaixa } from '@/lib/finance';
import { catKey } from '@/lib/taxonomy';
import { fmtData, norm, parcelaStr, sum, todayISO } from '@/lib/util';

export const dynamic = 'force-dynamic';

const FONTE: Record<string, { label: string; cls: string }> = {
  planilha: { label: 'planilha', cls: '' },
  pluggy: { label: 'banco', cls: 'badge-accent' },
  manual: { label: 'manual', cls: '' },
  projecao: { label: 'projeção', cls: 'badge-warn' },
};

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const atual = mesAtual();
  const todos = sp.mes === 'todos';
  const pend = sp.pendentes === '1';
  const mes = mesParam(sp.mes);
  const b = await carregarBase();
  const grupoDe = new Map(b.categorias.map(c => [catKey(c.natureza, c.subgrupo), c.grupo]));

  const busca = norm(sp.q ?? '');
  let ls = b.lancs.filter(l => {
    if (pend) return l.revisar && !l.ignorado;
    if (!todos && mesCaixa(l) !== mes) return false;
    if (sp.tipo === 'cash' && !(l.origem === 'cash' && l.natureza === 'despesa')) return false;
    if (sp.tipo === 'cartao' && l.origem !== 'cartao') return false;
    if (sp.tipo === 'receita' && l.natureza !== 'receita') return false;
    if (sp.conta && l.conta !== sp.conta) return false;
    if (sp.sub && l.subgrupo !== sp.sub) return false;
    if (sp.grupo && grupoDe.get(catKey(l.natureza, l.subgrupo)) !== sp.grupo) return false;
    if (busca && !norm(l.descricao).includes(busca)) return false;
    return true;
  });
  ls = ls.sort((a, c) => c.vencimento.localeCompare(a.vencimento) || c.data.localeCompare(a.data) || c.id - a.id);
  const total = ls.length;
  const visiveis = ls.slice(0, 600);
  const ativos = ls.filter(l => !l.ignorado);
  const saidas = sum(ativos.filter(l => l.natureza === 'despesa').map(l => l.valor));
  const entradas = sum(ativos.filter(l => l.natureza === 'receita').map(l => l.valor));
  const opcoesCat = b.categorias.map(c => ({ value: catKey(c.natureza, c.subgrupo), label: c.subgrupo, grupo: `${c.natureza === 'receita' ? 'Entrada' : 'Saída'} · ${c.grupo}` }));
  const params = { tipo: sp.tipo, conta: sp.conta, sub: sp.sub, grupo: sp.grupo, q: sp.q };
  const contas = [...new Set(b.lancs.map(l => l.conta).filter(Boolean) as string[])].sort();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{pend ? 'Para revisar' : 'Lançamentos'}</h1>
          <p className="muted small">
            {pend ? 'Movimentos sem categoria confiável. Escolha o subgrupo; com "lembrar", a descrição vira regra.' : 'Filtrados pelo mês de caixa (vencimento).'}
          </p>
        </div>
        <div className="row">
          {!pend && !todos && <MonthNav mes={mes} base="/lancamentos" params={params} atual={atual} />}
          <NovoLancamento categorias={opcoesCat} cartoes={b.cartoes} hoje={todayISO()} />
        </div>
      </div>

      <form className="card row" style={{ marginBottom: 14 }} role="search">
        {!pend && <input type="hidden" name="mes" value={todos ? 'todos' : mes} />}
        <input name="q" placeholder="Buscar descrição" defaultValue={sp.q ?? ''} aria-label="Buscar descrição" style={{ flex: '1 1 180px' }} />
        <select name="tipo" defaultValue={sp.tipo ?? ''} aria-label="Tipo">
          <option value="">Tudo</option>
          <option value="cash">Conta (CASH)</option>
          <option value="cartao">Cartão</option>
          <option value="receita">Entradas</option>
        </select>
        <select name="conta" defaultValue={sp.conta ?? ''} aria-label="Conta ou cartão">
          <option value="">Todas as contas</option>
          {contas.map(c => <option key={c}>{c}</option>)}
        </select>
        <select name="sub" defaultValue={sp.sub ?? ''} aria-label="Subgrupo">
          <option value="">Todos os subgrupos</option>
          {[...new Set(b.categorias.map(c => c.subgrupo))].map(s => <option key={s}>{s}</option>)}
        </select>
        {sp.grupo && <input type="hidden" name="grupo" value={sp.grupo} />}
        <button className="btn">Filtrar</button>
        <Link className="btn btn-ghost" href={pend ? '/lancamentos?pendentes=1' : '/lancamentos'}>Limpar</Link>
        <span className="spacer" />
        <nav className="seg">
          <Link href="/lancamentos" aria-current={!todos && !pend}>Por mês</Link>
          <Link href={`/lancamentos?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>, mes: 'todos' })}`} aria-current={todos}>Todos</Link>
          <Link href="/lancamentos?pendentes=1" aria-current={pend}>Revisar{b.pendentes ? ` (${b.pendentes})` : ''}</Link>
        </nav>
      </form>

      {sp.grupo && <p className="small muted" style={{ marginTop: -6 }}>Grupo: <b>{sp.grupo}</b> · <Link href={`/lancamentos?mes=${mes}`}>remover filtro</Link></p>}

      <section className="card">
        <div className="card-head">
          <h2>{total} lançamento{total === 1 ? '' : 's'}{total > visiveis.length ? ` (mostrando ${visiveis.length})` : ''}</h2>
          <div className="row small" style={{ gap: 16 }}>
            <span>Saídas <Money v={saidas} /></span>
            <span>Entradas <Money v={entradas} /></span>
          </div>
        </div>
        {visiveis.length === 0 ? (
          <p className="muted">Nada por aqui.{pend ? ' Tudo revisado.' : ''}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th><th>Vencimento</th><th>Descrição</th><th>Conta</th><th>Subgrupo</th><th className="r">Valor</th><th />
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => (
                  <tr key={l.id} style={l.ignorado ? { opacity: 0.5 } : undefined}>
                    <td className="num small">{fmtData(l.data)}</td>
                    <td className="num small">{l.origem === 'cartao' ? fmtData(l.vencimento) : ''}</td>
                    <td className="desc-cell" title={l.descricao + (l.nota ? ` — ${l.nota}` : '')}>
                      {l.descricao}
                      {l.parcelas && l.parcelas > 1 ? <span className="badge" style={{ marginLeft: 6 }}>{parcelaStr(l.parcela, l.parcelas)}</span> : null}
                      {' '}<span className={`badge ${FONTE[l.fonte]?.cls ?? ''}`}>{FONTE[l.fonte]?.label ?? l.fonte}</span>
                      {l.ignorado && <span className="badge" title={l.nota ?? ''}> ignorado</span>}
                    </td>
                    <td className="small muted">{l.conta ?? (l.origem === 'cash' ? 'Conta' : '')}</td>
                    <td><CatSelect id={l.id} value={catKey(l.natureza, l.subgrupo)} opcoes={opcoesCat} revisar={l.revisar} /></td>
                    <td className="r"><Money v={l.natureza === 'receita' ? l.valor : -l.valor} sinal /></td>
                    <td className="r"><RowActions id={l.id} ignorado={l.ignorado} podeExcluir={l.fonte === 'manual' || l.fonte === 'projecao'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
