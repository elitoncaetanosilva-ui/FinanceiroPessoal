import { categorize, isPagamentoFaturaNaConta, isPagamentoNaFatura } from './categorize';
import type { NovoLancamento, Regra } from './types';
import { addMonths, descKey, isoFromParts, daysInMonth, norm, r2, toISODate } from './util';

// Formato mínimo (compatível com pluggy-sdk) para manter a função pura e testável.
export interface PAccount {
  id: string;
  type: 'BANK' | 'CREDIT' | string;
  subtype?: string | null;
  name: string;
  marketingName?: string | null;
  balance: number;
  creditData?: { balanceCloseDate?: Date | string | null; balanceDueDate?: Date | string | null; creditLimit?: number | null; availableCreditLimit?: number | null } | null;
}
export interface PTransaction {
  id: string;
  accountId: string;
  date: Date | string;
  description: string;
  descriptionRaw?: string | null;
  type: 'DEBIT' | 'CREDIT' | string;
  amount: number;
  category?: string | null;
  status?: string;
  creditCardMetadata?: {
    installmentNumber?: number;
    totalInstallments?: number;
    totalAmount?: number;
    purchaseDate?: Date | string;
    billId?: string;
  } | null;
}
export interface PBill { id: string; dueDate: Date | string; billClosingDate?: Date | string | null; totalAmount: number; }

export interface ContaCtx {
  account: PAccount;
  apelido: string; // "Itaú Black", "Nubank", "Itaú"...
  bills?: PBill[];
}

export interface MapCtx {
  regras: Pick<Regra, 'padrao' | 'tipo' | 'natureza' | 'subgrupo' | 'origem'>[];
  validos?: Set<string>;
  /** Ignora movimentos anteriores a esta data (o histórico antigo já está na planilha). */
  desde: string;
}

/** Descobre o dia de fechamento/vencimento do cartão pelos dados da conta ou pelas faturas. */
export function diasDoCartao(ctx: ContaCtx) {
  const due = toISODate(ctx.account.creditData?.balanceDueDate ?? ctx.bills?.[0]?.dueDate ?? null);
  const close = toISODate(ctx.account.creditData?.balanceCloseDate ?? ctx.bills?.[0]?.billClosingDate ?? null);
  const dueDay = due ? +due.slice(8, 10) : 10;
  const closeDay = close ? +close.slice(8, 10) : Math.max(1, dueDay - 7 <= 0 ? dueDay + 23 : dueDay - 7);
  return { closeDay, dueDay };
}

/** Vencimento da fatura em que uma compra de data `iso` cai. */
export function vencimentoPorData(iso: string, ctx: ContaCtx) {
  // 1) faturas conhecidas: a primeira que fecha em/depois da compra
  const bills = (ctx.bills ?? [])
    .map(b => ({ close: toISODate(b.billClosingDate ?? null), due: toISODate(b.dueDate)! }))
    .filter(b => b.close)
    .sort((a, b) => a.close!.localeCompare(b.close!));
  const bill = bills.find(b => b.close! >= iso);
  if (bill) return bill.due;
  // 2) regra de dias: fecha no dia closeDay; vence no dueDay seguinte ao fechamento
  const { closeDay, dueDay } = diasDoCartao(ctx);
  const [y, m, d] = iso.split('-').map(Number);
  let cy = y, cm = m;
  if (d > Math.min(closeDay, daysInMonth(y, m))) { cm++; if (cm > 12) { cm = 1; cy++; } }
  let vy = cy, vm = cm;
  if (dueDay <= closeDay) { vm++; if (vm > 12) { vm = 1; vy++; } }
  return isoFromParts(vy, vm, Math.min(dueDay, daysInMonth(vy, vm)));
}

const limpaParcela = (s: string) => s.replace(/\s*(PARC(ELA)?\s*)?\d{1,2}\s*(\/|DE)\s*\d{1,2}\s*$/i, '').trim();

export function chaveCompra(conta: string, dataCompra: string, descricao: string, total: number, valor: number) {
  return `pc:${conta}:${dataCompra}:${descKey(limpaParcela(descricao)).replace(/\s/g, '')}:${total}:${valor.toFixed(2)}`;
}

export interface MapResult {
  lancamentos: NovoLancamento[]; // reais (fonte pluggy) + projeções (fonte projecao)
  ignorados: number;
}

/**
 * Converte transações da Pluggy no modelo da planilha.
 * - Conta (BANK): débito → CASH (despesa); crédito → receita, ou despesa negativa (resgate/estorno).
 *   Pagamento de fatura é marcado como ignorado (as parcelas já estão no CARTÃO).
 * - Cartão (CREDIT): cada parcela vira uma linha com o vencimento da fatura; as parcelas seguintes são projetadas.
 *   Créditos de pagamento da fatura são ignorados; estornos entram como valor negativo.
 */
