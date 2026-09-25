'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { apagarTudoAction, importarPlanilhaAction, registrarItemAction, sincronizarAction, type Estado } from '../../actions';

// O widget da Pluggy só roda no navegador.
const PluggyConnect = dynamic(() => import('react-pluggy-connect').then(m => m.PluggyConnect), { ssr: false });

function Mensagem({ estado }: { estado: Estado }) {
  if (!estado) return null;
  return (
    <>
      {estado.ok && <p className="alert alert-ok" role="status">{estado.ok}</p>}
      {estado.erro && <p className="alert alert-err" role="alert">{estado.erro}</p>}
    </>
  );
}

export function FormEstado({ action, children, botao, className, style }: {
  action: (s: Estado, fd: FormData) => Promise<Estado>; children: React.ReactNode; botao: string; className?: string; style?: React.CSSProperties;
}) {
  const [estado, act, pendente] = useActionState(action, null);
  return (
    <>
      <form action={act} className={className} style={{ alignItems: 'flex-end', ...style }}>
        {children}
        <button className="btn" disabled={pendente}>{pendente ? 'Salvando…' : botao}</button>
      </form>
      <div style={{ marginTop: 8 }}><Mensagem estado={estado} /></div>
    </>
  );
}

export function ImportarPlanilha() {
  const [estado, act, pendente] = useActionState(importarPlanilhaAction, null);
  return (
    <form action={act} className="stack" style={{ gap: 10 }}>
      <input type="file" name="arquivo" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Arquivo da planilha" required />
      <div><button className="btn btn-primary" disabled={pendente}>{pendente ? 'Importando…' : 'Importar planilha'}</button></div>
      <Mensagem estado={estado} />
    </form>
  );
}

export function SincronizarAgora() {
  const [estado, act, pendente] = useActionState(sincronizarAction, null);
  return (
    <form action={act} className="row">
      <button className="btn" disabled={pendente}>{pendente ? 'Sincronizando…' : 'Sincronizar agora'}</button>
      {estado && <div style={{ flexBasis: '100%' }}><Mensagem estado={estado} /></div>}
    </form>
  );
}

export function ConectarBanco({ itemId, rotulo = 'Conectar banco' }: { itemId?: string; rotulo?: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = async () => {
    setErro(null);
    setStatus('Abrindo…');
    const r = await fetch('/api/pluggy/connect-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.accessToken) { setStatus(null); setErro(j.erro ?? 'Não foi possível abrir a conexão.'); return; }
    setToken(j.accessToken);
    setStatus(null);
  };

  return (
    <>
      <button className={itemId ? 'btn btn-sm' : 'btn btn-primary'} onClick={abrir} disabled={!!status}>{status ?? rotulo}</button>
      {erro && <span className="small neg">{erro}</span>}
      {token && (
        <PluggyConnect
          connectToken={token}
          updateItem={itemId}
          includeSandbox={process.env.NEXT_PUBLIC_PLUGGY_SANDBOX === '1'}
          onSuccess={async ({ item }) => {
            setToken(null);
            setStatus('Sincronizando…');
            const res = await registrarItemAction(item.id);
            setStatus(null);
            if (!res.ok) setErro(res.erro ?? 'Falha ao sincronizar.');
            router.refresh();
          }}
          onError={e => { setErro(e.message); }}
          onClose={() => setToken(null)}
        />
      )}
    </>
  );
}

export function ApagarTudo() {
  const [estado, act, pendente] = useActionState(apagarTudoAction, null);
  return (
    <form action={act} className="row">
      <input name="confirmar" placeholder="Digite APAGAR" aria-label="Confirmação" autoComplete="off" />
      <button className="btn btn-danger" disabled={pendente}>Apagar todos os dados</button>
      <div style={{ flexBasis: '100%' }}><Mensagem estado={estado} /></div>
    </form>
  );
}
