import type { Q } from '../db';
import type { ISODate } from '@/lib/dates';

export interface Ctx { q: Q; userId: string }

export type Nature = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'INVESTMENT' | 'FINANCING' | 'ADJUSTMENT';
export type MovementKind = 'NORMAL' | 'TRANSFER' | 'CARD_PAYMENT' | 'ADJUSTMENT';
export type MovementStatus = 'PLANNED' | 'REALIZED' | 'CANCELLED';
export type MovementSource = 'MANUAL' | 'IMPORT' | 'RECURRING' | 'INSTALLMENT' | 'MIGRATION' | 'SYSTEM' | 'OPEN_FINANCE';
export type AccountType = 'CHECKING' | 'SAVINGS' | 'DIGITAL' | 'INVESTMENT' | 'WALLET' | 'CASH' | 'OTHER';

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  CHECKING: 'Conta corrente', SAVINGS: 'Poupança', DIGITAL: 'Conta digital', INVESTMENT: 'Investimento',
  WALLET: 'Carteira digital', CASH: 'Dinheiro', OTHER: 'Outros',
};
export const NATURE_LABEL: Record<Nature, string> = {
  INCOME: 'Receita', EXPENSE: 'Despesa', TRANSFER: 'Transferência', INVESTMENT: 'Investimento',
  FINANCING: 'Financiamento / dívida', ADJUSTMENT: 'Ajuste',
};

export interface Category {
  id: string; parent_id: string | null; name: string; nature: Nature; section: 'IN' | 'OUT';
  financial_income: boolean; system_key: string | null; is_hidden: boolean; is_active: boolean; sort_order: number;
}
export interface Account {
  id: string; institution_id: string | null; institution_name: string | null; name: string; type: AccountType;
  branch: string | null; number: string | null; opening_balance_cents: number; opening_balance_date: ISODate;
  in_available_balance: boolean; is_active: boolean; color: string | null;
}
export interface Card {
  id: string; institution_id: string | null; institution_name: string | null; name: string; brand: string | null;
  last4: string | null; extra_last4: string[]; limit_cents: number; closing_day: number; due_day: number;
  payment_account_id: string | null; payment_patterns: string[]; is_active: boolean; color: string | null;
}
export interface Statement {
  id: string; card_id: string; due_month: ISODate; closing_date: ISODate; due_date: ISODate;
  reported_total_cents: number | null; settled_manually: boolean;
}

export interface SplitInput { categoryId: string | null; amountCents: number; personId?: string | null; notes?: string | null }

export class DomainError extends Error {
  constructor(message: string) { super(message); this.name = 'DomainError'; }
}
