import { monthOf } from './dates';
import type { Category, Classification, Owner, Tx } from './types';

export interface LedgerRow {
  tx: Tx;
  cls: Classification | null;
  /** Presente quando uma divisão ou um abatimento mudou o valor que o banco mandou. */
  adjustment?: RowAdjustment;
}

export interface RowAdjustment {
  bankCents: number;
  /** Quanto dos créditos ligados abateu esta linha (numa compra) ou saiu dela (num crédito). */
  offsetCents: number;
  part: { index: number; count: number } | null;
}

export interface CategoryTotal {
  categoryId: number | null;
  name: string;
  cents: number;
  children: Array<{ categoryId: number; name: string; cents: number }>;
}

export interface MonthSummary {
  month: string;
  incomeCents: number;
  expenseCents: number;
  surplusCents: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  expenseByOwner: Record<Owner, number>;
  uncategorizedExpenseCents: number;
  reviewCount: number;
}

const UNCATEGORIZED = 'Sem categoria';

function groupByCategory(
  entries: ReadonlyArray<{ categoryId: number | null; cents: number }>,
  categories: readonly Category[],
): CategoryTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parents = new Map<string, CategoryTotal>();
  for (const { categoryId, cents } of entries) {
    const category = categoryId === null ? undefined : byId.get(categoryId);
    if (category === undefined) {
      const bucket = parents.get('none') ?? { categoryId: null, name: UNCATEGORIZED, cents: 0, children: [] };
      bucket.cents += cents;
      parents.set('none', bucket);
      continue;
    }
    const parent = category.parentId === null ? category : (byId.get(category.parentId) ?? category);
    const key = String(parent.id);
    const bucket = parents.get(key) ?? { categoryId: parent.id, name: parent.name, cents: 0, children: [] };
    bucket.cents += cents;
    if (parent.id !== category.id) {
      const child = bucket.children.find((c) => c.categoryId === category.id);
      if (child === undefined) bucket.children.push({ categoryId: category.id, name: category.name, cents });
      else child.cents += cents;
    }
    parents.set(key, bucket);
  }
  const result = [...parents.values()].sort((a, b) => b.cents - a.cents);
  for (const total of result) total.children.sort((a, b) => b.cents - a.cents);
  return result;
}

export function summarizeMonth(rows: readonly LedgerRow[], categories: readonly Category[], month: string): MonthSummary {
  const income: Array<{ categoryId: number | null; cents: number }> = [];
  const expense: Array<{ categoryId: number | null; cents: number }> = [];
  const expenseByOwner: Record<Owner, number> = { casal: 0, pessoa1: 0, pessoa2: 0 };
  let reviewCount = 0;

  for (const { tx, cls } of rows) {
    if (cls === null || tx.status === 'removed' || monthOf(tx.date) !== month) continue;
    if (cls.reviewReason !== null) reviewCount += 1;
    if (cls.nature === 'income') income.push({ categoryId: cls.categoryId, cents: tx.amountCents });
    if (cls.nature === 'expense') {
      expense.push({ categoryId: cls.categoryId, cents: -tx.amountCents });
      expenseByOwner[cls.owner] += -tx.amountCents;
    }
  }

  const incomeCents = income.reduce((sum, e) => sum + e.cents, 0);
  const expenseCents = expense.reduce((sum, e) => sum + e.cents, 0);
  return {
    month,
    incomeCents,
    expenseCents,
    surplusCents: incomeCents - expenseCents,
    incomeByCategory: groupByCategory(income, categories),
    expenseByCategory: groupByCategory(expense, categories),
    expenseByOwner,
    uncategorizedExpenseCents: expense.filter((e) => e.categoryId === null).reduce((sum, e) => sum + e.cents, 0),
    reviewCount,
  };
}

/** Sobra ÷ renda do mês; sem renda, `null`. */
export function savingsRate(incomeCents: number, surplusCents: number): number | null {
  return incomeCents > 0 ? surplusCents / incomeCents : null;
}
