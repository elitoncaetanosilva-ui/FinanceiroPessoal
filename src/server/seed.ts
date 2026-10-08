/**
 * Dados iniciais de cada usuário: instituições, árvore de categorias (seção 7 do escopo)
 * com a natureza econômica de cada subcategoria, categorias de sistema e regras de classificação.
 * Idempotente: pode rodar várias vezes.
 */
import type { Q } from './db';

type Nature = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'INVESTMENT' | 'FINANCING' | 'ADJUSTMENT';
type Sub = string | { name: string; nature?: Nature; financial?: boolean; system?: string; hidden?: boolean };
interface Cat { name: string; section: 'IN' | 'OUT'; nature: Nature; subs: Sub[]; hidden?: boolean }

export const CATEGORY_TREE: Cat[] = [
  // ------------------------------ ENTRADAS
  { name: 'CLT', section: 'IN', nature: 'INCOME', subs: ['Salário', '13º Salário', 'Férias', 'Rescisão', 'Prêmio'] },
  { name: 'Extras', section: 'IN', nature: 'INCOME', subs: ['Serviço Contábil', 'V4 Company'] },
  {
    name: 'Bancário', section: 'IN', nature: 'FINANCING', subs: [
      { name: 'Empréstimo', nature: 'FINANCING' },
      { name: 'Resgate', nature: 'INVESTMENT' },
    ],
  },
  { name: 'Outras Receitas', section: 'IN', nature: 'INCOME', subs: ['Outros'] },
  // ------------------------------ SAÍDAS
  { name: 'Moradia', section: 'OUT', nature: 'EXPENSE', subs: ['Aluguel', 'Condomínio', 'Energia elétrica', 'Manutenção residencial', 'Móveis / Eletro / Eletrônicos', 'Decoração'] },
  { name: 'Alimentação', section: 'OUT', nature: 'EXPENSE', subs: ['Mercado / Limpeza', 'Lanches / Delivery'] },
  { name: 'Vestuário', section: 'OUT', nature: 'EXPENSE', subs: ['Roupas', 'Roupas infantis', 'Acessórios'] },
  { name: 'Transporte', section: 'OUT', nature: 'EXPENSE', subs: ['Combustível', 'IPVA / Documentação', 'Seguro', 'Mecânica / Manutenção', 'Lavagem / Estética', 'Pedágio / Tag / Estacionamento', 'Aplicativo / Táxi'] },
  { name: 'Educação', section: 'OUT', nature: 'EXPENSE', subs: ['Escola', 'Atividades Extras'] },
  { name: 'Saúde / Médico', section: 'OUT', nature: 'EXPENSE', subs: ['Medicamentos', 'Plano de saúde', 'Consultas / Exames', 'Odontologia'] },
  { name: 'Comunicação', section: 'OUT', nature: 'EXPENSE', subs: ['Celular', 'Internet'] },
  { name: 'Lazer', section: 'OUT', nature: 'EXPENSE', subs: ['Assinaturas / Streaming', 'Cinema / Teatro', 'Eventos / Shows', 'Passeios'] },
  { name: 'Pet', section: 'OUT', nature: 'EXPENSE', subs: ['Ração / Alimentação', 'Banho / Tosa', 'Veterinário / Vacinas'] },
  { name: 'Tâmilly', section: 'OUT', nature: 'EXPENSE', subs: ['Despesas Cartão'] },
  {
    name: 'Poupança', section: 'OUT', nature: 'INVESTMENT', subs: [
      { name: 'Aporte', nature: 'INVESTMENT', system: 'INVESTMENT_IN' },
      { name: 'Resgate', nature: 'INVESTMENT', system: 'INVESTMENT_OUT' },
      { name: 'Rendimento', nature: 'INCOME', financial: true },
      { name: 'Transferência entre contas', nature: 'TRANSFER', system: 'TRANSFER' },
    ],
  },
  { name: 'Outros', section: 'OUT', nature: 'EXPENSE', subs: ['Presentes / Doações', 'Impostos / Taxas', { name: 'Despesa não identificada' }] },
  { name: 'Despesas Bancárias', section: 'OUT', nature: 'EXPENSE', subs: ['Tarifas / Encargos'] },
  { name: 'Financiamentos', section: 'OUT', nature: 'FINANCING', subs: [{ name: 'Parcela de veículo', nature: 'FINANCING' }, { name: 'Parcela de empréstimo', nature: 'FINANCING' }] },
  { name: 'Ajuste de Saldo', section: 'OUT', nature: 'ADJUSTMENT', subs: [{ name: 'Correção manual', nature: 'ADJUSTMENT', system: 'ADJUSTMENT' }] },
  // ------------------------------ SISTEMA (oculta dos seletores e do orçamento)
  { name: 'Movimentações internas', section: 'OUT', nature: 'TRANSFER', hidden: true, subs: [{ name: 'Pagamento de fatura', nature: 'TRANSFER', system: 'CARD_PAYMENT', hidden: true }] },
];

