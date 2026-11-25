import { describe, expect, it } from 'vitest';
import { confirmCheck } from '../curation/closing';
import { createManualEntry, setVoucherSpend } from '../curation/manual';
import { categoryIdByName, createTestDb } from '../db/testing';
import { ensureVoucher } from '../jobs/voucher';
import { getOutsidePluggy } from './closing';
import { getPendingItems } from './pending';
import { buildLedgerFixture, FIXTURE_TODAY } from './test-fixture';
import { categorize } from '../curation/categorize';

const pipeline = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set<string>() };
const ctx = { pipeline, now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa2' as const };

describe('outside pluggy', () => {
  it('shows vale-alimentação, cash confirmation and manual entries of the month', async () => {
    const { db } = createTestDb();
    expect(getOutsidePluggy(db, '2026-10')).toEqual({ flash: null, cashConfirmedBy: null, entries: [] });
    ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: '2026-10-14T10:00:00.000Z' });
    expect(getOutsidePluggy(db, '2026-10').flash).toEqual({ cents: 80000, confirmedBy: null });
    setVoucherSpend(db, '2026-10', 110000, ctx);
    confirmCheck(db, '2026-10', 'cash', { ...ctx, actor: 'pessoa1' });
    await createManualEntry(db, { date: '2026-10-09', amountCents: 2500, description: 'Feira', nature: 'expense', categoryId: categoryIdByName(db, 'Mercado'), owner: 'casal' }, ctx);
    await createManualEntry(db, { date: '2026-09-30', amountCents: 999, description: 'Outro mês', nature: 'expense', categoryId: categoryIdByName(db, 'Mercado'), owner: 'casal' }, ctx);
    const view = getOutsidePluggy(db, '2026-10');
    expect(view.flash).toEqual({ cents: 110000, confirmedBy: 'pessoa2' });
    expect(view.cashConfirmedBy).toBe('pessoa1');
    expect(view.entries).toEqual([
      expect.objectContaining({ date: '2026-10-09', description: 'Feira', amountCents: -2500, createdBy: 'pessoa2', category: 'Alimentação > Mercado', account: 'Lançamentos manuais' }),
    ]);
  });

  it('review groups carry the id of the suggested category', async () => {
    const { db } = createTestDb();
    buildLedgerFixture(db);
    await categorize(db, { target: { transactionIds: ['unknown'] }, categoryId: categoryIdByName(db, 'Casa'), scope: 'only_these' }, ctx);
    db.$client.prepare("UPDATE classifications SET review_reason = 'low_confidence', source = 'model', confidence = 'medium' WHERE transaction_id = 'unknown'").run();
    const group = getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-10' }).review.find((g) => g.merchantKey === 'LOJA XPTO');
    expect(group).toMatchObject({ suggestedCategory: 'Casa', suggestedCategoryId: categoryIdByName(db, 'Casa') });
  });
});
