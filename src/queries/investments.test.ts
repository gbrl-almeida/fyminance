import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeClassification, makeTx } from '../core/testing';
import { setCountsAsInvestment, setLedgerWindow } from '../curation/accounts';
import { saveInvestmentGoal } from '../curation/goals';
import { accounts, balanceSnapshots, connections } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import { countsAsInvestment, getInvestments } from './investments';

const ctx = { now: () => new Date('2026-11-02T10:00:00.000Z'), actor: 'pessoa1' as const };
const TODAY = '2026-11-02';

function setup() {
  const { db } = createTestDb();
  db.insert(connections)
    .values([
      { id: 'item-c6', owner: 'pessoa1', institution: 'C6', status: 'UPDATED' },
      { id: 'item-inter', owner: 'pessoa2', institution: 'Inter', status: 'UPDATED' },
    ])
    .run();
  insertTestAccount(db, { id: 'c6-chk', kind: 'checking', name: 'C6 · Conta', connectionId: 'item-c6' });
  insertTestAccount(db, { id: 'c6-cdb', kind: 'investment', name: 'C6 · CDB', connectionId: 'item-c6' });
  insertTestAccount(db, { id: 'inter-chk', kind: 'checking', owner: 'pessoa2', name: 'Inter · Conta', connectionId: 'item-inter' });
  insertTestAccount(db, { id: 'inter-cdb', kind: 'investment', owner: 'pessoa2', name: 'Inter · CDB', connectionId: 'item-inter' });
  const snap = (accountId: string, date: string, balanceCents: number) =>
    db.insert(balanceSnapshots).values({ accountId, date, takenAt: `${date}T10:00:00.000Z`, balanceCents }).run();
  snap('c6-cdb', '2026-10-01', 100000);
  snap('c6-cdb', '2026-11-01', 120000);
  snap('inter-cdb', '2026-10-01', 1000000);
  snap('inter-cdb', '2026-11-01', 1048000);
  const move = (id: string, accountId: string, date: string, amountCents: number, description: string) => {
    insertTestTx(db, makeTx({ id, accountId, date, amountCents, description }));
    insertTestClassification(db, makeClassification({ transactionId: id, nature: 'transfer', transferKind: 'investment', source: 'system' }));
  };
  move('c6-apply', 'c6-chk', '2026-10-05', -20000, 'APLICACAO CDB');
  move('inter-apply', 'inter-chk', '2026-10-06', -50000, 'APLICACAO');
  move('inter-redeem', 'inter-chk', '2026-10-20', 10000, 'RESGATE');
  insertTestTx(db, makeTx({ id: 'salary', accountId: 'inter-chk', date: '2026-10-01', amountCents: 300000, description: 'SALARIO' }));
  insertTestClassification(db, makeClassification({ transactionId: 'salary', nature: 'income', categoryId: categoryIdByName(db, 'Salário'), source: 'rule' }));
  return db;
}

describe('investments', () => {
  it('C6 CDB does not count by default', () => {
    expect(countsAsInvestment({ countsAsInvestment: null, institution: 'C6' })).toBe(false);
    expect(countsAsInvestment({ countsAsInvestment: null, institution: 'Inter' })).toBe(true);
    expect(countsAsInvestment({ countsAsInvestment: null, institution: null })).toBe(true);
    const view = getInvestments(setup(), '2026-10', TODAY);
    expect(view.accounts).toEqual([
      { id: 'c6-cdb', name: 'C6 · CDB', balanceCents: 120000, counts: false },
      { id: 'inter-cdb', name: 'Inter · CDB', balanceCents: 1048000, counts: true },
    ]);
  });

  it('explicit flag overrides the default', () => {
    const db = setup();
    setCountsAsInvestment(db, 'c6-cdb', true, ctx);
    setCountsAsInvestment(db, 'inter-cdb', false, ctx);
    expect(countsAsInvestment({ countsAsInvestment: true, institution: 'C6' })).toBe(true);
    const view = getInvestments(db, '2026-10', TODAY);
    expect(view.totalCents).toBe(120000);
    expect(view.contributions.map((c) => c.account)).toEqual(['C6 · Conta']);
  });

  it('contributions only from connections with counting accounts', () => {
    const view = getInvestments(setup(), '2026-10', TODAY);
    expect(view.contributions).toEqual([{ date: '2026-10-06', account: 'Inter · Conta', cents: 50000 }]);
    expect(view.withdrawals).toEqual([{ date: '2026-10-20', account: 'Inter · Conta', cents: 10000 }]);
    expect(view.contributedCents).toBe(50000);
  });

  it('total and yield only over counting accounts', () => {
    const view = getInvestments(setup(), '2026-10', TODAY);
    expect(view.totalCents).toBe(1048000);
    expect(view.yieldCents).toBe(8000);
  });

  it('yield pct uses the opening balance', () => {
    expect(getInvestments(setup(), '2026-10', TODAY).yieldPct).toBeCloseTo(0.008);
  });

  it('goal comes from the month plan and surplus from the month', () => {
    const db = setup();
    expect(getInvestments(db, '2026-10', TODAY).goalCents).toBeNull();
    saveInvestmentGoal(db, '2026-10', 30000, ctx);
    expect(getInvestments(db, '2026-10', TODAY)).toMatchObject({ goalCents: 30000, surplusCents: 300000 });
  });

  it('ledger window can be set and cleared for an account', () => {
    const db = setup();
    setLedgerWindow(db, 'c6-chk', { from: '2026-09-01', until: null }, ctx);
    expect(db.select().from(accounts).where(eq(accounts.id, 'c6-chk')).get()).toMatchObject({ ledgerFrom: '2026-09-01', ledgerUntil: null });
    expect(() => setLedgerWindow(db, 'nada', { from: null, until: null }, ctx)).toThrow('Conta não encontrada: nada');
    expect(() => setLedgerWindow(db, 'c6-chk', { from: '2026-10-01', until: '2026-09-01' }, ctx)).toThrow('O início precisa ser antes do fim.');
  });
});
