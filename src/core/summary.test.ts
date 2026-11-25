import { describe, expect, it } from 'vitest';
import { summarizeMonth, type LedgerRow } from './summary';
import { makeClassification, makeTx } from './testing';
import type { Category } from './types';

const cat = (id: number, name: string, parentId: number | null, kind: 'expense' | 'income' = 'expense'): Category => ({
  id,
  name,
  parentId,
  kind,
  description: '',
  archived: false,
});
const categories = [
  cat(1, 'Alimentação', null),
  cat(2, 'Restaurante', 1),
  cat(3, 'Mercado', 1),
  cat(4, 'Moradia', null),
  cat(10, 'Salário', null, 'income'),
];

function row(id: string, amountCents: number, cls: Parameters<typeof makeClassification>[0] | null, extra = {}): LedgerRow {
  return { tx: makeTx({ id, amountCents, date: '2026-10-10', ...extra }), cls: cls === null ? null : makeClassification(cls) };
}

const rows: LedgerRow[] = [
  row('salary', 600000, { transactionId: 'salary', nature: 'income', categoryId: 10 }),
  row('restaurant', -8000, { transactionId: 'restaurant', categoryId: 2 }),
  row('refund', 2000, { transactionId: 'refund', categoryId: 2 }),
  row('market', -30000, { transactionId: 'market', categoryId: 3 }),
  row('rent', -250000, { transactionId: 'rent', categoryId: 4 }),
  row('clothes', -15000, { transactionId: 'clothes', owner: 'pessoa2', reviewReason: 'uncategorized' }),
  row('transfer', -100000, { transactionId: 'transfer', nature: 'transfer', transferKind: 'internal' }),
  row('removed', -99900, { transactionId: 'removed', categoryId: 4 }, { status: 'removed' }),
  row('september', -5000, { transactionId: 'september', categoryId: 2 }, { date: '2026-09-30' }),
  row('unclassified', -700, null),
];

describe('summarizeMonth', () => {
  const summary = summarizeMonth(rows, categories, '2026-10');

  it('adds up income, spending and surplus, with refunds reducing spending', () => {
    expect(summary.incomeCents).toBe(600000);
    expect(summary.expenseCents).toBe(301000);
    expect(summary.surplusCents).toBe(299000);
  });

  it('groups spending by parent category with children', () => {
    expect(summary.expenseByCategory).toEqual([
      { categoryId: 4, name: 'Moradia', cents: 250000, children: [] },
      {
        categoryId: 1,
        name: 'Alimentação',
        cents: 36000,
        children: [
          { categoryId: 3, name: 'Mercado', cents: 30000 },
          { categoryId: 2, name: 'Restaurante', cents: 6000 },
        ],
      },
      { categoryId: null, name: 'Sem categoria', cents: 15000, children: [] },
    ]);
    expect(summary.incomeByCategory).toEqual([{ categoryId: 10, name: 'Salário', cents: 600000, children: [] }]);
  });

  it('splits spending by owner and counts open reviews', () => {
    expect(summary.expenseByOwner).toEqual({ casal: 286000, pessoa1: 0, pessoa2: 15000 });
    expect(summary.uncategorizedExpenseCents).toBe(15000);
    expect(summary.reviewCount).toBe(1);
  });

  it('returns zeros for a month without data', () => {
    const empty = summarizeMonth(rows, categories, '2025-01');
    expect(empty).toMatchObject({ incomeCents: 0, expenseCents: 0, surplusCents: 0, reviewCount: 0 });
    expect(empty.expenseByCategory).toEqual([]);
  });
});
