import { describe, expect, it } from 'vitest';
import { investmentMovements } from '../db/schema';
import { createTestDb, insertTestAccount } from '../db/testing';
import { getInvestments } from './investments';
import { buildMonthReport } from './report';

const TODAY = '2026-10-22';

function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'cdb', kind: 'investment', name: 'C6 · CDB' });
  const base = { accountId: 'cdb', unitValue: 1, raw: '{}', firstSeenAt: TODAY, updatedAt: TODAY };
  db.insert(investmentMovements)
    .values([
      { ...base, id: 'buy', date: '2026-03-01', type: 'BUY', amountCents: 500000, netCents: null, quantity: 5000 },
      { ...base, id: 'sell', date: '2026-03-21', type: 'SELL', amountCents: 503000, netCents: 501558, quantity: 5000 },
    ])
    .run();
  return db;
}

describe('redemption yields in the month views', () => {
  it('come with the investments of the month', () => {
    expect(getInvestments(setup(), '2026-03', TODAY).redemptions.month).toMatchObject({ count: 1, netCents: 1558 });
  });

  it('get a line in the month report', () => {
    expect(buildMonthReport(setup(), '2026-03', TODAY)).toContain(
      '- Rendimento dos resgates: R$ 15,58 líquido (bruto R$ 30,00; IOF R$ 9,90 e IR R$ 4,52, 48,1% de imposto)',
    );
    expect(buildMonthReport(setup(), '2026-04', TODAY)).not.toContain('Rendimento dos resgates');
  });
});
