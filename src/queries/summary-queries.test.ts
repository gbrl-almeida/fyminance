import { describe, expect, it } from 'vitest';
import { makeClassification, makeTx } from '../core/testing';
import { balanceSnapshots } from '../db/schema';
import { createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import { getUpcomingInstallments } from './installments';
import { getMonthSummary } from './month-summary';
import { loadLedgerRows } from './rows';
import { FIXTURE_TODAY, buildLedgerFixture } from './test-fixture';
import { balanceAt, monthlyYield } from './yield';

function fixture() {
  const { db } = createTestDb();
  buildLedgerFixture(db);
  return db;
}

describe('summary queries', () => {
  it('loads ledger rows within a date range', () => {
    const db = fixture();
    const rows = loadLedgerRows(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(rows.map((r) => r.tx.id).sort()).toEqual(['apply', 'ifood-sep', 'tv-1']);
    expect(loadLedgerRows(db).find((r) => r.tx.id === 'ghost')?.cls).toBeNull();
  });

  it('summarizes October with the new installment purchases and yield', () => {
    const db = fixture();
    const report = getMonthSummary(db, '2026-10', FIXTURE_TODAY);
    expect(report).toMatchObject({
      month: '2026-10',
      incomeCents: 900000,
      expenseCents: 357880,
      surplusCents: 542120,
      reviewCount: 2,
      yieldCents: 0,
      newInstallmentPurchases: [],
    });
    expect(report.expenseByOwner).toEqual({ casal: 337890, pessoa1: 19990, pessoa2: 0 });
  });

  it('summarizes September with the TV bought in installments', () => {
    const db = fixture();
    const report = getMonthSummary(db, '2026-09', FIXTURE_TODAY);
    expect(report.expenseCents).toBe(56000);
    expect(report.yieldCents).toBe(500);
    expect(report.newInstallmentPurchases).toEqual([
      { description: 'LOJA TV 01/10', installmentTotal: 10, installmentCents: 50000, totalCents: 500000 },
    ]);
  });

  it('reports yield as unavailable without balances at both ends', () => {
    const db = fixture();
    expect(monthlyYield(db, '2026-08', FIXTURE_TODAY)).toBeNull();
    expect(balanceAt(db, 'cdb', '2026-09-30')).toBe(100000);
    expect(balanceAt(db, 'cdb', '2026-08-31')).toBeNull();
  });

  it('projects the installments still to come', () => {
    const db = fixture();
    const upcoming = getUpcomingInstallments(db, FIXTURE_TODAY);
    expect(upcoming.totalCents).toBe(400000);
    expect(upcoming.months[0]).toEqual({ month: '2026-10', cents: 0 });
    expect(upcoming.months[1]).toEqual({ month: '2026-11', cents: 50000 });
    expect(upcoming.bankReported.every((m) => m.cents === 0)).toBe(true);
    expect(upcoming.active).toEqual([
      { description: 'LOJA TV 01/10', installmentTotal: 10, lastSeenNumber: 2, installmentCents: 50000, remainingCents: 400000 },
    ]);
  });

  it('reports future installments sent by the bank without counting them as seen', () => {
    const db = fixture();
    insertTestTx(
      db,
      makeTx({
        id: 'tv-3',
        accountId: 'c6-card',
        accountKind: 'credit_card',
        date: '2026-11-10',
        amountCents: -50000,
        description: 'LOJA TV 03/10',
        installmentNumber: 3,
        installmentTotal: 10,
        status: 'pending',
      }),
    );
    const upcoming = getUpcomingInstallments(db, FIXTURE_TODAY);
    expect(upcoming.bankReported[1]).toEqual({ month: '2026-11', cents: 50000 });
    expect(upcoming.totalCents).toBe(400000);
  });
});

describe('monthlyYield with positions opened during the month', () => {
  it('starts a new position from zero when its connection was already tracked', () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'c6', kind: 'checking', connectionId: 'item-c6' });
    insertTestAccount(db, { id: 'cdb-a', kind: 'investment', connectionId: 'item-c6' });
    insertTestAccount(db, { id: 'cdb-b', kind: 'investment', connectionId: 'item-c6' });
    const snap = (accountId: string, date: string, balanceCents: number) => ({ accountId, date, takenAt: `${date}T10:00:00.000Z`, balanceCents });
    db.insert(balanceSnapshots)
      .values([snap('cdb-a', '2026-09-30', 100000), snap('cdb-a', '2026-10-31', 101000), snap('cdb-b', '2026-10-15', 50000), snap('cdb-b', '2026-10-31', 50100)])
      .run();
    insertTestTx(db, makeTx({ id: 'apl', accountId: 'c6', date: '2026-10-14', amountCents: -50000, description: 'APLICACAO CDB' }));
    insertTestClassification(db, makeClassification({ transactionId: 'apl', nature: 'transfer', transferKind: 'investment' }));

    // 1000 de rendimento no CDB antigo e 100 no novo; os 50000 aplicados não são rendimento.
    expect(monthlyYield(db, '2026-10', '2026-11-05')).toBe(1100);
  });
});