export const INSTITUTIONS: [string, string | null][] = [
  ['Itaú', '341'], ['Nubank', '260'], ['Sicredi', '748'], ['Mercado Pago', '323'], ['Caixa', '104'],
  ['Banco do Brasil', '001'], ['Bradesco', '237'], ['Santander', '033'], ['Inter', '077'], ['C6 Bank', '336'],
  ['PicPay', '380'], ['Dinheiro', null], ['Outra', null],
];

/** [padrões, 'Categoria/Subcategoria', direção, prioridade] — dicionário herdado do conciliador e ampliado. */
export const SYSTEM_RULES: [string[], string, 'IN' | 'OUT', number][] = [
  [['PANVEL', 'DROGA', 'FARMAC', 'DROGARIA'], 'Saúde / Médico/Medicamentos', 'OUT', 20],
  [['ZAFFARI', 'ANDREAZZ', 'SUPERMERCAD', 'TIMY ALIMENTOS', 'COMERCIO DE ALIMEN', 'ATACAD', 'SAMS CLUB', 'CARREFOUR', 'ASSAI', 'BIG '], 'Alimentação/Mercado / Limpeza', 'OUT', 15],
  [['RESTAURANTE', 'LANCHONETE', 'BURGER', 'IFOOD', 'PIZZA', 'PADARIA'], 'Alimentação/Lanches / Delivery', 'OUT', 10],
  [['INST EDUC', 'ESCOLA', 'COLEGIO'], 'Educação/Escola', 'OUT', 15],
  [['HOTELARIA', 'HOTEL', 'POUSADA'], 'Lazer/Passeios', 'OUT', 10],
  [['NICK KIDS'], 'Vestuário/Roupas infantis', 'OUT', 30],
  [['RENNER', 'RIACHUELO', 'CEA MODAS', 'C&A', 'SHEIN', 'MODA', 'CALCADO', 'MALHAS', 'SAPATOS'], 'Vestuário/Roupas', 'OUT', 10],
  [['POSTO ', 'SHELL', 'IPIRANGA', 'SERRA DIESE', 'PETROBRAS', 'COMBUSTIVE'], 'Transporte/Combustível', 'OUT', 15],
  [['CINEMA', 'CINEMARK', 'INGRESSO.COM'], 'Lazer/Cinema / Teatro', 'OUT', 20],
  [['VETERIN'], 'Pet/Veterinário / Vacinas', 'OUT', 20],
  [['PETSHOP', 'PET SHOP', 'PETZ', 'COBASI'], 'Pet/Ração / Alimentação', 'OUT', 20],
  [['ODONTO', 'DENTIST'], 'Saúde / Médico/Odontologia', 'OUT', 25],
  [['AZUL SEGUROS', 'PORTO SEGURO AUTO'], 'Transporte/Seguro', 'OUT', 20],
  [['MECANICA', 'AUTO PECAS', 'AUTOPECAS'], 'Transporte/Mecânica / Manutenção', 'OUT', 15],
  [['INGRESSO', 'SYMPLA', 'EVENTIM'], 'Lazer/Eventos / Shows', 'OUT', 10],
  [['IOF', 'TARIFA', 'ANUIDADE', 'TAR PACOTE', 'JUROS', 'ENCARGOS'], 'Despesas Bancárias/Tarifas / Encargos', 'OUT', 20],
  [['CLARO', 'VIVO ', 'TIM CELULAR', 'OI CELULAR'], 'Comunicação/Celular', 'OUT', 15],
  [['RGE', 'CEEE', 'ENERGIA'], 'Moradia/Energia elétrica', 'OUT', 15],
  [['IMOVEIS', 'IMOBILIARIA', 'ALUGUEL'], 'Moradia/Aluguel', 'OUT', 15],
  [['CONDOMINIO'], 'Moradia/Condomínio', 'OUT', 20],
  [['IGREJA', 'OBRA MISSION', 'DIZIMO'], 'Outros/Presentes / Doações', 'OUT', 15],
  [['INTERNET', 'FIBRA', 'NET VIRTUA'], 'Comunicação/Internet', 'OUT', 15],
  [['UBER', '99APP', '99 TAXI', '99POP', 'TAXI'], 'Transporte/Aplicativo / Táxi', 'OUT', 15],
  [['NETFLIX', 'SPOTIFY', 'AMAZON PRIME', 'PRIMEVIDEO', 'DISNEY', 'HBO', 'MAX.COM', 'GLOBOPLAY', 'YOUTUBE PREMIUM', 'DEEZER', 'PARAMOUNT'], 'Lazer/Assinaturas / Streaming', 'OUT', 20],
  [['DETRAN', 'IPVA', 'SEFAZ', 'LICENCIAMENTO'], 'Transporte/IPVA / Documentação', 'OUT', 20],
  [['TAGITAU', 'SEM PARAR', 'CONECTCAR', 'VELOE', 'PARKING', 'ESTACIONAMENTO', 'PEDAGIO'], 'Transporte/Pedágio / Tag / Estacionamento', 'OUT', 20],
  [['LAVACAR', 'LAVAGEM', 'LAVA JATO', 'LAVAJATO'], 'Transporte/Lavagem / Estética', 'OUT', 20],
  [['RECEITA FED', 'DARF', 'PREFEITURA'], 'Outros/Impostos / Taxas', 'OUT', 15],
  [['UNIMED', 'PLANO DE SAUDE', 'AMIL', 'HAPVIDA'], 'Saúde / Médico/Plano de saúde', 'OUT', 20],
  [['LABORATORIO', 'EXAMES'], 'Saúde / Médico/Consultas / Exames', 'OUT', 10],
  // Entradas: só padrões inequívocos. TED/PIX recebidos genéricos vão para Pendentes.
  [['RENDIMENTO', 'REND PAGO', 'JUROS POUPANCA'], 'Poupança/Rendimento', 'IN', 20],
  [['RESGATE'], 'Poupança/Resgate', 'IN', 15],
  [['SALARIO', 'PROVENTOS', 'FOLHA PAGAMENTO'], 'CLT/Salário', 'IN', 15],
];

