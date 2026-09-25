import { descKey, norm } from './util';
import { SUB_NAO_IDENTIFICADA, SUB_RECEITA_OUTROS } from './taxonomy';
import type { Natureza, Origem, Regra } from './types';

type Pairs = [string, string][];
const pairs = (list: [string[], string][]): Pairs => list.flatMap(([kws, sub]) => kws.map(k => [k, sub] as [string, string]));

// Dicionários herdados do conciliador (ordem = prioridade), ampliados com comércios comuns.
export const CARD_RULES = pairs([
  [['PANVEL', 'DROGA', 'FARMAC', 'RAIA', 'PAGUE MENOS'], 'Medicamentos'],
  [['ZAFFARI', 'ANDREAZZ', 'SUPERMERCAD', 'TIMY ALIMENTOS', 'COMERCIO DE ALIMEN', 'ATACAD', 'SAMS ', 'CARREFOUR', 'ASSAI', 'BISTEK', 'MERCADO'], 'Mercado / Limpeza'],
  [['IFOOD', 'RESTAURANTE', 'LANCHONETE', 'BURGER', 'PIZZA', 'MC DONALDS', 'MCDONALDS', 'OUTBACK', 'CAFE', 'PADARIA', 'SORVET'], 'Lanches / Delivery'],
  [['NETFLIX', 'SPOTIFY', 'PRIME VIDEO', 'AMAZON PRIME', 'DISNEY', 'HBO', 'MAX.COM', 'GLOBOPLAY', 'YOUTUBE', 'DEEZER', 'APPLE.COM', 'GOOGLE ONE', 'ACADEMIA', 'SMARTFIT', 'SMART FIT', 'TOTALPASS', 'WELLHUB', 'GYMPASS'], 'Assinaturas / Streaming'],
  [['UBER', '99 APP', '99APP', '99 TAXI', 'CABIFY', 'TAXI'], 'Aplicativo / Táxi'],
  [['SEM PARAR', 'CONECTCAR', 'VELOE', 'ESTACION', 'PEDAGIO', 'ESTAPAR'], 'Pedágio / Tag / Estacionamento'],
  [['INST EDUC', 'ESCOLA', 'COLEGIO'], 'Escola'],
  [['HOTELARIA', 'HOTEL', 'POUSADA', 'AIRBNB', 'BOOKING', 'LATAM', 'GOL LINHAS', 'AZUL LINHAS', 'SHOPPING'], 'Passeios'],
  [['NICK KIDS', 'KIDS', 'INFANTIL'], 'Roupas infantis'],
  [['RENNER', 'RIACHUELO', 'CEA MODAS', 'C&A', 'SHEIN', 'ZARA', 'HERING', 'MODA', 'CALCADO', 'MALHAS', 'NETSHOES', 'CENTAURO'], 'Roupas'],
  [['POSTO', 'SHELL', 'IPIRANGA', 'PETROBRAS', 'COMBUST'], 'Combustível'],
  [['CINEMA', 'CINEMARK', 'CINESYSTEM', 'TEATRO'], 'Cinema / Teatro'],
  [['VETERIN'], 'Veterinário / Vacinas'],
  [['PETSHOP', 'PET SHOP', 'PETZ', 'COBASI'], 'Ração / Alimentação'],
  [['ODONTO', 'DENTIST'], 'Odontologia'],
  [['LABORAT', 'CLINICA', 'HOSPITAL', 'EXAME'], 'Consultas / Exames'],
  [['AZUL SEGUROS', 'PORTO SEGURO', 'SEGURO'], 'Seguro'],
  [['MECANICA', 'AUTO CENTER', 'PNEU'], 'Mecânica / Manutenção'],
  [['LAVAGEM', 'LAVA CAR', 'LAVACAR', 'ESTETICA AUTO'], 'Lavagem / Estética'],
  [['INGRESSO', 'SYMPLA', 'EVENTIM', 'TICKET'], 'Eventos / Shows'],
  [['MAGAZINE', 'MAGALU', 'CASAS BAHIA', 'PONTO FRIO', 'FAST SHOP', 'KABUM', 'MERCADOLIVRE', 'MERCADO LIVRE', 'AMAZON'], 'Móveis / Eletro / Eletrônicos'],
  [['LEROY', 'TUMELERO', 'TELHA NORTE', 'FERRAGEM', 'CONSTRU'], 'Manutenção residencial'],
  [['TOK STOK', 'TOKSTOK', 'CAMICADO', 'ETNA'], 'Decoração'],
  [['CLARO', 'VIVO', 'TIM '], 'Celular'],
  [['ANUIDADE', 'IOF', 'ENCARGO', 'JUROS'], 'Tarifas / Encargos'],
]);

