import { describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { balanceSnapshots, investmentMovements } from '../db/schema';
import { createTestDb, insertTestAccount } from '../db/testing';
import { getRedemptionYields } from './redemption-yields';

const TODAY = '2026-10-22';

function movement(db: Db, id: string, accountId: string, date: string, type: string, amountCents: number, quantity: number, netCents: number | null = null) {
  db.insert(investmentMovements)
    .values({ id, accountId, date, type, amountCents, netCents, quantity, unitValue: 1, raw: '{}', firstSeenAt: TODAY, updatedAt: TODAY })
    .run();
}

function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'cdb-a', kind: 'investment', name: 'C6 · CDB - BANCO EXEMPLO', raw: JSON.stringify({ rate: 102, rateType: 'CDI' }) });
  insertTestAccount(db, { id: 'cdb-b', kind: 'investment', owner: 'pessoa2', name: 'Inter · CDB', raw: JSON.stringify({ rateType: 'IPCA', fixedAnnualRate: 6 }) });
  movement(db, 'a-buy-jan', 'cdb-a', '2026-01-05', 'BUY', 200000, 2000);
  movement(db, 'a-sell-jan', 'cdb-a', '2026-01-25', 'SELL', 201000, 2000, 200520);
  movement(db, 'a-buy-mar', 'cdb-a', '2026-03-01', 'BUY', 500000, 5000);
  movement(db, 'a-sell-mar', 'cdb-a', '2026-03-21', 'SELL', 503000, 5000, 501558);
  movement(db, 'b-buy', 'cdb-b', '2026-02-10', 'BUY', 1000000, 10000);
  db.insert(balanceSnapshots).values({ accountId: 'cdb-b', date: '2026-03-31', takenAt: '2026-03-31T10:00:00.000Z', balanceCents: 1010000 }).run();
  return db;
}

describe('getRedemptionYields', () => {
  it('totals the month and the year by the redemption date', () => {
    const view = getRedemptionYields(setup(), '2026-03', TODAY);
    expect(view.month).toEqual({ count: 1, grossCents: 3000, iofCents: 990, irCents: 452, taxCents: 1442, netCents: 1558, taxPct: 1442 / 3000, unsplit: 0 });
    expect(view.year).toMatchObject({ count: 2, grossCents: 4000, iofCents: 1320, irCents: 602, taxCents: 1922, netCents: 2078 });
  });

  it('lists the redemptions of the month and what was still applied at its end', () => {
    const view = getRedemptionYields(setup(), '2026-03', TODAY);
    expect(view.rows).toEqual([
      {
        kind: 'redeemed',
        accountId: 'cdb-a',
        account: 'C6 · CDB - BANCO EXEMPLO',
        rate: '102% do CDI',
        appliedOn: '2026-03-01',
        date: '2026-03-21',
        principalCents: 500000,
        grossCents: 3000,
        iofCents: 990,
        irCents: 452,
        taxCents: 1442,
        netCents: 1558,
      },
      { kind: 'open', accountId: 'cdb-b', account: 'Inter · CDB', rate: 'IPCA + 6% a.a.', appliedOn: '2026-02-10', principalCents: 1000000, accruedCents: 10000 },
    ]);
    expect(getRedemptionYields(setup(), '2026-01', TODAY).rows.map((r) => [r.kind, r.accountId])).toEqual([['redeemed', 'cdb-a']]);
  });

  it('leaves the accrued value out when there is no balance for the date', () => {
    const view = getRedemptionYields(setup(), '2026-02', TODAY);
    expect(view.rows).toEqual([expect.objectContaining({ kind: 'open', accountId: 'cdb-b', accruedCents: null })]);
    expect(view.month).toMatchObject({ count: 0, grossCents: 0, taxPct: null });
  });

  it('names the investments the calculation does not cover', () => {
    const db = setup();
    movement(db, 'b-tax', 'cdb-b', '2026-03-05', 'TAX', 500, 0);
    expect(getRedemptionYields(db, '2026-03', TODAY).incomplete).toEqual(['Inter · CDB']);
  });
});
