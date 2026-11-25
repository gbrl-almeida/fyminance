import { describe, expect, it } from 'vitest';
import { login } from '../auth/sessions';
import { createTestDb } from '../db/testing';
import { getDashboard } from '../queries/dashboard';
import { getGoalsBoard } from '../queries/goals';
import { getInvestments } from '../queries/investments';
import { getPendingItems } from '../queries/pending';
import { DEMO_PASSWORD, seedDemo } from './demo';
import { reclassify } from './reclassify';

const TODAY = '2026-11-03';

describe('seedDemo', () => {
  it('demo month has review items, a bill divergence and goals data', () => {
    const { db } = createTestDb();
    seedDemo(db, TODAY);
    const pending = getPendingItems(db, { today: TODAY, month: '2026-10' });
    expect(pending.review.length).toBeGreaterThanOrEqual(3);
    expect(pending.billDivergences).toHaveLength(1);
    expect(getGoalsBoard(db, '2026-10', TODAY).rows.length).toBeGreaterThan(5);
  });

  it('demo has income, investments, open bill and both users', () => {
    const { db } = createTestDb();
    seedDemo(db, TODAY);
    const view = getDashboard(db, '2026-10', 'all', TODAY, '/nao-existe');
    expect(view.household?.incomeCents).toBeGreaterThan(0);
    expect(view.openBills[0]?.limitUsedPct).not.toBeNull();
    expect(view.installments.totalCents).toBeGreaterThan(0);
    const investments = getInvestments(db, '2026-10', TODAY);
    expect(investments.contributedCents).toBeGreaterThan(0);
    expect(investments.yieldCents).toBeGreaterThan(0);
    expect(investments.redemptions.month).toMatchObject({ count: 1, unsplit: 0 });
    expect(investments.redemptions.month.netCents).toBeGreaterThan(0);
    expect(investments.redemptions.rows.map((r) => r.kind)).toEqual(['redeemed', 'open']);
    expect(login(db, 'pessoa1', DEMO_PASSWORD, new Date())).not.toBeNull();
    expect(login(db, 'pessoa2', DEMO_PASSWORD, new Date())).not.toBeNull();
  });

  it('demo survives reprocessing unchanged', async () => {
    const { db } = createTestDb();
    seedDemo(db, TODAY);
    const before = { pending: getPendingItems(db, { today: TODAY, month: '2026-10' }).review.length, dash: getDashboard(db, '2026-10', 'all', TODAY, '/x') };
    await reclassify({ db, pipeline: { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() }, classifier: null, now: () => new Date() });
    expect(getPendingItems(db, { today: TODAY, month: '2026-10' }).review.length).toBe(before.pending);
    const after = getDashboard(db, '2026-10', 'all', TODAY, '/x');
    expect(after.household).toEqual(before.dash.household);
    expect(after.categories).toEqual(before.dash.categories);
    expect(getDashboard(db, '2026-10', 'pessoa1', TODAY, '/x').expenseCents).toBeGreaterThan(0);
  });
});