export const CASH_RULES = pairs([
  [['IOF', 'TARIFA', 'ANUIDADE', 'CESTA', 'JUROS', 'ENCARGO'], 'Tarifas / Encargos'],
  [['CLARO', 'VIVO', 'TIM '], 'Celular'],
  [['RGE', 'CEEE', 'ENERGIA', 'CPFL', 'ENEL'], 'Energia elétrica'],
  [['SERRA DIESE', 'POSTO'], 'Combustível'],
  [['IMOVEIS', 'IMOBILIARIA', 'TOMASI', 'ALUGUEL'], 'Aluguel'],
  [['CONDOMINIO'], 'Condomínio'],
  [['IGREJA', 'OBRA MISSION', 'DIZIMO'], 'Presentes / Doações'],
  [['INTERNET', 'FIBRA'], 'Internet'],
  [['DETRAN', 'IPVA', 'LICENCIAMENTO'], 'IPVA / Documentação'],
  [['FINANCIAMENTO', 'FINANC VEIC', 'CDC'], 'Parcela de veículo'],
  [['EMPRESTIMO', 'CONSIGNADO'], 'Parcela de empréstimo'],
  [['DARF', 'DAS ', 'SIMPLES NAC', 'IPTU', 'GPS '], 'Impostos / Taxas'],
  [['APLICACAO', 'APLIC ', 'CDB', 'POUPANCA', 'INVEST'], 'Aporte'],
]);

// Entradas: receitas do CAIXA MENSAL.
export const INCOME_RULES = pairs([
  [['SALARIO', 'PROVENTOS', 'FOLHA PAGAMENTO', 'FOLHA DE PAGAMENTO', 'REMUNERACAO', 'PAGTO SALARIO'], 'Salário'],
  [['DECIMO TERCEIRO', '13 SALARIO', '13O SALARIO'], '13º Salário'],
  [['FERIAS'], 'Férias'],
  [['RESCISAO'], 'Rescisão'],
  [['PREMIO', 'PLR', 'BONUS'], 'Prêmio'],
  [['V4 ', 'V4COMPANY', 'V4 COMPANY'], 'V4 Company'],
  [['CONTABIL', 'CONTABILIDADE'], 'Serviço Contábil'],
  [['EMPRESTIMO', 'CREDITO PESSOAL'], 'Empréstimo'],
]);

// Créditos na conta que não são receita: voltam como "despesa negativa" (convenção da planilha).
const CASH_CREDIT_AS_EXPENSE = pairs([
  [['RESGATE', 'RESG '], 'Resgate'],
  [['REND PAGO', 'RENDIMENTO'], 'Rendimento'],
  [['ESTORNO', 'DEVOLUCAO', 'REEMBOLSO', 'CASHBACK'], SUB_NAO_IDENTIFICADA],
]);

/** Pagamento de fatura na conta — ignorado porque as parcelas já estão na aba CARTÃO. */
export function isPagamentoFaturaNaConta(desc: string) {
  const d = norm(desc);
  if (d.includes('FATURA') && ['MC BLA', 'UNICLASS', 'MASTER', 'CARTAO', 'VISA', 'ITAU', 'NU ', 'NUBANK', 'PAG'].some(x => d.includes(x))) return true;
  return /PAGAMENTO (DE )?CARTAO|PAG(TO)? CARTAO|NU PAGAMENTOS|PAGAMENTO NUBANK|ITAUCARD|PAGTO FATURA/.test(d);
}

/** Crédito lançado na fatura que é o pagamento da fatura anterior. */
export function isPagamentoNaFatura(desc: string) {
  const d = norm(desc);
  return /PAGAMENTO|PAGTO|PAG FATURA|PAGAMENTO RECEBIDO|PAGAMENTO EFETUADO|DEBITO AUTOMATICO/.test(d);
}

function matchPairs(desc: string, list: Pairs) {
  const d = ' ' + norm(desc) + ' ';
  for (const [kw, sub] of list) if (d.includes(kw)) return sub;
  return null;
}

