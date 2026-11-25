export const HOLDERS = ['pessoa1', 'pessoa2'] as const;
export const OWNERS = ['casal', 'pessoa1', 'pessoa2'] as const;
export const NATURES = ['expense', 'income', 'transfer'] as const;
export const TRANSFER_KINDS = ['internal', 'bill_payment', 'investment'] as const;
export const ACCOUNT_KINDS = ['checking', 'credit_card', 'investment', 'voucher', 'cash'] as const;
export const TX_STATUSES = ['posted', 'pending', 'removed'] as const;
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const CLASSIFICATION_SOURCES = ['system', 'rule', 'model', 'manual'] as const;
export const REVIEW_REASONS = ['uncategorized', 'low_confidence', 'pix_person', 'ambiguous_inflow', 'pj_income', 'refund'] as const;
export const CATEGORY_KINDS = ['expense', 'income'] as const;
export const DIRECTIONS = ['in', 'out'] as const;
export const DOC_TYPES = ['cpf', 'cnpj'] as const;
export const TX_ORIGINS = ['pluggy', 'manual', 'file'] as const;
export const CHECK_KEYS = ['flash', 'cash', 'goals', 'investments'] as const;

export type Holder = (typeof HOLDERS)[number];
export type Owner = (typeof OWNERS)[number];
export type Nature = (typeof NATURES)[number];
export type TransferKind = (typeof TRANSFER_KINDS)[number];
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export type TxStatus = (typeof TX_STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type DocType = (typeof DOC_TYPES)[number];
export type TxOrigin = (typeof TX_ORIGINS)[number];
export type CheckKey = (typeof CHECK_KEYS)[number];
/** Quem fez uma gravação: um dos dois pelo app ou o Claude pelo MCP. */
export type Actor = Holder | 'claude';

/** Transação como o domínio a enxerga. `amountCents` positivo entra na conta, negativo sai. */
export interface Tx {
  id: string;
  accountId: string;
  accountKind: AccountKind;
  date: string;
  amountCents: number;
  description: string;
  merchantKey: string;
  status: TxStatus;
  cardLast4: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  purchaseDate: string | null;
  billId: string | null;
  counterpartDocType: DocType | null;
  counterpartDoc: string | null;
}

export interface Rule {
  id: number;
  merchantKey: string | null;
  cardLast4: string | null;
  accountId: string | null;
  minCents: number | null;
  maxCents: number | null;
  direction: Direction | null;
  setNature: Nature | null;
  setCategoryId: number | null;
  setOwner: Owner | null;
  createdAt: string;
}

export interface Classification {
  transactionId: string;
  nature: Nature;
  transferKind: TransferKind | null;
  transferPairId: string | null;
  categoryId: number | null;
  owner: Owner;
  source: ClassificationSource;
  ruleId: number | null;
  model: string | null;
  confidence: Confidence | null;
  purchaseGroup: string | null;
  reviewReason: ReviewReason | null;
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  description: string;
  archived: boolean;
}
