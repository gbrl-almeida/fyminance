import { describe, expect, it } from 'vitest';
import { averageOverMonths, installmentsDueIn, suggestGoal } from './goals';
import type { PurchaseGroup } from './installments';

const MONTHS = ['2026-08', '2026-09', '2026-10'];

describe('goals', () => {
  it('average divides by months with data', () => {
    expect(averageOverMonths(new Map([['2026-09', 3000]]), MONTHS, '2026-09')).toBe(1500);
  });

  it('average with full history', () => {
    expect(averageOverMonths(new Map([['2026-08', 1000], ['2026-10', 2001]]), MONTHS, '2026-01')).toBe(1000);
  });

  it('average without data is zero', () => {
    expect(averageOverMonths(new Map(), MONTHS, null)).toBe(0);
    expect(averageOverMonths(new Map(), MONTHS, '2026-11')).toBe(0);
  });

  it('suggestion adds deltas and floors at zero', () => {
    expect(suggestGoal(1000, [500, 250])).toBe(1750);
    expect(suggestGoal(1000, [-2000])).toBe(0);
  });

  it('installments due in a month', () => {
    const group: PurchaseGroup = {
      key: 'k',
      accountId: 'card',
      merchantKey: 'LOJA',
      description: 'LOJA 03/10',
      purchaseMonth: '2026-08',
      installmentTotal: 10,
      installmentCents: 5000,
      totalCents: 50000,
      lastSeenNumber: 3,
      lastSeenMonth: '2026-10',
    };
    expect(installmentsDueIn([group], '2026-07')).toBe(0);
    expect(installmentsDueIn([group], '2026-08')).toBe(5000);
    expect(installmentsDueIn([group, group], '2027-05')).toBe(10000);
    expect(installmentsDueIn([group], '2027-06')).toBe(0);
  });
});