/**
 * Categorias da Pluggy (em inglês, podem vir traduzidas) → subgrupo da planilha.
 * A ordem importa: termos mais específicos primeiro.
 */
const PLUGGY_MAP: Pairs = pairs([
  [['PHARMAC', 'DRUGSTORE', 'FARMACIA'], 'Medicamentos'],
  [['DENT'], 'Odontologia'],
  [['HOSPITAL', 'CLINIC', 'LAB', 'HEALTH', 'SAUDE'], 'Consultas / Exames'],
  [['HEALTH INSURANCE', 'PLANO DE SAUDE'], 'Plano de saúde'],
  [['GROCER', 'SUPERMARKET', 'SUPERMERCADO', 'MERCADO'], 'Mercado / Limpeza'],
  [['FOOD DELIVERY', 'RESTAURANT', 'EATING OUT', 'DELIVERY', 'RESTAURANTE', 'LANCHE'], 'Lanches / Delivery'],
  [['GAS STATION', 'FUEL', 'COMBUST', 'POSTO'], 'Combustível'],
  [['TAXI', 'RIDE', 'TRANSPORTE POR APLICATIVO'], 'Aplicativo / Táxi'],
  [['PARKING', 'TOLL', 'ESTACIONAMENTO', 'PEDAGIO'], 'Pedágio / Tag / Estacionamento'],
  [['VEHICLE INSURANCE', 'INSURANCE', 'SEGURO'], 'Seguro'],
  [['VEHICLE MAINTENANCE', 'MANUTENCAO VEICULAR', 'AUTO'], 'Mecânica / Manutenção'],
  [['VEHICLE TAX', 'IPVA'], 'IPVA / Documentação'],
  [['RENT', 'ALUGUEL'], 'Aluguel'],
  [['ELECTRICITY', 'ENERGIA', 'UTILITIES'], 'Energia elétrica'],
  [['INTERNET'], 'Internet'],
  [['MOBILE', 'TELEPHONE', 'CELULAR', 'TELEFONE'], 'Celular'],
  [['STREAMING', 'SUBSCRIPTION', 'ASSINATURA', 'GYM', 'ACADEMIA', 'SPORT'], 'Assinaturas / Streaming'],
  [['CINEMA', 'THEATER', 'TEATRO'], 'Cinema / Teatro'],
  [['TICKET', 'EVENT', 'SHOW', 'INGRESSO'], 'Eventos / Shows'],
  [['TRAVEL', 'ACCOMMODATION', 'AIRLINE', 'HOTEL', 'VIAGE', 'LEISURE', 'LAZER', 'ENTERTAINMENT'], 'Passeios'],
  [['CLOTH', 'ROUPA', 'VESTUARIO', 'SHOE', 'CALCADO'], 'Roupas'],
  [['PET'], 'Ração / Alimentação'],
  [['EDUCATION', 'SCHOOL', 'EDUCACAO', 'ESCOLA', 'COURSE'], 'Escola'],
  [['ELECTRONIC', 'ELETRONIC', 'HOUSEWARE', 'FURNITURE', 'ELETRO', 'MOVEIS', 'ONLINE SHOPPING', 'SHOPPING'], 'Móveis / Eletro / Eletrônicos'],
  [['HOME', 'HOUSING', 'MORADIA', 'CONSTRUCTION'], 'Manutenção residencial'],
  [['DONATION', 'GIFT', 'DOACAO', 'PRESENTE'], 'Presentes / Doações'],
  [['TAX', 'IMPOSTO', 'TRIBUT'], 'Impostos / Taxas'],
  [['BANK FEE', 'INTEREST', 'TARIFA', 'JUROS', 'IOF', 'FEE'], 'Tarifas / Encargos'],
  [['LOAN', 'EMPRESTIMO', 'FINANCING', 'FINANCIAMENTO'], 'Parcela de empréstimo'],
  [['INVESTMENT', 'INVESTIMENTO', 'SAVING'], 'Aporte'],
  [['SAME OWNERSHIP', 'MESMA TITULARIDADE'], 'Transferência entre contas'],
]);

export function mapPluggyCategory(category: string | null | undefined) {
  if (!category) return null;
  return matchPairs(category, PLUGGY_MAP);
}

// ---------- Regras aprendidas ----------

export interface HistItem { descricao: string; natureza: Natureza; subgrupo: string; }

