'use client';

import { useActionState, useRef, useState } from 'react';
import { categorizarAction, excluirAction, ignorarAction, novoLancamentoAction } from '../../actions';

type Opcao = { value: string; label: string; grupo: string };

function agrupado(opcoes: Opcao[]) {
  const m = new Map<string, Opcao[]>();
  for (const o of opcoes) m.set(o.grupo, [...(m.get(o.grupo) ?? []), o]);
  return [...m.entries()];
}

export function CatSelect({ id, value, opcoes, revisar }: { id: number; value: string; opcoes: Opcao[]; revisar: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [salvando, setSalvando] = useState(false);
  return (
    <form ref={form} action={async fd => { setSalvando(true); await categorizarAction(fd); setSalvando(false); }} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input type="hidden" name="id" value={id} />
      <select name="cat" defaultValue={value} aria-label="Subgrupo" onChange={() => form.current?.requestSubmit()} disabled={salvando}
        style={{ maxWidth: 220, borderColor: revisar ? 'var(--warn)' : undefined }}>
        {agrupado(opcoes).map(([g, os]) => (
          <optgroup key={g} label={g}>{os.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
        ))}
      </select>
      <label className="tiny muted row" style={{ gap: 3, flexWrap: 'nowrap' }} title="Criar regra: próximas compras com esta descrição recebem este subgrupo">
        <input type="checkbox" name="lembrar" defaultChecked={revisar} /> lembrar
      </label>
      {revisar && <span className="badge badge-warn">revisar</span>}
    </form>
  );
}

export function RowActions({ id, ignorado, podeExcluir }: { id: number; ignorado: boolean; podeExcluir: boolean }) {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <form action={ignorarAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="ignorado" value={ignorado ? '0' : '1'} />
        <button className="btn btn-sm btn-ghost" title={ignorado ? 'Voltar a contar no fluxo' : 'Não contar no fluxo (ex.: transferência entre contas próprias)'}>{ignorado ? 'Contar' : 'Ignorar'}</button>
      </form>
      {podeExcluir && (
        confirmar ? (
          <form action={excluirAction}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-sm btn-danger" onBlur={() => setConfirmar(false)} autoFocus>Confirmar</button>
          </form>
        ) : (
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmar(true)}>Excluir</button>
        )
      )}
    </div>
  );
}

export function NovoLancamento({ categorias, cartoes, hoje }: { categorias: Opcao[]; cartoes: string[]; hoje: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [origem, setOrigem] = useState<'cash' | 'cartao'>('cash');
  const [estado, action, pendente] = useActionState(novoLancamentoAction, null);
  return (
    <>
      <button className="btn btn-primary" onClick={() => dlg.current?.showModal()}>+ Lançamento</button>
      <dialog ref={dlg}>
        <form action={action} className="stack">
          <div className="row"><h2>Novo lançamento</h2><span className="spacer" /><button type="button" className="btn btn-ghost btn-sm" onClick={() => dlg.current?.close()}>Fechar</button></div>
          <div className="seg" role="group" aria-label="Tipo">
            <button type="button" aria-pressed={origem === 'cash'} onClick={() => setOrigem('cash')}>Conta / dinheiro</button>
            <button type="button" aria-pressed={origem === 'cartao'} onClick={() => setOrigem('cartao')}>Cartão</button>
          </div>
          <input type="hidden" name="origem" value={origem} />
          <div className="form-grid">
            <label className="field">Data<input type="date" name="data" defaultValue={hoje} required /></label>
            <label className="field">Valor (R$)<input name="valor" inputMode="decimal" placeholder="0,00" required /></label>
            <label className="field full">Descrição<input name="descricao" required /></label>
            <label className="field full">Subgrupo
              <select name="cat" defaultValue="">
                <option value="">Automático (pelas regras)</option>
                {agrupado(categorias).map(([g, os]) => <optgroup key={g} label={g}>{os.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
              </select>
            </label>
            {origem === 'cartao' && (
              <>
                <label className="field">Cartão<select name="conta">{cartoes.map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="field">Parcelas<input type="number" name="parcelas" min={1} max={48} defaultValue={1} /></label>
                <label className="field full">Vencimento da 1ª fatura<input type="date" name="vencimento" required /></label>
              </>
            )}
          </div>
          <p className="tiny muted">Valor positivo = saída (ou entrada, se o subgrupo for de entrada). Negativo = estorno/crédito.</p>
          {estado?.erro && <p className="alert alert-err">{estado.erro}</p>}
          {estado?.ok && <p className="alert alert-ok">{estado.ok}</p>}
          <button className="btn btn-primary" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar'}</button>
        </form>
      </dialog>
    </>
  );
}
