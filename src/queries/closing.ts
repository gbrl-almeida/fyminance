import { and, asc, between, eq } from 'drizzle-orm';
import { addMonths, lastDayOfMonth, monthOf } from '../core/dates';
import { summarizeMonth, type LedgerRow } from '../core/summary';
import type { Actor, CheckKey, Holder } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories } from '../db/ledger';
import { accounts, classifications, monthChecks, monthClosings, transactions } from '../db/schema';
import { VOUCHER_ACCOUNT_ID } from '../jobs/voucher';
import { firstDataMonth } from './goals';
import { getPendingItems } from './pending';
import { loadLedgerRows } from './rows';

export type StepState = 'done' | 'pending' | 'attention';

export interface ClosingStatus {
  month: string;
  closed: { at: string; by: Actor | 'anterior' } | null;
  steps: { data: StepState; reconciliation: StepState; goals: StepState; investments: StepState };
  reconciliation: {
    reviewGroups: number;
    reviewCents: number;
    openDivergences: number;
    flashConfirmed: boolean;
    cashConfirmed: boolean;
    complete: boolean;
  };
  remaining: number;
}

interface ClosingRecord {
  at: string;
  by: Actor | 'anterior';
  incomeCents: number | null;
  expenseCents: number | null;
}

export function monthRows(db: Db, month: string): LedgerRow[] {
  return loadLedgerRows(db, { from: `${month}-01`, to: lastDayOfMonth(month) });
}

/** Registro do fechamento. Só o banco decide; relatórios antigos viram registro no `fy migrate`. */
export function closingRecord(db: Db, month: string, _dataDir?: string): ClosingRecord | null {
  const row = db.select().from(monthClosings).where(eq(monthClosings.month, month)).get();
  if (row === undefined) return null;
  const legacy = row.closedBy === 'anterior';
  return {
    at: row.closedAt,
    by: row.closedBy as Actor | 'anterior',
    incomeCents: legacy ? null : row.incomeCents,
    expenseCents: legacy ? null : row.expenseCents,
  };
}

function hasCheck(db: Db, month: string, key: CheckKey): boolean {
  return db.select().from(monthChecks).where(and(eq(monthChecks.month, month), eq(monthChecks.key, key))).get() !== undefined;
}

export function getClosingStatus(db: Db, month: string, today: string, dataDir: string): ClosingStatus {
  const pending = getPendingItems(db, { today, month });
  const reviewCents = pending.review.reduce((sum, g) => sum + g.totalCents, 0);
  const openDivergences = [...pending.billDivergences, ...pending.balanceDivergences].filter((d) => d.explanation === null).length;
  const hasVoucher = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, VOUCHER_ACCOUNT_ID)).get() !== undefined;
  const flashConfirmed = !hasVoucher || hasCheck(db, month, 'flash');
  const cashConfirmed = hasCheck(db, month, 'cash');
  const complete = pending.review.length === 0 && openDivergences === 0 && flashConfirmed && cashConfirmed;
  const record = closingRecord(db, month, dataDir);
  const steps = {
    data: (pending.connections.length > 0 ? 'attention' : 'done') as StepState,
    reconciliation: (complete ? 'done' : pending.review.length > 0 || openDivergences > 0 ? 'attention' : 'pending') as StepState,
    goals: (hasCheck(db, month, 'goals') ? 'done' : 'pending') as StepState,
    investments: (hasCheck(db, month, 'investments') ? 'done' : 'pending') as StepState,
  };
  return {
    month,
    closed: record === null ? null : { at: record.at, by: record.by },
    steps,
    reconciliation: { reviewGroups: pending.review.length, reviewCents, openDivergences, flashConfirmed, cashConfirmed, complete },
    remaining: [steps.reconciliation, steps.goals, steps.investments].filter((s) => s !== 'done').length,
  };
}

/** O mês anterior ao de hoje, enquanto não estiver fechado e houver dados até ele. */
export function pendingClosingMonth(db: Db, today: string, dataDir: string): string | null {
  const previous = addMonths(monthOf(today), -1);
  const first = firstDataMonth(db);
  if (first === null || first > previous) return null;
  return closingRecord(db, previous, dataDir) === null ? previous : null;
}

/** Quanto renda e gastos de um mês fechado mudaram desde o fechamento; `null` sem mudança ou sem retrato. */
export function closedMonthDrift(db: Db, month: string, _today: string, dataDir: string): { incomeCents: number; expenseCents: number } | null {
  const record = closingRecord(db, month, dataDir);
  if (record === null || record.incomeCents === null || record.expenseCents === null) return null;
  const now = summarizeMonth(monthRows(db, month), loadCategories(db), month);
  const drift = { incomeCents: now.incomeCents - record.incomeCents, expenseCents: now.expenseCents - record.expenseCents };
  return drift.incomeCents === 0 && drift.expenseCents === 0 ? null : drift;
}

export interface OutsidePluggy {
  /** Gasto do vale-alimentação no mês (valor positivo) e quem conferiu; `null` sem voucher configurado. */
  flash: { cents: number; confirmedBy: Actor | null } | null;
  cashConfirmedBy: Actor | null;
  entries: Array<{ id: string; date: string; description: string; amountCents: number; account: string; category: string | null; createdBy: Holder | null }>;
}

function checkBy(db: Db, month: string, key: CheckKey): Actor | null {
  const row = db.select().from(monthChecks).where(and(eq(monthChecks.month, month), eq(monthChecks.key, key))).get();
  return row === undefined ? null : (row.doneBy as Actor);
}

/** O que não vem dos bancos: vale-alimentação, dinheiro vivo e lançamentos manuais do mês. */
export function getOutsidePluggy(db: Db, month: string): OutsidePluggy {
  const voucher = db.select({ cents: transactions.amountCents }).from(transactions).where(eq(transactions.id, `voucher:${month}:out`)).get();
  const list = loadCategories(db);
  const entries = db
    .select({ tx: transactions, account: accounts.name, categoryId: classifications.categoryId })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(classifications, eq(classifications.transactionId, transactions.id))
    .where(and(eq(transactions.origin, 'manual'), between(transactions.date, `${month}-01`, lastDayOfMonth(month))))
    .orderBy(asc(transactions.date), asc(transactions.id))
    .all()
    .map(({ tx, account, categoryId }) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amountCents: tx.amountCents,
      account,
      category: categoryId === null ? null : categoryPath(list, categoryId),
      createdBy: tx.createdBy,
    }));
  return {
    flash: voucher === undefined ? null : { cents: -voucher.cents, confirmedBy: checkBy(db, month, 'flash') },
    cashConfirmedBy: checkBy(db, month, 'cash'),
    entries,
  };
}
