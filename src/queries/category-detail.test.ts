import { describe, expect, it } from 'vitest';
import { transactionNotes, transactionSplits } from '../db/schema';
import { categoryIdByName, createTestDb } from '../db/testing';
import { getCategoryDetail } from './category-detail';
import { buildLedgerFixture } from './test-fixture';

describe('category detail', () => {
  it('groups the month transactions of a parent category by merchant', () => {
    const { db } = createTestDb();
    buildLedgerFixture(db);
    const detail = getCategoryDetail(db, categoryIdByName(db, 'Alimentação'), '2026-10', 'all');
    expect(detail.category).toEqual({ id: categoryIdByName(db, 'Alimentação'), name: 'Alimentação', parentName: null });
    expect(detail.totalCents).toBe(29590);
    expect(detail.groups.map((g) => [g.merchantKey, g.totalCents, g.items.length])).toEqual([
      ['SUPERMERCADO BOM PRECO', 25000, 1],
      ['IFOOD IFOOD', 4590, 1],
    ]);
    expect(detail.groups[0]?.items[0]).toMatchObject({ id: 'market', categoryId: categoryIdByName(db, 'Mercado'), owner: 'casal' });
  });

  it('filters by owner and knows the parent of a subcategory', () => {
    const { db } = createTestDb();
    buildLedgerFixture(db);
    expect(getCategoryDetail(db, categoryIdByName(db, 'Lazer'), '2026-10', 'pessoa2').groups).toEqual([]);
    expect(getCategoryDetail(db, categoryIdByName(db, 'Mercado'), '2026-10', 'all').category.parentName).toBe('Alimentação');
  });

  it('shows each part of a split purchase in its own category, with the note', () => {
    const { db } = createTestDb();
    buildLedgerFixture(db);
    const market = categoryIdByName(db, 'Mercado');
    const home = categoryIdByName(db, 'Casa');
    db.insert(transactionSplits)
      .values([
        { transactionId: 'market', position: 0, amountCents: 20000, categoryId: market, owner: 'casal' },
        { transactionId: 'market', position: 1, amountCents: 5000, categoryId: home, owner: 'pessoa1' },
      ])
      .run();
    db.insert(transactionNotes).values({ transactionId: 'market', note: 'compras e uma panela', updatedBy: 'pessoa1', updatedAt: '2026-10-14T10:00:00.000Z' }).run();
    const item = (categoryId: number) => getCategoryDetail(db, categoryId, '2026-10', 'all').groups.find((g) => g.merchantKey === 'SUPERMERCADO BOM PRECO')?.items[0];
    expect(item(market)).toMatchObject({ id: 'market', amountCents: -20000, bankCents: -25000, offsetCents: 0, note: 'compras e uma panela', part: { index: 0, count: 2 } });
    expect(item(home)).toMatchObject({ id: 'market', amountCents: -5000, owner: 'pessoa1', part: { index: 1, count: 2 } });
  });

  it('unknown category fails', () => {
    const { db } = createTestDb();
    expect(() => getCategoryDetail(db, 99999, '2026-10', 'all')).toThrow('Categoria não encontrada.');
  });
});
