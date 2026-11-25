import { describe, expect, it } from 'vitest';
import {
  buildPurchaseGroups,
  newInstallmentPurchases,
  purchaseGroupKey,
  purchaseMonthOf,
  upcomingInstallments,
  type PurchaseGroup,
} from './installments';
import { makeTx } from './testing';
import type { TxStatus } from './types';

const tv = (id: string, number: number, date: string, cents: number, status: TxStatus = 'posted') =>
  makeTx({
    id,
    accountId: 'card',
    accountKind: 'credit_card',
    description: 'LOJA TV',
    date,
    amountCents: -cents,
    installmentNumber: number,
    installmentTotal: 3,
    status,
  });

const group: PurchaseGroup = {
  key: 'card|LOJA TV|2026-07|10',
  accountId: 'card',
  merchantKey: 'LOJA TV',
  description: 'LOJA TV',
  purchaseMonth: '2026-07',
  installmentTotal: 10,
  installmentCents: 10000,
  totalCents: 100000,
  lastSeenNumber: 4,
  lastSeenMonth: '2026-10',
};

describe('purchase groups', () => {
  it('only groups purchases split in two or more installments', () => {
    expect(purchaseGroupKey(makeTx({ id: 'a' }))).toBeNull();
    expect(purchaseGroupKey(makeTx({ id: 'b', installmentNumber: 1, installmentTotal: 1 }))).toBeNull();
  });

  it('infers the purchase month from the installment number when the bank omits it', () => {
    const tx = makeTx({
      id: 'c',
      accountId: 'card',
      date: '2026-10-05',
      description: 'LOJA TV',
      installmentNumber: 3,
      installmentTotal: 10,
    });
    expect(purchaseMonthOf(tx)).toBe('2026-08');
    expect(purchaseGroupKey(tx)).toBe('card|LOJA TV|2026-08|10');
  });

  it('prefers the purchase date reported by the bank', () => {
    const tx = makeTx({ id: 'd', date: '2026-10-05', installmentNumber: 3, installmentTotal: 10, purchaseDate: '2026-07-30' });
    expect(purchaseMonthOf(tx)).toBe('2026-07');
  });

  it('builds one group per purchase, valued by a non-first installment', () => {
    for (const order of [
      [tv('t1', 1, '2026-09-10', 3334), tv('t2', 2, '2026-10-10', 3333)],
      [tv('t2', 2, '2026-10-10', 3333), tv('t1', 1, '2026-09-10', 3334)],
    ]) {
      const groups = buildPurchaseGroups(order, '2026-10-14');
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        key: 'card|LOJA TV|2026-09|3',
        purchaseMonth: '2026-09',
        installmentTotal: 3,
        installmentCents: 3333,
        totalCents: 9999,
        lastSeenNumber: 2,
        lastSeenMonth: '2026-10',
      });
    }
  });

  it('ignores installments dated after today, removed ones and inflows', () => {
    const groups = buildPurchaseGroups(
      [
        tv('t1', 1, '2026-09-10', 3333),
        tv('t2', 2, '2026-10-10', 3333, 'removed'),
        tv('t3', 3, '2026-11-10', 3333, 'pending'),
        makeTx({ id: 'refund', accountId: 'card', description: 'LOJA TV', amountCents: 3333, installmentNumber: 2, installmentTotal: 3 }),
      ],
      '2026-10-14',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lastSeenNumber).toBe(1);
  });
});

describe('upcomingInstallments', () => {
  it('spreads the remaining installments over the next months', () => {
    const months = upcomingInstallments([group], '2026-10');
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: '2026-10', cents: 0 });
    expect(months.slice(1, 7).every((m) => m.cents === 10000)).toBe(true);
    expect(months[7]).toEqual({ month: '2027-05', cents: 0 });
    expect(months.reduce((sum, m) => sum + m.cents, 0)).toBe(60000);
  });

  it('counts this month when its installment has not posted yet', () => {
    const months = upcomingInstallments([{ ...group, lastSeenMonth: '2026-09' }], '2026-10');
    expect(months[0]).toEqual({ month: '2026-10', cents: 10000 });
    expect(months.reduce((sum, m) => sum + m.cents, 0)).toBe(60000);
  });

  it('respects the horizon', () => {
    expect(upcomingInstallments([group], '2026-10', 3).map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12']);
  });
});

describe('newInstallmentPurchases', () => {
  it('lists the purchases made in a month', () => {
    expect(newInstallmentPurchases([group], '2026-07')).toEqual([group]);
    expect(newInstallmentPurchases([group], '2026-08')).toEqual([]);
  });
});
