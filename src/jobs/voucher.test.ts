import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTx } from '../core/testing';
import { loadClassifications } from '../db/ledger';
import { accounts, transactions } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { VOUCHER_ACCOUNT_ID, ensureVoucher } from './voucher';

const NOW = '2026-10-14T10:00:00.000Z';

function voucherRows(db: ReturnType<typeof createTestDb>['db']) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, VOUCHER_ACCOUNT_ID))
    .orderBy(transactions.id)
    .all()
    .map((row) => [row.id, row.date, row.amountCents]);
}

describe('ensureVoucher', () => {
  it('adds a credit and a food expense for every month since the first transaction', () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'c6', kind: 'checking' });
    insertTestTx(db, makeTx({ id: 'old', accountId: 'c6', date: '2026-08-20' }));

    expect(ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: NOW })).toBe(6);
    expect(voucherRows(db)).toEqual([
      ['voucher:2026-08:in', '2026-08-01', 80000],
      ['voucher:2026-08:out', '2026-08-01', -80000],
      ['voucher:2026-09:in', '2026-09-01', 80000],
      ['voucher:2026-09:out', '2026-09-01', -80000],
      ['voucher:2026-10:in', '2026-10-01', 80000],
      ['voucher:2026-10:out', '2026-10-01', -80000],
    ]);
    const saved = loadClassifications(db);
    expect(saved.get('voucher:2026-09:in')).toMatchObject({
      nature: 'income',
      categoryId: categoryIdByName(db, 'Voucher'),
      owner: 'pessoa2',
      source: 'system',
    });
    expect(saved.get('voucher:2026-09:out')).toMatchObject({
      nature: 'expense',
      categoryId: categoryIdByName(db, 'Alimentação'),
      owner: 'casal',
      source: 'system',
    });
  });

  it('is idempotent', () => {
    const { db } = createTestDb();
    ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: NOW });
    expect(ensureVoucher(db, { monthlyCents: 90000, today: '2026-10-14', nowIso: NOW })).toBe(0);
  });

  it('starts eleven months back when there is no data yet', () => {
    const { db } = createTestDb();
    expect(ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: NOW })).toBe(24);
    expect(voucherRows(db)[0]).toEqual(['voucher:2025-11:in', '2025-11-01', 80000]);
  });

  it('creates the voucher account for pessoa 2', () => {
    const { db } = createTestDb();
    ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: NOW });
    expect(db.select().from(accounts).where(eq(accounts.id, VOUCHER_ACCOUNT_ID)).get()).toMatchObject({
      kind: 'voucher',
      owner: 'pessoa2',
      name: 'Vale-alimentação',
    });
  });
});
