export type Natureza = 'receita' | 'despesa';
/** cash = conta corrente (aba CASH); cartao = parcelas de cartão (aba CARTÃO). */
export type Origem = 'cash' | 'cartao';
export type Fonte = 'planilha' | 'pluggy' | 'manual' | 'projecao';

/**
 * Convenção de sinal = a da planilha CAIXA 2026:
 * - natureza "despesa": valor > 0 é saída; valor < 0 é crédito/estorno/resgate (reduz a saída).
 * - natureza "receita": valor > 0 é entrada.
 * Geração de caixa do mês = Σ receitas − Σ despesas.
 */
export interface Lancamento {
  id: number;
  origem: Origem;
  natureza: Natureza;
  conta: string | null; // "Itaú Black", "Nubank" (cartão) ou nome da conta
  data: string; // data da compra/movimento (ISO)
  vencimento: string; // data que afeta o caixa (vencimento da fatura p/ cartão)
  descricao: string;
  parcela: number | null;
  parcelas: number | null;
  subgrupo: string;
  valor: number;
  fonte: Fonte;
  external_id: string | null;
  revisar: boolean;
  ignorado: boolean;
  nota: string | null;
}

export type NovoLancamento = Omit<Lancamento, 'id'>;

export interface Categoria {
  natureza: Natureza;
  grupo: string;
  subgrupo: string;
  ordem: number;
}

export interface Orcamento {
  mes: string; // YYYY-MM
  natureza: Natureza;
  subgrupo: string;
  valor: number;
}

export interface Regra {
  id: number;
  padrao: string; // descKey normalizada ou trecho "contém"
  tipo: 'exata' | 'contem';
  natureza: Natureza;
  subgrupo: string;
  origem: 'aprendida' | 'usuario';
}
