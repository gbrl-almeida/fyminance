import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  ACCOUNT_KINDS,
  CATEGORY_KINDS,
  CHECK_KEYS,
  CLASSIFICATION_SOURCES,
  CONFIDENCES,
  DIRECTIONS,
  DOC_TYPES,
  HOLDERS,
  NATURES,
  OWNERS,
  REVIEW_REASONS,
  TRANSFER_KINDS,
  TX_ORIGINS,
  TX_STATUSES,
} from '../core/types';

export const SYNC_STATUSES = ['running', 'ok', 'partial', 'failed'] as const;
export const RULE_ORIGINS = ['user', 'learned'] as const;

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  owner: text('owner', { enum: HOLDERS }).notNull(),
  institution: text('institution').notNull(),
  status: text('status').notNull().default('unknown'),
  consentExpiresAt: text('consent_expires_at'),
  lastSyncAt: text('last_sync_at'),
  lastSuccessAt: text('last_success_at'),
  lastError: text('last_error'),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id'),
  kind: text('kind', { enum: ACCOUNT_KINDS }).notNull(),
  name: text('name').notNull(),
  owner: text('owner', { enum: HOLDERS }).notNull(),
  raw: text('raw'),
  countsAsInvestment: integer('counts_as_investment', { mode: 'boolean' }),
  ledgerFrom: text('ledger_from'),
  ledgerUntil: text('ledger_until'),
});

export const balanceSnapshots = sqliteTable(
  'balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull(),
    takenAt: text('taken_at').notNull(),
    date: text('date').notNull(),
    balanceCents: integer('balance_cents').notNull(),
  },
  (t) => [index('balance_snapshots_account_date').on(t.accountId, t.date)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    date: text('date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    description: text('description').notNull(),
    merchantKey: text('merchant_key').notNull(),
    status: text('status', { enum: TX_STATUSES }).notNull(),
    cardLast4: text('card_last4'),
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),
    purchaseDate: text('purchase_date'),
    billId: text('bill_id'),
    counterpartDocType: text('counterpart_doc_type', { enum: DOC_TYPES }),
    counterpartDoc: text('counterpart_doc'),
    raw: text('raw').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    missingSince: text('missing_since'),
    origin: text('origin', { enum: TX_ORIGINS }).notNull().default('pluggy'),
    createdBy: text('created_by', { enum: HOLDERS }),
  },
  (t) => [
    index('transactions_account_date').on(t.accountId, t.date),
    index('transactions_date').on(t.date),
    index('transactions_merchant').on(t.merchantKey),
  ],
);

export const bills = sqliteTable('bills', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  dueDate: text('due_date').notNull(),
  totalCents: integer('total_cents').notNull(),
  raw: text('raw').notNull(),
});

// Aplicações e resgates de cada investimento. O sync nunca apaga: o histórico fica mesmo depois que a Pluggy deixa de mandar.
export const investmentMovements = sqliteTable(
  'investment_movements',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    date: text('date').notNull(),
    type: text('type').notNull(),
    amountCents: integer('amount_cents').notNull(),
    netCents: integer('net_cents'),
    quantity: real('quantity').notNull(),
    unitValue: real('unit_value'),
    raw: text('raw').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('investment_movements_account_date').on(t.accountId, t.date)],
);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
  description: text('description').notNull().default(''),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  merchantKey: text('merchant_key'),
  cardLast4: text('card_last4'),
  accountId: text('account_id'),
  minCents: integer('min_cents'),
  maxCents: integer('max_cents'),
  direction: text('direction', { enum: DIRECTIONS }),
  setNature: text('set_nature', { enum: NATURES }),
  setCategoryId: integer('set_category_id'),
  setOwner: text('set_owner', { enum: OWNERS }),
  origin: text('origin', { enum: RULE_ORIGINS }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const classifications = sqliteTable(
  'classifications',
  {
    transactionId: text('transaction_id').primaryKey(),
    nature: text('nature', { enum: NATURES }).notNull(),
    transferKind: text('transfer_kind', { enum: TRANSFER_KINDS }),
    transferPairId: text('transfer_pair_id'),
    categoryId: integer('category_id'),
    owner: text('owner', { enum: OWNERS }).notNull(),
    source: text('source', { enum: CLASSIFICATION_SOURCES }).notNull(),
    ruleId: integer('rule_id'),
    model: text('model'),
    confidence: text('confidence', { enum: CONFIDENCES }),
    purchaseGroup: text('purchase_group'),
    reviewReason: text('review_reason', { enum: REVIEW_REASONS }),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('classifications_review').on(t.reviewReason)],
);

// O que o casal acrescenta a uma transação. O sync nunca escreve nestas três tabelas.
export const transactionNotes = sqliteTable('transaction_notes', {
  transactionId: text('transaction_id').primaryKey(),
  note: text('note').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Partes de uma saída dividida em categorias. Numa compra parcelada, valem para todas as parcelas.
export const transactionSplits = sqliteTable(
  'transaction_splits',
  {
    transactionId: text('transaction_id').notNull(),
    position: integer('position').notNull(),
    amountCents: integer('amount_cents').notNull(),
    categoryId: integer('category_id').notNull(),
    owner: text('owner', { enum: OWNERS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.position] })],
);

// Crédito (estorno ou reembolso) que abate uma compra. Numa compra parcelada, a compra é qualquer parcela dela.
export const offsets = sqliteTable(
  'offsets',
  {
    creditId: text('credit_id').notNull(),
    purchaseId: text('purchase_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.creditId, t.purchaseId] }), index('offsets_purchase').on(t.purchaseId)],
);

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  action: text('action').notNull(),
  payload: text('payload').notNull(),
});

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', { enum: SYNC_STATUSES }).notNull(),
  stats: text('stats').notNull().default('{}'),
  errors: text('errors').notNull().default('[]'),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { enum: HOLDERS }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userName: text('user_name', { enum: HOLDERS }).notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const monthChecks = sqliteTable(
  'month_checks',
  {
    month: text('month').notNull(),
    key: text('key', { enum: CHECK_KEYS }).notNull(),
    doneAt: text('done_at').notNull(),
    doneBy: text('done_by').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.month, t.key] })],
);

export const monthClosings = sqliteTable('month_closings', {
  month: text('month').primaryKey(),
  closedAt: text('closed_at').notNull(),
  closedBy: text('closed_by').notNull(),
  reportPath: text('report_path').notNull(),
  incomeCents: integer('income_cents').notNull().default(0),
  expenseCents: integer('expense_cents').notNull().default(0),
});

export const divergenceNotes = sqliteTable('divergence_notes', {
  key: text('key').primaryKey(),
  note: text('note').notNull(),
  explainedAt: text('explained_at').notNull(),
  explainedBy: text('explained_by').notNull(),
});

export const categoryGoals = sqliteTable(
  'category_goals',
  {
    month: text('month').notNull(),
    categoryId: integer('category_id').notNull(),
    cents: integer('cents').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.month, t.categoryId] })],
);

export const monthPlans = sqliteTable('month_plans', {
  month: text('month').primaryKey(),
  expectedIncomeCents: integer('expected_income_cents'),
  investmentGoalCents: integer('investment_goal_cents'),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});

export const planNotes = sqliteTable('plan_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  month: text('month').notNull(),
  title: text('title').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const planNoteLines = sqliteTable('plan_note_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  noteId: integer('note_id').notNull(),
  categoryId: integer('category_id').notNull(),
  deltaCents: integer('delta_cents').notNull(),
});
