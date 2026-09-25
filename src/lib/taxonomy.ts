import type { Categoria, Natureza } from './types';

// Estrutura do CAIXA MENSAL (ordem das linhas) + aba Apoio.
const RECEITAS: [string, string[]][] = [
  ['CLT', ['Salário', '13º Salário', 'Férias', 'Rescisão', 'Prêmio']],
  ['Extras', ['Serviço Contábil', 'V4 Company']],
  ['Bancário', ['Empréstimo', 'Resgate']],
  ['Outras Receitas', ['Outros']],
];

const DESPESAS: [string, string[]][] = [
  ['Moradia', ['Aluguel', 'Condomínio', 'Energia elétrica', 'Manutenção residencial', 'Móveis / Eletro / Eletrônicos', 'Decoração']],
  ['Alimentação', ['Mercado / Limpeza', 'Lanches / Delivery']],
  ['Vestuário', ['Roupas', 'Roupas infantis', 'Acessórios']],
  ['Transporte', ['Combustível', 'IPVA / Documentação', 'Seguro', 'Mecânica / Manutenção', 'Lavagem / Estética', 'Pedágio / Tag / Estacionamento', 'Aplicativo / Táxi']],
  ['Educação', ['Escola', 'Atividades Extras']],
  ['Saúde / Médico', ['Medicamentos', 'Plano de saúde', 'Consultas / Exames', 'Odontologia']],
  ['Comunicação', ['Celular', 'Internet']],
  ['Lazer', ['Assinaturas / Streaming', 'Cinema / Teatro', 'Eventos / Shows', 'Passeios']],
  ['Pet', ['Ração / Alimentação', 'Banho / Tosa', 'Veterinário / Vacinas']],
  ['Tâmilly', ['Despesas Cartão']],
  ['Poupança', ['Aporte', 'Resgate', 'Rendimento', 'Transferência entre contas']],
  ['Outros', ['Presentes / Doações', 'Impostos / Taxas', 'Despesa não identificada']],
  ['Despesas bancárias', ['Tarifas / Encargos']],
  ['Financiamentos', ['Parcela de veículo', 'Parcela de empréstimo']],
  ['Ajuste de saldo', ['Correção manual']],
];

function build(nat: Natureza, list: [string, string[]][], base: number): Categoria[] {
  let i = base;
  return list.flatMap(([grupo, subs]) => subs.map(subgrupo => ({ natureza: nat, grupo, subgrupo, ordem: i++ })));
}

export const DEFAULT_CATEGORIAS: Categoria[] = [...build('receita', RECEITAS, 0), ...build('despesa', DESPESAS, 100)];

export const SUB_NAO_IDENTIFICADA = 'Despesa não identificada';
export const SUB_RECEITA_OUTROS = 'Outros';

/** Grupos que não são consumo (usados para separar "gasto de verdade" nos insights). */
export const GRUPOS_NAO_CONSUMO = new Set(['Poupança', 'Ajuste de saldo', 'Financiamentos']);

/** Cartões padrão (aba Apoio). */
export const CARTOES_PADRAO = ['Itaú Black', 'Nubank'];

export const catKey = (natureza: Natureza, subgrupo: string) => `${natureza}:${subgrupo}`;
