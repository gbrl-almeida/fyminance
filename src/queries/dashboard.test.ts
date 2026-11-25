import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveGoals } from '../curation/goals';
import { balanceSnapshots } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount } from '../db/testing';
import { getDashboard } from './dashboard';
import { buildLedgerFixture, FIXTURE_TODAY } from './test-fixture';

const ctx = { now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa1' as const };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const { db } = createTestDb();
  buildLedgerFixture(db);
  const dataDir = mkdtempSync(join(tmpdir(), 'fyminance-dash-'));
  dirs.push(dataDir);
  return { db, dataDir };
}

const category = (view: ReturnType<typeof getDashboard>, name: string) => view.categories.find((c) => c.name === name);

describe('dashboard', () => {
  it('household numbers for the couple', () => {
    const { db, dataDir } = setup();
    const view = getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir);
    expect(view.household).toMatchObject({ incomeCents: 900000, expenseCents: 357880, surplusCents: 542120 });
    expect(view.household?.savingsRate).toBeCloseTo(542120 / 900000);
    expect(view.expenseCents).toBe(357880);
  });

  it('household numbers hidden when filtering by person', () => {
    const { db, dataDir } = setup();
    expect(getDashboard(db, '2026-10', 'pessoa1', FIXTURE_TODAY, dataDir).household).toBeNull();
  });

  it("filter keeps only that owner's expenses", () => {
    const { db, dataDir } = setup();
    const view = getDashboard(db, '2026-10', 'pessoa1', FIXTURE_TODAY, dataDir);
    expect(view.expenseCents).toBe(19990);
    expect(view.categories.map((c) => c.name)).toEqual(['Lazer']);
  });

  it('average over previous three months', () => {
    const { db, dataDir } = setup();
    const view = getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir);
    // Histórico começa em setembro: a média divide só por setembro.
    expect(category(view, 'Alimentação')).toMatchObject({ cents: 29590, averageCents: 6000 });
    expect(category(view, 'Alimentação')?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Delivery', cents: 4590, averageCents: 6000 })]),
    );
    expect(category(view, 'Casa')).toMatchObject({ cents: 50000, averageCents: 50000 });
    expect(view.household?.averageSurplusCents).toBe(-56000);
  });

  it('savings rate null without income', () => {
    const { db, dataDir } = setup();
    expect(getDashboard(db, '2026-09', 'all', FIXTURE_TODAY, dataDir).household?.savingsRate).toBeNull();
  });

  it('goal shown when the month has goals', () => {
    const { db, dataDir } = setup();
    saveGoals(db, '2026-10', [{ categoryId: categoryIdByName(db, 'Alimentação'), cents: 30000, note: null }], null, ctx);
    expect(category(getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir), 'Alimentação')?.goalCents).toBe(30000);
    expect(category(getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir), 'Casa')?.goalCents).toBeNull();
  });

  it('open bill reads limit from raw creditData', () => {
    const { db, dataDir } = setup();
    const raw = JSON.stringify({ creditData: { creditLimit: 21000, availableCreditLimit: 14700, balanceDueDate: '2026-11-15T03:00:00.000Z' } });
    insertTestAccount(db, { id: 'carbon', kind: 'credit_card', name: 'C6 · Carbon', raw });
    db.insert(balanceSnapshots).values({ accountId: 'carbon', date: '2026-10-14', takenAt: '2026-10-14T10:00:00.000Z', balanceCents: 623000 }).run();
    const bill = getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir).openBills.find((b) => b.accountId === 'carbon');
    expect(bill).toEqual({ accountId: 'carbon', name: 'C6 · Carbon', cents: 623000, dueDate: '2026-11-15', limitUsedPct: 0.3 });
  });

  it('card without creditData has null limit', () => {
    const { db, dataDir } = setup();
    db.insert(balanceSnapshots).values({ accountId: 'c6-card', date: '2026-10-14', takenAt: '2026-10-14T10:00:00.000Z', balanceCents: 100000 }).run();
    expect(getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir).openBills).toEqual([
      { accountId: 'c6-card', name: 'C6 · Cartão', cents: 100000, dueDate: null, limitUsedPct: null },
    ]);
  });

  it('closing card points to the previous month', () => {
    const { db, dataDir } = setup();
    expect(getDashboard(db, '2026-10', 'all', FIXTURE_TODAY, dataDir).closing?.month).toBe('2026-09');
  });
});
