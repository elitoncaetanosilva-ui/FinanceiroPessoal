import 'server-only';
import { PluggyClient } from 'pluggy-sdk';
import { q } from './db';
import { getCategorias, getConfig, getLancamentos, getRegras, insertLancamentos } from './repo';
import { apelidoPadrao, mapTransactions, type ContaCtx, type PAccount, type PBill } from './pluggy-map';
import { reconciliar } from './reconcile';
import { catKey } from './taxonomy';
import type { NovoLancamento } from './types';
import { addMonths, monthStart, todayISO, toISODate } from './util';

export function pluggyConfigurado() {
  return !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

let client: PluggyClient | null = null;
export function pluggy() {
  if (!pluggyConfigurado()) throw new Error('Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.');
  client ??= new PluggyClient({ clientId: process.env.PLUGGY_CLIENT_ID!, clientSecret: process.env.PLUGGY_CLIENT_SECRET! });
  return client;
}

/** Data a partir da qual o banco alimenta o app (antes disso vale a planilha). */
export async function getSyncDesde() {
  return getConfig<string>('sync_desde', monthStart(todayISO()));
}

export async function registrarItem(itemId: string) {
  const item = await pluggy().fetchItem(itemId);
  await q(
    `insert into pluggy_items (item_id, conector, status, erro) values ($1, $2, $3, $4)
     on conflict (item_id) do update set conector = excluded.conector, status = excluded.status, erro = excluded.erro`,
    [item.id, item.connector?.name ?? 'Banco', item.status, item.error?.message ?? null],
  );
  return item;
}

export interface SyncResumo { itemId: string; conector: string; novos: number; atualizados: number; conciliados: number; projetados: number; ignorados: number; erro?: string; }

export async function sincronizarItem(itemId: string): Promise<SyncResumo> {
  const api = pluggy();
  const resumo: SyncResumo = { itemId, conector: '', novos: 0, atualizados: 0, conciliados: 0, projetados: 0, ignorados: 0 };
  try {
    const item = await api.fetchItem(itemId);
    resumo.conector = item.connector?.name ?? 'Banco';
    const desde = await getSyncDesde();
    const [regras, categorias] = await Promise.all([getRegras(), getCategorias()]);
    const validos = new Set(categorias.map(c => catKey(c.natureza, c.subgrupo)));
    const apelidosSalvos = new Map((await q<{ id: string; apelido: string }>('select id, apelido from contas')).map(r => [r.id, r.apelido]));

    const contas = (await api.fetchAccounts(itemId)).results;
    const entrantes: NovoLancamento[] = [];
    for (const acc of contas) {
      const apelido = apelidosSalvos.get(acc.id) ?? apelidoPadrao(resumo.conector, acc);
      let bills: PBill[] = [];
      if (acc.type === 'CREDIT') {
        try { bills = (await api.fetchCreditCardBills(acc.id)).results; } catch { bills = []; }
      }
      const cd = acc.creditData;
      await q(
        `insert into contas (id, item_id, tipo, subtipo, nome, apelido, saldo, limite, limite_disponivel, fechamento, vencimento, atualizado_em)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         on conflict (id) do update set tipo = excluded.tipo, subtipo = excluded.subtipo, nome = excluded.nome, saldo = excluded.saldo,
           limite = excluded.limite, limite_disponivel = excluded.limite_disponivel, fechamento = excluded.fechamento,
           vencimento = excluded.vencimento, atualizado_em = now()`,
        [acc.id, itemId, acc.type, acc.subtype, acc.marketingName || acc.name, apelido, acc.balance, cd?.creditLimit ?? null,
          cd?.availableCreditLimit ?? null, toISODate(cd?.balanceCloseDate ?? null), toISODate(cd?.balanceDueDate ?? null)],
      );
      // Cartão: busca um pouco antes do corte, porque compras antigas vencem depois dele.
      const dateFrom = acc.type === 'CREDIT' ? addMonths(desde, -13) : desde;
      const txs = await api.fetchAllTransactions(acc.id, { dateFrom });
      const ctx: ContaCtx = { account: acc as unknown as PAccount, apelido, bills: bills as unknown as PBill[] };
      const r = mapTransactions(txs as never, ctx, { regras, validos, desde });
      resumo.ignorados += r.ignorados;
      entrantes.push(...r.lancamentos);
    }

    const r = await persistirEntrantes(entrantes, desde);
    Object.assign(resumo, r);

    await q(`update pluggy_items set status = $2, erro = $3, ultimo_sync = now(), conector = $4 where item_id = $1`,
      [itemId, item.status, item.error?.message ?? null, resumo.conector]);
  } catch (e) {
    resumo.erro = e instanceof Error ? e.message : String(e);
    await q(`update pluggy_items set erro = $2 where item_id = $1`, [itemId, resumo.erro]);
  }
  await q(`insert into sync_log (item_id, novos, atualizados, conciliados, projetados, erro) values ($1,$2,$3,$4,$5,$6)`,
    [itemId, resumo.novos, resumo.atualizados, resumo.conciliados, resumo.projetados, resumo.erro ?? null]);
  return resumo;
}

/** Grava o que veio do banco: atualiza pelo external_id, concilia com a planilha ou insere. */
export async function persistirEntrantes(entrantes: NovoLancamento[], desde: string) {
  const r = { novos: 0, atualizados: 0, conciliados: 0, projetados: 0 };
  const existentes = await getLancamentos({ de: addMonths(desde, -1) });
  const rec = reconciliar(entrantes, existentes, { modo: 'pluggy' });

  for (const u of rec.atualizar) {
    const e = u.existente, x = u.entrante;
    // Projeção não sobrescreve dado real; dado real substitui a projeção.
    if (x.fonte === 'projecao' && e.fonte !== 'projecao') continue;
    await q(
      `update lancamentos set fonte = $2, vencimento = $3, valor = $4, descricao = $5, data = $6,
         subgrupo = case when subgrupo_manual then subgrupo else $7 end,
         revisar = case when subgrupo_manual then revisar else $8 end
       where id = $1`,
      [u.id, x.fonte, x.vencimento, x.valor, x.descricao, x.data, x.subgrupo, x.revisar],
    );
    r.atualizados++;
  }
  for (const v of rec.vincular) {
    // Casou com uma linha da planilha/manual: mantém a categoria escolhida e passa a acompanhar o banco.
    await q(`update lancamentos set external_id = $2, fonte = case when $3 = 'projecao' then fonte else 'pluggy' end, conta = coalesce(conta, $4) where id = $1`,
      [v.id, v.entrante.external_id, v.entrante.fonte, v.entrante.conta]);
    r.conciliados++;
  }
  await insertLancamentos(rec.novos);
  r.novos = rec.novos.filter(n => n.fonte !== 'projecao').length;
  r.projetados = rec.novos.length - r.novos;
  return r;
}

export async function sincronizarTudo(opts: { atualizarNoBanco?: boolean } = {}) {
  const items = await q<{ item_id: string }>('select item_id from pluggy_items');
  const out: SyncResumo[] = [];
  for (const { item_id } of items) {
    // Pede à Pluggy uma nova coleta (conexões Open Finance também atualizam sozinhas).
    if (opts.atualizarNoBanco) {
      try { await pluggy().updateItem(item_id); } catch { /* segue com os dados já coletados */ }
    }
    out.push(await sincronizarItem(item_id));
  }
  return out;
}

export async function removerItem(itemId: string) {
  try { await pluggy().deleteItem(itemId); } catch { /* item já removido na Pluggy */ }
  await q('delete from contas where item_id = $1', [itemId]);
  await q('delete from pluggy_items where item_id = $1', [itemId]);
}
