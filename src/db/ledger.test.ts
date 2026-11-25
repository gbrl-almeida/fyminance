import { describe, expect, it } from 'vitest';
import { runReadOnlySql } from '../queries/sql';
import { makeClassification, makeRule, makeTx } from '../core/testing';
import { categoryPath, loadCategories, loadClassifications, loadRules, loadTxs, saveClassifications } from './ledger';
import { rules } from './schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from './testing';

const NOW = '2026-10-14T10:00:00.000Z';

describe('ledger', () => {
  it('loadTxs respects the account ledger window', () => {
    const { db, sqlite } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card', ledgerFrom: '2026-09-01', ledgerUntil: '2026-10-01' });
    for (const date of ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01']) {
      insertTestTx(db, makeTx({ id: date, accountId: 'card', accountKind: 'credit_card', date }), { origin: 'file' });
    }
    expect(loadTxs(db).map((tx) => tx.id)).toEqual(['2026-09-01', '2026-09-30']);
    const view = runReadOnlySql(sqlite, 'SELECT id, origin FROM v_transactions ORDER BY id');
    expect(view.rows).toEqual([
      { id: '2026-09-01', origin: 'file' },
      { id: '2026-09-30', origin: 'file' },
    ]);
  });

  it('loads transactions with the kind of their account', () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    const tx = makeTx({
      id: 't1',
      accountId: 'card',
      accountKind: 'credit_card',
      description: 'IFOOD',
      amountCents: -4590,
      installmentNumber: 2,
      installmentTotal: 3,
    });
    insertTestTx(db, tx);
    expect(loadTxs(db)).toEqual([tx]);
  });

  it('saves classifications without overwriting manual ones', () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    insertTestTx(db, makeTx({ id: 't1', accountId: 'card' }));
    insertTestTx(db, makeTx({ id: 't2', accountId: 'card' }));
    insertTestClassification(db, makeClassification({ transactionId: 't1', source: 'manual', categoryId: 5 }));

    const saved = saveClassifications(
      db,
      [makeClassification({ transactionId: 't1', categoryId: 9 }), makeClassification({ transactionId: 't2', categoryId: 9 })],
      NOW,
    );

    expect(saved).toBe(1);
    expect(loadClassifications(db).get('t1')).toMatchObject({ source: 'manual', categoryId: 5 });
    expect(loadClassifications(db).get('t2')).toMatchObject({ source: 'system', categoryId: 9 });
    saveClassifications(db, [makeClassification({ transactionId: 't2', categoryId: 3 })], NOW);
    expect(loadClassifications(db).get('t2')?.categoryId).toBe(3);
  });

  it('loads rules without their origin', () => {
    const { db } = createTestDb();
    db.insert(rules)
      .values({ merchantKey: 'IFOOD IFOOD', setCategoryId: 3, origin: 'learned', createdAt: '2026-10-01T00:00:00.000Z' })
      .run();
    expect(loadRules(db)).toEqual([makeRule({ id: 1, merchantKey: 'IFOOD IFOOD', setCategoryId: 3 })]);
  });

  it('builds category paths', () => {
    const { db } = createTestDb();
    const list = loadCategories(db);
    expect(categoryPath(list, categoryIdByName(db, 'Restaurante'))).toBe('Alimentação > Restaurante');
    expect(categoryPath(list, categoryIdByName(db, 'Moradia'))).toBe('Moradia');
    expect(categoryPath(list, 9999)).toBe('#9999');
  });
});
