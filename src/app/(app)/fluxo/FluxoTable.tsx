'use client';

import { useRef, useState } from 'react';
import type { Fluxo } from '@/lib/finance';
import { fmtMes, fmtNum } from '@/lib/util';
import { orcamentoAction } from '../../actions';

type Modo = 'realizado' | 'previsto' | 'ambos';
const f = (v: number) => (Math.abs(v) < 0.005 ? '–' : fmtNum(v));

export function FluxoTable({ fluxo, modo, mesAtual }: { fluxo: Fluxo; modo: Modo; mesAtual: string }) {
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ mes: string; cat: string; rotulo: string; valor: number } | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const toggle = (g: string) => setFechados(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const abrir = (mes: string, cat: string, rotulo: string, valor: number) => { setEdit({ mes, cat, rotulo, valor }); dlg.current?.showModal(); };

  const { meses, resumo, linhas } = fluxo;
  const total = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const cell = (real: number, prev: number, i: number, cat?: string, rotulo?: string, despesa = true) => {
    const mes = meses[i];
    const over = despesa ? prev > 0 && real > prev * 1.05 : prev > 0 && real < prev * 0.95;
    const prevBtn = cat ? (
      <button type="button" className="cell" onClick={() => abrir(mes, cat, rotulo!, prev)} title={`Editar previsto de ${rotulo} em ${fmtMes(mes)}`}>{f(prev)}</button>
    ) : f(prev);
    const cls = `r num ${mes === mesAtual ? 'cur' : ''}`;
    if (modo === 'realizado') return <td key={mes} className={`${cls} ${real === 0 ? 'zero' : ''}`}>{f(real)}</td>;
    if (modo === 'previsto') return <td key={mes} className={`${cls} ${prev === 0 ? 'zero' : ''}`}>{prevBtn}</td>;
    return (
      <td key={mes} className={cls}>
        <span className={over ? 'over' : real === 0 ? 'faint' : ''}>{f(real)}</span>
        <span className="prev">{prevBtn}</span>
      </td>
    );
  };

  const secao = (nat: 'receita' | 'despesa') => {
    const ls = linhas.filter(l => l.natureza === nat);
    const out: React.ReactNode[] = [];
    for (const l of ls) {
      if (l.subgrupo === null) {
        const vazio = l.realizado.every(v => v === 0) && l.previsto.every(v => v === 0);
        const aberto = !fechados.has(nat + l.grupo);
        out.push(
          <tr key={nat + l.grupo} className="grp" style={vazio ? { opacity: 0.6 } : undefined}>
            <td><button type="button" className="cell" style={{ textAlign: 'left' }} onClick={() => toggle(nat + l.grupo)} aria-expanded={aberto}>{aberto ? '▾' : '▸'} {l.grupo}</button></td>
            {meses.map((_, i) => cell(l.realizado[i], l.previsto[i], i, undefined, undefined, nat === 'despesa'))}
            <td className="r num">{f(total(modo === 'previsto' ? l.previsto : l.realizado))}</td>
          </tr>,
        );
      } else if (!fechados.has(nat + l.grupo)) {
        out.push(
          <tr key={nat + l.subgrupo}>
            <td className="sub">{l.subgrupo}</td>
            {meses.map((_, i) => cell(l.realizado[i], l.previsto[i], i, `${nat}:${l.subgrupo}`, l.subgrupo!, nat === 'despesa'))}
            <td className="r num">{f(total(modo === 'previsto' ? l.previsto : l.realizado))}</td>
          </tr>,
        );
      }
    }
    return out;
  };

  const linhaTotal = (rotulo: string, real: number[], prev: number[], cls = 'tot', despesa = true) => (
    <tr className={cls}>
      <td>{rotulo}</td>
      {meses.map((_, i) => cell(real[i], prev[i], i, undefined, undefined, despesa))}
      <td className="r num">{f(total(modo === 'previsto' ? prev : real))}</td>
    </tr>
  );

  const temTodosFechados = fechados.size > 0;
  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-end', padding: '8px 0' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFechados(temTodosFechados ? new Set() : new Set(linhas.filter(l => !l.subgrupo).map(l => l.natureza + l.grupo)))}>
          {temTodosFechados ? 'Expandir tudo' : 'Recolher tudo'}
        </button>
      </div>
      <div className="table-wrap">
        <table className="fluxo">
          <thead>
            <tr>
              <th>{modo === 'ambos' ? 'Realizado / previsto' : modo === 'previsto' ? 'Previsto' : 'Realizado'}</th>
              {meses.map(m => <th key={m} className={`r ${m === mesAtual ? 'cur' : ''}`}>{fmtMes(m)}</th>)}
              <th className="r">Ano</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sec"><td colSpan={meses.length + 2}>Entradas</td></tr>
            {secao('receita')}
            {linhaTotal('Total de entradas', resumo.map(r => r.entradas), resumo.map(r => r.entradasPrev), 'tot', false)}
            <tr className="sec"><td colSpan={meses.length + 2}>Saídas</td></tr>
            {secao('despesa')}
            {linhaTotal('Total de saídas', resumo.map(r => r.saidas), resumo.map(r => r.saidasPrev))}
            <tr className="sec"><td colSpan={meses.length + 2}>Resultado</td></tr>
            {linhaTotal('Geração de caixa', resumo.map(r => r.geracao), resumo.map(r => r.geracaoPrev), 'tot', false)}
            <tr>
              <td>Saldo inicial</td>
              {resumo.map(r => <td key={r.mes} className={`r num ${r.mes === mesAtual ? 'cur' : ''}`}>{r.saldoInicial == null ? '–' : f(r.saldoInicial)}</td>)}
              <td />
            </tr>
            <tr className="tot">
              <td>Saldo final</td>
              {resumo.map(r => (
                <td key={r.mes} className={`r num ${r.mes === mesAtual ? 'cur' : ''}`}>
                  <span className={(r.saldoFinal ?? 0) < 0 ? 'neg' : ''}>{r.saldoFinal == null ? '–' : f(r.saldoFinal)}</span>
                  {modo !== 'realizado' && r.saldoFinalPrev != null && r.temPrevisto && <span className="prev">{f(r.saldoFinalPrev)}</span>}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <dialog ref={dlg} onClose={() => setEdit(null)}>
        {edit && (
          <form action={async fd => { await orcamentoAction(fd); dlg.current?.close(); }} className="stack">
            <h2>Previsto · {edit.rotulo} · {fmtMes(edit.mes)}</h2>
            <input type="hidden" name="mes" value={edit.mes} />
            <input type="hidden" name="cat" value={edit.cat} />
            <label className="field">Valor (deixe vazio para remover)
              <input name="valor" inputMode="decimal" defaultValue={edit.valor ? String(edit.valor).replace('.', ',') : ''} autoFocus />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancelar</button>
              <button className="btn btn-primary">Salvar</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