export function mapTransactions(txs: PTransaction[], conta: ContaCtx, ctx: MapCtx): MapResult {
  const out: NovoLancamento[] = [];
  let ignorados = 0;
  const isCard = conta.account.type === 'CREDIT';
  const billDue = new Map((conta.bills ?? []).map(b => [b.id, toISODate(b.dueDate)!]));

  for (const t of txs) {
    if (t.status && t.status !== 'POSTED') continue;
    const data = toISODate(t.date);
    if (!data) continue;
    const desc = (t.description || t.descriptionRaw || 'Sem descrição').trim();
    const valorAbs = r2(Math.abs(t.amount));
    if (valorAbs === 0) continue;
    const saida = t.type === 'DEBIT' ? true : t.type === 'CREDIT' ? false : t.amount < 0 !== isCard;

    if (!isCard) {
      if (data < ctx.desde) continue;
      const ignorar = saida && isPagamentoFaturaNaConta(desc);
      const cat = categorize({ descricao: desc, origem: 'cash', direcao: saida ? 'saida' : 'entrada', pluggyCategory: t.category }, ctx.regras, ctx.validos);
      const valor = cat.natureza === 'receita' ? valorAbs : saida ? valorAbs : -valorAbs;
      out.push({
        origem: 'cash', natureza: cat.natureza, conta: conta.apelido, data, vencimento: data, descricao: desc, parcela: null, parcelas: null,
        subgrupo: cat.subgrupo, valor, fonte: 'pluggy', external_id: `pt:${t.id}`, revisar: ignorar ? false : cat.revisar, ignorado: ignorar,
        nota: ignorar ? 'Pagamento de fatura (já contado no cartão)' : null,
      });
      if (ignorar) ignorados++;
      continue;
    }

    // Cartão
    if (!saida && isPagamentoNaFatura(desc)) { ignorados++; continue; }
    const md = t.creditCardMetadata ?? {};
    const n = md.totalInstallments && md.totalInstallments > 1 ? md.totalInstallments : 1;
    const k = n > 1 ? Math.min(Math.max(md.installmentNumber ?? 1, 1), n) : 1;
    const compra = toISODate(md.purchaseDate ?? null) ?? data;
    let venc = md.billId ? billDue.get(md.billId) : undefined;
    if (!venc) {
      // Alguns bancos repetem a data da compra em todas as parcelas: desloca k−1 meses.
      venc = k > 1 && compra === data ? addMonths(vencimentoPorData(compra, conta), k - 1) : vencimentoPorData(data, conta);
    }
    if (venc < ctx.desde) continue;
    const cat = categorize({ descricao: desc, origem: 'cartao', direcao: 'saida', pluggyCategory: t.category }, ctx.regras, ctx.validos);
    const valor = saida ? valorAbs : -valorAbs;
    const base = limpaParcela(desc) || desc;
    const chave = n > 1 ? chaveCompra(conta.account.id, compra, desc, n, valorAbs) : null;
    out.push({
      origem: 'cartao', natureza: 'despesa', conta: conta.apelido, data: compra, vencimento: venc, descricao: n > 1 ? base : desc,
      parcela: k, parcelas: n, subgrupo: cat.subgrupo, valor, fonte: 'pluggy',
      external_id: chave ? `${chave}:${k}` : `pt:${t.id}`, revisar: cat.revisar, ignorado: false, nota: null,
    });
    // Projeção das parcelas seguintes (serão substituídas quando a parcela real chegar).
    if (chave && saida) {
      for (let j = k + 1; j <= n; j++) {
        out.push({
          origem: 'cartao', natureza: 'despesa', conta: conta.apelido, data: compra, vencimento: addMonths(venc, j - k), descricao: base,
          parcela: j, parcelas: n, subgrupo: cat.subgrupo, valor, fonte: 'projecao', external_id: `${chave}:${j}`, revisar: cat.revisar, ignorado: false, nota: null,
        });
      }
    }
  }
  // Uma mesma parcela pode aparecer real e projetada no lote: a real vence.
  const porExt = new Map<string, NovoLancamento>();
  for (const l of out) {
    const prev = l.external_id ? porExt.get(l.external_id) : undefined;
    if (!prev || (prev.fonte === 'projecao' && l.fonte !== 'projecao')) porExt.set(l.external_id!, l);
  }
  return { lancamentos: [...porExt.values()], ignorados };
}

/** Nome amigável da conta, no padrão da planilha (aba Apoio). Funciona também com o conector MeuPluggy,
 *  que agrega vários bancos num item só: o banco é deduzido do nome da conta. */
export function apelidoPadrao(conector: string, account: Pick<PAccount, 'type' | 'name' | 'marketingName'>) {
  const txt = norm(`${conector} ${account.marketingName ?? ''} ${account.name}`);
  const nu = /\bNU\b|NUBANK|NU PAGAMENTOS/.test(txt);
  const itau = /ITAU/.test(txt);
  if (account.type === 'CREDIT') {
    if (nu) return 'Nubank';
    if (itau) return 'Itaú Black';
    return `${account.marketingName || account.name}`.trim();
  }
  if (nu) return 'Nubank conta';
  if (itau) return 'Itaú conta';
  return `${account.marketingName || account.name}`.trim();
}
