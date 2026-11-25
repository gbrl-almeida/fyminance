import { describe, expect, it } from 'vitest';
import { balanceDivergence, billDivergences, type Snapshot } from './reconciliation';
import { makeTx } from './testing';

const snap = (date: string, balanceCents: number, takenAt = `${date}T10:00:00.000Z`): Snapshot => ({
  accountId: 'c6',
  date,
  takenAt,
  balanceCents,
});
const tx = (id: string, date: string, amountCents: number, status: 'posted' | 'pending' = 'posted') =>
  makeTx({ id, accountId: 'c6', date, amountCents, status });

describe('balanceDivergence', () => {
  const txs = [tx('a', '2026-10-01', -10000), tx('b', '2026-10-02', 5000)];

  it('finds nothing when balances follow the transactions', () => {
    const snapshots = [snap('2026-10-01', 100000), snap('2026-10-02', 90000), snap('2026-10-03', 95000)];
    expect(balanceDivergence(snapshots, txs)).toBeNull();
  });

  it('reports a gap that persists for two syncs', () => {
    const snapshots = [snap('2026-10-01', 100000), snap('2026-10-02', 90000), snap('2026-10-03', 95000), snap('2026-10-04', 95000)];
    expect(balanceDivergence(snapshots, [tx('a', '2026-10-01', -10000)])).toEqual({
      accountId: 'c6',
      sinceDate: '2026-10-01',
      asOfDate: '2026-10-04',
      diffCents: 5000,
    });
  });

  it('ignores a gap seen only in the latest sync', () => {
    const snapshots = [snap('2026-10-01', 100000), snap('2026-10-02', 90000), snap('2026-10-03', 95000), snap('2026-10-04', 93000)];
    expect(balanceDivergence(snapshots, [...txs, tx('c', '2026-10-04', -2000)])).toBeNull();
  });

  it('ignores an offset already present at the first comparison', () => {
    // O saldo do dia 01 já inclui o Pix do próprio dia 01: a diferença é constante e não é divergência.
    const snapshots = [snap('2026-10-01', 95000), snap('2026-10-02', 95000), snap('2026-10-03', 95000), snap('2026-10-04', 95000)];
    expect(balanceDivergence(snapshots, [tx('pix', '2026-10-01', -5000)])).toBeNull();
  });

  it('needs at least three days of balances', () => {
    expect(balanceDivergence([snap('2026-10-01', 100000), snap('2026-10-02', 1)], txs)).toBeNull();
  });

  it('uses the last balance of each day and only posted transactions', () => {
    const snapshots = [
      snap('2026-10-01', 100000),
      snap('2026-10-02', 1, '2026-10-02T09:00:00.000Z'),
      snap('2026-10-02', 90000, '2026-10-02T20:00:00.000Z'),
      snap('2026-10-03', 95000),
    ];
    expect(balanceDivergence(snapshots, [...txs, tx('p', '2026-10-02', -777, 'pending')])).toBeNull();
  });
});

describe('billDivergences', () => {
  const bill = { id: 'bill-1', accountId: 'card', dueDate: '2026-10-15', totalCents: 9000 };
  const charges = [
    makeTx({ id: 'c1', accountId: 'card', billId: 'bill-1', amountCents: -10000 }),
    makeTx({ id: 'c2', accountId: 'card', billId: 'bill-1', amountCents: 1000 }),
    makeTx({ id: 'pay', accountId: 'card', billId: 'bill-1', amountCents: 50000 }),
    makeTx({ id: 'gone', accountId: 'card', billId: 'bill-1', amountCents: -999, status: 'removed' }),
  ];

  it('matches when purchases minus refunds equal the bill total', () => {
    expect(billDivergences([bill], charges, new Set(['pay']))).toEqual([]);
  });

  it('reports the difference otherwise', () => {
    expect(billDivergences([{ ...bill, totalCents: 9500 }], charges, new Set(['pay']))).toEqual([
      { ...bill, totalCents: 9500, computedCents: 9000, diffCents: 500 },
    ]);
  });

  it('reports bills without any transaction', () => {
    expect(billDivergences([{ ...bill, id: 'bill-2' }], charges, new Set(['pay']))[0]?.computedCents).toBe(0);
  });
});
