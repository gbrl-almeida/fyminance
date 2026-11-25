import { describe, expect, it } from 'vitest';
import { balanceSnapshots } from '../db/schema';
import { createTestDb } from '../db/testing';
import { getPendingItems } from '../queries/pending';
import { buildLedgerFixture, FIXTURE_TODAY } from '../queries/test-fixture';
import { explainDivergence } from './divergences';

const ctx = { now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa1' as const };

function fixture() {
  const { db } = createTestDb();
  buildLedgerFixture(db);
  return db;
}

describe('divergence explanations', () => {
  it('explained bill divergence carries the note', () => {
    const db = fixture();
    const [bill] = getPendingItems(db, { today: FIXTURE_TODAY }).billDivergences;
    expect(bill?.key).toBe('bill:bill-2');
    expect(bill?.explanation).toBeNull();
    explainDivergence(db, 'bill:bill-2', 'IOF lançado depois', ctx);
    expect(getPendingItems(db, { today: FIXTURE_TODAY }).billDivergences[0]?.explanation).toEqual({
      note: 'IOF lançado depois',
      by: 'pessoa1',
      at: '2026-10-14T10:00:00.000Z',
    });
  });

  it('explaining again replaces the note, and an empty note is allowed', () => {
    const db = fixture();
    explainDivergence(db, 'bill:bill-2', 'primeira', ctx);
    explainDivergence(db, 'bill:bill-2', '', { ...ctx, actor: 'pessoa2' });
    expect(getPendingItems(db, { today: FIXTURE_TODAY }).billDivergences[0]?.explanation).toMatchObject({ note: '', by: 'pessoa2' });
  });

  it('balance explanation expires when the diff changes', () => {
    const db = fixture();
    const snap = (date: string, balanceCents: number) =>
      db.insert(balanceSnapshots).values({ accountId: 'c6-checking', date, takenAt: `${date}T10:00:00.000Z`, balanceCents }).run();
    snap('2026-10-15', 410000);
    snap('2026-10-16', 410000);
    const [gap] = getPendingItems(db, { today: '2026-10-16' }).balanceDivergences;
    expect(gap?.key).toBe('balance:c6-checking:2026-10-13:-5000');
    explainDivergence(db, gap?.key ?? '', 'tarifa não importada', ctx);
    expect(getPendingItems(db, { today: '2026-10-16' }).balanceDivergences[0]?.explanation?.note).toBe('tarifa não importada');
    snap('2026-10-17', 405000);
    snap('2026-10-18', 405000);
    const [later] = getPendingItems(db, { today: '2026-10-18' }).balanceDivergences;
    expect(later?.key).toBe('balance:c6-checking:2026-10-13:-10000');
    expect(later?.explanation).toBeNull();
  });
});
