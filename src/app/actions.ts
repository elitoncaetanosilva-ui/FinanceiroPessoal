'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, criarSessao, senhaConfere } from '@/lib/auth';
import { parsePlanilha } from '@/lib/planilha';
import {
  apagarTudo, atualizarCategoria, atualizarLancamento, excluirLancamento, excluirRegra, importarPlanilha,
  insertLancamentos, reaprenderRegras, salvarOrcamento, setConfig,
} from '@/lib/repo';
import { q } from '@/lib/db';
import { categorize } from '@/lib/categorize';
import { getRegras } from '@/lib/repo';
import type { Natureza, Origem } from '@/lib/types';
import { registrarItem, removerItem, sincronizarItem, sincronizarTudo, type SyncResumo } from '@/lib/sync';
import { r2, toNum } from '@/lib/util';

export type Estado = { ok?: string; erro?: string } | null;

const tudo = () => revalidatePath('/', 'layout');

export async function login(_: Estado, fd: FormData): Promise<Estado> {
  if (!(await senhaConfere(String(fd.get('senha') ?? '')))) return { erro: 'Senha incorreta.' };
  const s = await criarSessao();
  (await cookies()).set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: s.maxAge, path: '/' });
  const de = String(fd.get('de') ?? '/');
  redirect(de.startsWith('/') && !de.startsWith('//') ? de : '/');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function importarPlanilhaAction(_: Estado, fd: FormData): Promise<Estado> {
  const f = fd.get('arquivo');
  if (!(f instanceof File) || !f.size) return { erro: 'Escolha o arquivo .xlsx da planilha.' };
  try {
    const imp = parsePlanilha(await f.arrayBuffer());
    if (!imp.stats.cash && !imp.stats.cartao) return { erro: 'Não encontrei lançamentos nas abas CASH/CARTÃO.' };
    const r = await importarPlanilha(imp);
    tudo();
    return {
      ok: `Importado: ${imp.stats.cash} linhas do CASH, ${imp.stats.cartao} do CARTÃO, ${imp.stats.receitas} entradas e ${imp.stats.orcamentos} valores previstos.` +
        (r.ignorados ? ` ${r.ignorados} linhas já existiam (vindas do banco) e foram mantidas uma vez só.` : '') +
        (imp.avisos.length ? ' ' + imp.avisos.join(' ') : ''),
    };
  } catch (e) {
    return { erro: 'Falha ao ler a planilha: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

export async function categorizarAction(fd: FormData) {
  const id = Number(fd.get('id'));
  const [natureza, ...sub] = String(fd.get('cat') ?? '').split(':');
  if (!id || !sub.length) return;
  await atualizarCategoria(id, natureza as Natureza, sub.join(':'), fd.get('lembrar') === 'on');
  tudo();
}

export async function ignorarAction(fd: FormData) {
  const id = Number(fd.get('id'));
  await atualizarLancamento(id, { ignorado: fd.get('ignorado') === '1', revisar: false });
  tudo();
}

export async function excluirAction(fd: FormData) {
  await excluirLancamento(Number(fd.get('id')));
  tudo();
}

export async function novoLancamentoAction(_: Estado, fd: FormData): Promise<Estado> {
  const origem = String(fd.get('origem')) as Origem;
  const data = String(fd.get('data') ?? '');
  const valorN = toNum(fd.get('valor'));
  const descricao = String(fd.get('descricao') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || valorN == null || !descricao) return { erro: 'Preencha data, descrição e valor.' };
  let [natureza, ...sub] = String(fd.get('cat') ?? '').split(':') as [Natureza, ...string[]];
  let subgrupo = sub.join(':');
  if (!subgrupo) {
    const c = categorize({ descricao, origem, direcao: 'saida' }, await getRegras());
    natureza = c.natureza; subgrupo = c.subgrupo;
  }
  const parcelas = Math.max(1, Math.min(48, Number(fd.get('parcelas') ?? 1) || 1));
  const vencimento = String(fd.get('vencimento') || data);
  const conta = String(fd.get('conta') ?? '') || null;
  const valor = r2(valorN);
  const ls = Array.from({ length: origem === 'cartao' ? parcelas : 1 }, (_, i) => {
    const [y, m, d] = vencimento.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    const venc = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    return {
      origem, natureza, conta: origem === 'cartao' ? conta : null, data, vencimento: origem === 'cartao' ? venc : data, descricao,
      parcela: origem === 'cartao' ? i + 1 : null, parcelas: origem === 'cartao' ? parcelas : null, subgrupo, valor,
      fonte: 'manual' as const, external_id: null, revisar: false, ignorado: false, nota: null,
    };
  });
  await insertLancamentos(ls);
  tudo();
  return { ok: ls.length > 1 ? `${ls.length} parcelas lançadas.` : 'Lançamento incluído.' };
}

export async function orcamentoAction(fd: FormData) {
  const mes = String(fd.get('mes'));
  const [natureza, ...sub] = String(fd.get('cat')).split(':');
  const raw = String(fd.get('valor') ?? '').trim();
  const v = raw === '' ? null : toNum(raw);
  if (!/^\d{4}-\d{2}$/.test(mes)) return;
  await salvarOrcamento(mes, natureza as Natureza, sub.join(':'), v == null ? null : r2(v));
  tudo();
}

/** Copia o previsto de um mês para os seguintes (ou usa o realizado como base). */
export async function copiarPrevistoAction(fd: FormData) {
  const de = String(fd.get('de')), para = String(fd.getAll('para').join(',')).split(',').filter(Boolean);
  if (!/^\d{4}-\d{2}$/.test(de) || !para.length) return;
  for (const m of para) {
    await q('delete from orcamentos where mes = $1', [m]);
    await q('insert into orcamentos (mes, natureza, subgrupo, valor) select $2, natureza, subgrupo, valor from orcamentos where mes = $1', [de, m]);
  }
  tudo();
}

export async function saldoInicialAction(_: Estado, fd: FormData): Promise<Estado> {
  const mes = String(fd.get('mes'));
  const v = toNum(fd.get('valor'));
  if (!/^\d{4}-\d{2}$/.test(mes) || v == null) return { erro: 'Informe mês e valor.' };
  await setConfig('saldo_inicial', { mes, valor: r2(v) });
  tudo();
  return { ok: 'Saldo inicial salvo.' };
}

export async function syncDesdeAction(_: Estado, fd: FormData): Promise<Estado> {
  const d = String(fd.get('desde'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { erro: 'Data inválida.' };
  await setConfig('sync_desde', d);
  tudo();
  return { ok: 'Data de corte salva.' };
}

export async function renomearContaAction(fd: FormData) {
  const id = String(fd.get('id')), apelido = String(fd.get('apelido') ?? '').trim();
  if (!apelido) return;
  const antigo = (await q<{ apelido: string }>('select apelido from contas where id = $1', [id]))[0]?.apelido;
  await q('update contas set apelido = $2 where id = $1', [id, apelido]);
  if (antigo && antigo !== apelido) await q('update lancamentos set conta = $2 where conta = $1 and fonte in ($3, $4)', [antigo, apelido, 'pluggy', 'projecao']);
  tudo();
}

export async function registrarItemAction(itemId: string): Promise<{ ok: boolean; resumo?: SyncResumo; erro?: string }> {
  try {
    await registrarItem(itemId);
    const resumo = await sincronizarItem(itemId);
    tudo();
    return { ok: !resumo.erro, resumo, erro: resumo.erro };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function sincronizarAction(_: Estado): Promise<Estado> {
  try {
    const r = await sincronizarTudo();
    tudo();
    if (!r.length) return { erro: 'Nenhum banco conectado ainda.' };
    const erros = r.filter(x => x.erro);
    const t = (k: keyof SyncResumo) => r.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    return {
      ok: `Sincronizado: ${t('novos')} novos, ${t('atualizados')} atualizados, ${t('conciliados')} conciliados com a planilha, ${t('projetados')} parcelas projetadas.`,
      erro: erros.length ? erros.map(e => `${e.conector}: ${e.erro}`).join(' · ') : undefined,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function removerItemAction(fd: FormData) {
  await removerItem(String(fd.get('item')));
  tudo();
}

export async function excluirRegraAction(fd: FormData) {
  await excluirRegra(Number(fd.get('id')));
  tudo();
}

export async function reaprenderAction() {
  await reaprenderRegras();
  tudo();
}

export async function apagarTudoAction(_: Estado, fd: FormData): Promise<Estado> {
  if (String(fd.get('confirmar')).trim().toUpperCase() !== 'APAGAR') return { erro: 'Digite APAGAR para confirmar.' };
  await apagarTudo();
  tudo();
  return { ok: 'Todos os dados foram apagados.' };
}