const DESC_GENERICAS = new Set(['', 'DIVERSOS', 'PIX', 'PIX TRANSF', 'TRANSFERENCIA', 'COMPRA', 'PAGAMENTO', 'DESPESA SEM DESCRICAO']);

/**
 * Aprende regras "descrição normalizada → subgrupo" a partir do histórico
 * (a planilha tem ~1.000 lançamentos já classificados à mão).
 * Só grava quando um subgrupo domina (≥ 60% das ocorrências).
 */
export function learnRules(hist: HistItem[]): Omit<Regra, 'id'>[] {
  const counts = new Map<string, Map<string, number>>();
  for (const h of hist) {
    if (!h.subgrupo || h.subgrupo === SUB_NAO_IDENTIFICADA) continue;
    const k = descKey(h.descricao);
    if (DESC_GENERICAS.has(k) || k.length < 3) continue;
    const key = h.natureza + '|' + k;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(h.subgrupo, (m.get(h.subgrupo) ?? 0) + 1);
    counts.set(key, m);
  }
  const out: Omit<Regra, 'id'>[] = [];
  for (const [key, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / total < 0.6) continue;
    const [natureza, padrao] = key.split('|') as [Natureza, string];
    out.push({ padrao, tipo: 'exata', natureza, subgrupo: best, origem: 'aprendida' });
  }
  return out;
}

export interface CatInput {
  descricao: string;
  origem: Origem;
  /** direção do dinheiro na conta/cartão */
  direcao: 'saida' | 'entrada';
  pluggyCategory?: string | null;
}

export interface CatResult {
  natureza: Natureza;
  subgrupo: string;
  revisar: boolean;
  motivo: 'regra' | 'dicionario' | 'pluggy' | 'padrao';
}

/**
 * Categoriza um movimento. Prioridade: regras do usuário → regras aprendidas →
 * dicionário de palavras-chave → categoria da Pluggy → "não identificada" (fica para revisão).
 */
export function categorize(input: CatInput, regras: Pick<Regra, 'padrao' | 'tipo' | 'natureza' | 'subgrupo' | 'origem'>[], validos?: Set<string>): CatResult {
  const ok = (nat: Natureza, sub: string | null): sub is string => !!sub && (!validos || validos.has(`${nat}:${sub}`));
  const d = norm(input.descricao);
  const k = descKey(input.descricao);

  // Entradas na conta: receita, salvo resgates/estornos (despesa negativa, como na planilha).
  if (input.origem === 'cash' && input.direcao === 'entrada') {
    const credito = matchPairs(d, CASH_CREDIT_AS_EXPENSE);
    if (ok('despesa', credito)) return { natureza: 'despesa', subgrupo: credito, revisar: credito === SUB_NAO_IDENTIFICADA, motivo: 'dicionario' };
  }
  const natureza: Natureza = input.origem === 'cash' && input.direcao === 'entrada' ? 'receita' : 'despesa';

  const doUsuario = regras.filter(r => r.natureza === natureza && r.origem === 'usuario');
  const aprendidas = regras.filter(r => r.natureza === natureza && r.origem === 'aprendida');
  for (const lista of [doUsuario, aprendidas]) {
    for (const r of lista) {
      const hit = r.tipo === 'exata' ? r.padrao === k : d.includes(norm(r.padrao));
      if (hit && ok(natureza, r.subgrupo)) return { natureza, subgrupo: r.subgrupo, revisar: false, motivo: 'regra' };
    }
  }

  if (natureza === 'receita') {
    const sub = matchPairs(d, INCOME_RULES);
    if (ok('receita', sub)) return { natureza, subgrupo: sub, revisar: false, motivo: 'dicionario' };
    return { natureza, subgrupo: SUB_RECEITA_OUTROS, revisar: true, motivo: 'padrao' };
  }

  const dict = matchPairs(d, input.origem === 'cartao' ? CARD_RULES : [...CASH_RULES, ...CARD_RULES]);
  if (ok('despesa', dict)) return { natureza, subgrupo: dict, revisar: false, motivo: 'dicionario' };

  const pl = mapPluggyCategory(input.pluggyCategory);
  if (ok('despesa', pl)) return { natureza, subgrupo: pl, revisar: false, motivo: 'pluggy' };

  return { natureza, subgrupo: SUB_NAO_IDENTIFICADA, revisar: true, motivo: 'padrao' };
}