/** Padrões genéricos de pagamento de fatura no extrato (cada cartão também tem os seus). */
export const CARD_PAYMENT_ACCOUNT_PATTERNS = ['FATURA', 'NU PAGAMENT', 'PAG FATURA', 'PAGTO CARTAO', 'PAGAMENTO CARTAO', 'PGTO FATURA'];
/** Linhas de crédito de pagamento dentro de arquivos de fatura. */
export const CARD_PAYMENT_CARD_PATTERNS = ['PAGAMENTO DEBITO AUTOMATICO', 'PAGAMENTO RECEBIDO', 'PAGAMENTO EFETUADO', 'PAGAMENTO DE FATURA', 'PAGTO DEBITO', 'PAGAMENTO FATURA'];

export async function seedUserDefaults(q: Q, userId: string) {
  for (const [name, code] of INSTITUTIONS) {
    await q.query('insert into institutions(user_id, name, code) values ($1,$2,$3) on conflict (user_id, name) do nothing', [userId, name, code]);
  }

  const idByPath = new Map<string, string>();
  let order = 0;
  for (const cat of CATEGORY_TREE) {
    order += 10;
    const parent = await upsertCategory(q, userId, null, cat.name, cat.nature, cat.section, order, { hidden: cat.hidden });
    let subOrder = 0;
    for (const s of cat.subs) {
      const sub = typeof s === 'string' ? { name: s } : s;
      subOrder += 1;
      const id = await upsertCategory(q, userId, parent, sub.name, sub.nature ?? cat.nature, cat.section, subOrder, {
        financial: sub.financial, system: sub.system, hidden: sub.hidden,
      });
      idByPath.set(`${cat.name}/${sub.name}`, id);
    }
  }

  const existing = await q.query<{ n: number }>("select count(*)::int as n from classification_rules where user_id=$1 and origin='SYSTEM'", [userId]);
  if (!existing[0].n) {
    for (const [patterns, path, direction, priority] of SYSTEM_RULES) {
      const catId = idByPath.get(path);
      if (!catId) throw new Error(`Regra de sistema aponta para categoria inexistente: ${path}`);
      for (const p of patterns) {
        await q.query(
          `insert into classification_rules(user_id, pattern, match_type, direction, category_id, priority, origin)
           values ($1,$2,'CONTAINS',$3,$4,$5,'SYSTEM')`,
          [userId, p, direction, catId, priority],
        );
      }
    }
  }
}

async function upsertCategory(
  q: Q, userId: string, parentId: string | null, name: string, nature: Nature, section: 'IN' | 'OUT', order: number,
  o: { financial?: boolean; system?: string; hidden?: boolean },
): Promise<string> {
  const found = await q.query<{ id: string }>(
    'select id from categories where user_id=$1 and coalesce(parent_id::text, \'\')=coalesce($2::text, \'\') and lower(name)=lower($3)',
    [userId, parentId, name],
  );
  if (found[0]) return found[0].id;
  const r = await q.query<{ id: string }>(
    `insert into categories(user_id, parent_id, name, nature, section, financial_income, system_key, is_hidden, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [userId, parentId, name, nature, section, !!o.financial, o.system ?? null, !!o.hidden, order],
  );
  return r[0].id;
}
