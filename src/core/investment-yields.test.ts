import { describe, expect, it } from 'vitest';
import { computeYields, iofPct, irPerMille, rateLabel, type InvestmentMovement } from './investment-yields';

const move = (overrides: Partial<InvestmentMovement> & Pick<InvestmentMovement, 'id' | 'type' | 'date'>): InvestmentMovement => ({
  accountId: 'cdb-1',
  amountCents: 0,
  netCents: null,
  quantity: 0,
  unitValue: 1,
  ...overrides,
});

describe('tax tables', () => {
  it('follows the regressive IOF table and drops to zero at 30 days', () => {
    expect(iofPct(1)).toBe(96);
    expect(iofPct(10)).toBe(66);
    expect(iofPct(29)).toBe(3);
    expect(iofPct(30)).toBe(0);
    expect(iofPct(0)).toBe(96);
  });

  it('follows the income tax brackets by holding period', () => {
    expect(irPerMille(180)).toBe(225);
    expect(irPerMille(181)).toBe(200);
    expect(irPerMille(361)).toBe(175);
    expect(irPerMille(721)).toBe(150);
  });
});

describe('computeYields', () => {
  it('splits a full redemption into IOF, income tax and net yield', () => {
    const { redemptions, open, incomplete } = computeYields([
      move({ id: 'b', type: 'BUY', date: '2026-03-01', amountCents: 500000, quantity: 5000 }),
      move({ id: 's', type: 'SELL', date: '2026-03-21', amountCents: 503000, netCents: 501558, quantity: 5000, unitValue: 1.006 }),
    ]);
    expect(redemptions).toEqual([
      {
        movementId: 's',
        accountId: 'cdb-1',
        date: '2026-03-21',
        appliedOn: '2026-03-01',
        principalCents: 500000,
        grossCents: 3000,
        iofCents: 990,
        irCents: 452,
        taxCents: 1442,
        netCents: 1558,
      },
    ]);
    expect(open).toEqual([]);
    expect(incomplete.size).toBe(0);
  });

  it('consumes applications in order and taxes each part by its own holding period', () => {
    const { redemptions, open } = computeYields([
      move({ id: 'b2', type: 'BUY', date: '2026-02-10', amountCents: 100000, quantity: 1000 }),
      move({ id: 'b1', type: 'BUY', date: '2026-01-10', amountCents: 100000, quantity: 1000 }),
      move({ id: 's', type: 'SELL', date: '2026-02-20', amountCents: 152000, quantity: 1500, unitValue: null }),
    ]);
    expect(redemptions[0]).toMatchObject({
      appliedOn: '2026-01-10',
      principalCents: 150000,
      grossCents: 2000,
      iofCents: 440,
      irCents: 350,
      taxCents: 790,
      netCents: 1210,
    });
    expect(open).toEqual([{ accountId: 'cdb-1', appliedOn: '2026-02-10', principalCents: 50000 }]);
  });

  it('values the principal by the unit value at application', () => {
    const { redemptions } = computeYields([
      move({ id: 'b', type: 'BUY', date: '2026-01-01', amountCents: 102000, quantity: 1000, unitValue: 1.02 }),
      move({ id: 's', type: 'SELL', date: '2026-08-01', amountCents: 105000, quantity: 1000 }),
    ]);
    expect(redemptions[0]).toMatchObject({ principalCents: 102000, grossCents: 3000, iofCents: 0, irCents: 600 });
  });

  it('takes the net amount from the bank and lets income tax absorb a rounding cent', () => {
    const { redemptions } = computeYields([
      move({ id: 'b', type: 'BUY', date: '2026-03-01', amountCents: 500000, quantity: 5000 }),
      move({ id: 's', type: 'SELL', date: '2026-03-21', amountCents: 503000, netCents: 501557, quantity: 5000 }),
    ]);
    expect(redemptions[0]).toMatchObject({ iofCents: 990, irCents: 453, taxCents: 1443, netCents: 1557 });
  });

  it('trusts the bank net amount when the split does not match it', () => {
    const { redemptions } = computeYields([
      move({ id: 'b', type: 'BUY', date: '2026-03-01', amountCents: 500000, quantity: 5000 }),
      move({ id: 's', type: 'SELL', date: '2026-03-21', amountCents: 503000, netCents: 501000, quantity: 5000 }),
    ]);
    expect(redemptions[0]).toMatchObject({ grossCents: 3000, iofCents: null, irCents: null, taxCents: 2000, netCents: 1000 });
  });

  it('marks an investment incomplete when it has other movement types or sells more than it holds', () => {
    const { incomplete } = computeYields([
      move({ id: 'b', type: 'BUY', date: '2026-01-01', amountCents: 10000, quantity: 100 }),
      move({ id: 'x', type: 'TAX', date: '2026-02-01', amountCents: 50, quantity: 0 }),
      move({ id: 'b2', accountId: 'cdb-2', type: 'BUY', date: '2026-01-01', amountCents: 10000, quantity: 100 }),
      move({ id: 's2', accountId: 'cdb-2', type: 'SELL', date: '2026-02-01', amountCents: 20500, quantity: 200 }),
    ]);
    expect([...incomplete].sort()).toEqual(['cdb-1', 'cdb-2']);
  });
});

describe('rateLabel', () => {
  it('describes the rate the way the bank sells it', () => {
    expect(rateLabel({ rate: 102, rateType: 'CDI', fixedAnnualRate: 0 })).toBe('102% do CDI');
    expect(rateLabel({ rate: 101.5, rateType: 'CDI', fixedAnnualRate: null })).toBe('101,5% do CDI');
    expect(rateLabel({ rate: null, rateType: 'IPCA', fixedAnnualRate: 6 })).toBe('IPCA + 6% a.a.');
    expect(rateLabel({ rate: null, rateType: null, fixedAnnualRate: 12.5 })).toBe('12,5% a.a.');
    expect(rateLabel({ rate: null, rateType: null, fixedAnnualRate: null })).toBeNull();
  });
});
