import { ApagarTudo, ConectarBanco, FormEstado, ImportarPlanilha, SincronizarAgora } from './client';
import { Money } from '@/components/ui';
import { getConfig, getContas, getItens, getRegras, getSaldoInicial, getSyncLog } from '@/lib/repo';
import { getSyncDesde, pluggyConfigurado } from '@/lib/sync';
import { excluirRegraAction, reaprenderAction, removerItemAction, renomearContaAction, saldoInicialAction, syncDesdeAction } from '../../actions';
import { fmtData, fmtMes, todayISO } from '@/lib/util';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; cls: string }> = {
  UPDATED: { label: 'atualizado', cls: 'badge-good' },
  UPDATING: { label: 'atualizando', cls: 'badge-accent' },
  LOGIN_ERROR: { label: 'erro de login', cls: 'badge-bad' },
  OUTDATED: { label: 'desatualizado', cls: 'badge-warn' },
  WAITING_USER_INPUT: { label: 'aguardando você', cls: 'badge-warn' },
  WAITING_USER_ACTION: { label: 'aguardando você', cls: 'badge-warn' },
};

const dataHora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');

export default async function ConexoesPage() {
  const configurado = pluggyConfigurado();
  const [itens, contas, regras, saldoIni, desde, log, cartoes] = await Promise.all([
    getItens(), getContas(), getRegras(), getSaldoInicial(), getSyncDesde(), getSyncLog(), getConfig<string[]>('cartoes', []),
  ]);
  const doUsuario = regras.filter(r => r.origem === 'usuario');
  const aprendidas = regras.length - doUsuario.length;

  return (
    <>
      <div className="page-head">
        <div><h1>Dados & bancos</h1><p className="muted small">Open Finance (Itaú, Nubank), planilha CAIXA 2026, saldo inicial e regras de categorização.</p></div>
      </div>

      <div className="stack">
        <section className="card" id="open-finance">
          <div className="card-head">
            <div><h2>Open Finance</h2><p className="muted small">Conexão autorizada no app do banco, via Pluggy (instituição regulada pelo Banco Central). Leitura apenas: extratos, faturas, saldos e limites.</p></div>
            {configurado && <div className="row"><SincronizarAgora /><ConectarBanco /></div>}
          </div>

          {!configurado ? (
            <div className="alert alert-info">
              <b>Falta configurar a Pluggy.</b> Crie uma conta em <a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">dashboard.pluggy.ai</a>, gere as credenciais da aplicação e cadastre na Vercel as variáveis <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code>. O README tem o passo a passo.
            </div>
          ) : itens.length === 0 ? (
            <p className="muted">Nenhum banco conectado. Clique em <b>Conectar banco</b> e escolha Itaú ou Nubank (Open Finance). Repita para cada instituição.</p>
          ) : (
            <ul className="list-plain">
              {itens.map(i => (
                <li key={i.item_id}>
                  <div>
                    <b>{i.conector}</b> <span className={`badge ${STATUS[i.status ?? '']?.cls ?? ''}`}>{STATUS[i.status ?? '']?.label ?? i.status?.toLowerCase() ?? '—'}</span>
                    <div className="tiny muted">Última sincronização: {dataHora(i.ultimo_sync)}{i.erro ? <span className="neg"> · {i.erro}</span> : null}</div>
                  </div>
                  <div className="row">
                    <ConectarBanco itemId={i.item_id} rotulo="Reautorizar" />
                    <form action={removerItemAction}><input type="hidden" name="item" value={i.item_id} /><button className="btn btn-sm btn-ghost btn-danger">Desconectar</button></form>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {contas.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Contas e cartões</h3>
              <p className="tiny muted" style={{ margin: '2px 0 8px' }}>O nome do cartão precisa bater com a coluna CARTÃO da planilha ({cartoes.join(', ') || 'Itaú Black, Nubank'}) para a conciliação funcionar.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nome no app</th><th>Tipo</th><th>Instituição</th><th className="r">Saldo / fatura</th><th className="r">Limite disp.</th><th>Vencimento</th></tr></thead>
                  <tbody>
                    {contas.map(c => (
                      <tr key={c.id}>
                        <td>
                          <form action={renomearContaAction} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                            <input type="hidden" name="id" value={c.id} />
                            <input name="apelido" defaultValue={c.apelido} aria-label="Nome no app" style={{ width: 150 }} />
                            <button className="btn btn-sm">Salvar</button>
                          </form>
                        </td>
                        <td className="small">{c.tipo === 'CREDIT' ? 'Cartão' : 'Conta'}</td>
                        <td className="small muted">{c.nome}</td>
                        <td className="r"><Money v={c.saldo ?? 0} /></td>
                        <td className="r">{c.limite_disponivel != null ? <Money v={c.limite_disponivel} /> : '—'}</td>
                        <td className="small">{c.vencimento ? fmtData(c.vencimento) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <details className="disclosure" style={{ marginTop: 14 }}>
            <summary className="small"><b>Data de corte</b> <span className="muted">· a partir de {fmtData(desde)} o banco alimenta o app; antes disso vale a planilha</span></summary>
            <FormEstado action={syncDesdeAction} className="row" style={{ marginTop: 8 }} botao="Salvar">
              <input type="date" name="desde" defaultValue={desde} max={todayISO()} aria-label="Data de corte" />
            </FormEstado>
            <p className="tiny muted">Movimentos do banco depois do corte que já estiverem na planilha (mesmo valor e data ou mesma parcela e vencimento) são <b>conciliados</b>, não duplicados.</p>
          </details>

          {log.length > 0 && (
            <details className="disclosure" style={{ marginTop: 10 }}>
              <summary className="small"><b>Histórico de sincronização</b></summary>
              <ul className="list-plain small" style={{ marginTop: 6 }}>
                {log.map((l, i) => (
                  <li key={i}><span>{dataHora(l.em)}</span><span className={l.erro ? 'neg' : 'muted'}>{l.erro ?? `${l.novos} novos · ${l.atualizados} atualizados · ${l.conciliados} conciliados · ${l.projetados} projetados`}</span></li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <div className="grid g-2">
          <section className="card">
            <div className="card-head"><div><h2>Planilha CAIXA 2026</h2><p className="muted small">Importa CASH, CARTÃO, Apoio e CAIXA MENSAL (entradas, previsto e saldo inicial).</p></div></div>
            <ImportarPlanilha />
            <p className="tiny muted">Reimportar substitui só as linhas vindas da planilha. O que veio do banco, os lançamentos manuais e suas recategorizações ficam.</p>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
            <div className="row"><a className="btn" href="/api/export">Exportar no layout da planilha (.xlsx)</a></div>
            <p className="tiny muted">Gera as abas CAIXA MENSAL, CASH e CARTÃO (com as fórmulas de MÊS_COMPRA/MÊS_VENC), ENTRADAS e Apoio.</p>
          </section>

          <section className="card" id="saldo">
            <div className="card-head"><div><h2>Saldo inicial</h2><p className="muted small">Ponto de partida do encadeamento de saldos (linha SALDO INICIAL do CAIXA MENSAL).</p></div></div>
            {saldoIni && <p className="small">Atual: <b><Money v={saldoIni.valor} /></b> no início de {fmtMes(saldoIni.mes)}</p>}
            <FormEstado action={saldoInicialAction} className="row" botao="Salvar">
              <label className="field">Mês<input type="month" name="mes" defaultValue={saldoIni?.mes ?? todayISO().slice(0, 7)} required /></label>
              <label className="field">Valor (R$)<input name="valor" inputMode="decimal" defaultValue={saldoIni ? String(saldoIni.valor).replace('.', ',') : ''} required /></label>
            </FormEstado>
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <div><h2>Regras de categorização</h2><p className="muted small">{aprendidas} regras aprendidas do histórico da planilha + {doUsuario.length} criadas por você (“lembrar”). Suas regras têm prioridade.</p></div>
            <form action={reaprenderAction}><button className="btn btn-sm">Reaprender do histórico</button></form>
          </div>
          {doUsuario.length ? (
            <ul className="list-plain">
              {doUsuario.map(r => (
                <li key={r.id}>
                  <span><code>{r.padrao}</code> → <b>{r.subgrupo}</b> <span className="faint small">({r.natureza})</span></span>
                  <form action={excluirRegraAction}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm btn-ghost btn-danger">Remover</button></form>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">Nenhuma regra manual ainda. Ao recategorizar um lançamento com “lembrar” marcado, a regra aparece aqui.</p>}
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Zona de perigo</h2><p className="muted small">Apaga lançamentos, previsto, regras, conexões e configurações do banco de dados do app.</p></div></div>
          <ApagarTudo />
        </section>
      </div>
    </>
  );
}
