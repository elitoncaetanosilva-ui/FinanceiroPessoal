import type { ISODate } from '@/lib/dates';

export interface InputFile { name: string; bytes: Buffer }

/** Linha normalizada de qualquer formato (valor já no sinal do portador). */
export interface CanonicalRow {
  index: number;
  raw: unknown;
  date: ISODate;
  description: string;
  amountCents: number;
  installment?: { n: number; total: number } | null;
  purchaseDate?: ISODate | null;   // data original da compra (parcelas)
  externalId?: string | null;
  cardLast4?: string | null;
  isCardPayment?: boolean;          // crédito de pagamento dentro de um arquivo de fatura
  error?: string;
}

export interface ParsedFile {
  importerId: string;
  family: string;                   // prefixo das chaves de deduplicação
  institution: string;
  kind: 'ACCOUNT' | 'CARD';
  account?: { branch?: string | null; number?: string | null };
  card?: { title?: string | null; last4?: string | null; otherLast4?: string[]; dueDate?: ISODate | null; reportedTotalCents?: number | null; open?: boolean };
  period: { start: ISODate | null; end: ISODate | null };
  openingBalance?: { date: ISODate; balanceCents: number } | null;
  balances: { date: ISODate; balanceCents: number }[];
  rows: CanonicalRow[];
  warnings: string[];
}

export interface Importer {
  id: string;
  label: string;
  /** 0..1: confiança de que o arquivo é deste formato */
  detect(file: InputFile): number;
  parse(file: InputFile): ParsedFile;
  /** Chave de deduplicação da linha (sem o índice de ocorrência). */
  baseKey(row: CanonicalRow): string;
  /** Chave da parcela k de uma compra parcelada (para gerar as previstas já com a chave que o próximo arquivo terá). */
  installmentKey?(row: CanonicalRow, k: number): string;
  groupKey?(row: CanonicalRow): string;
}
