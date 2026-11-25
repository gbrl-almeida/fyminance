import { describe, expect, it } from 'vitest';
import { adjustLedger, purchaseCapacityCents, type Offset, type SplitPart } from './adjustments';
import type { LedgerRow } from './summary';
import { makeClassification, makeTx } from './testing';
import type { Classification, Tx } from './types';

const row = (tx: Partial<Tx> & Pick<Tx, 'id'>, cls: Partial<Classification> = {}): LedgerRow => ({
  tx: makeTx(tx),
  cls: makeClassification({ transactionId: tx.id, ...cls }),
});

const card = { accountId: 'card', accountKind: 'credit_card' as const };
const installment = (id: string, number: number, cents: number, date: string) =>
  row({ id, ...card, date, amountCents: -cents, description: 'BUS SERVICOS*CLICKBUS', installmentNumber: number, installmentTotal: 4, purchaseDate: '2026-10-14' }, { categoryId: 14 });

const view = (rows: LedgerRow[]) => rows.map((r) => [r.tx.id, r.tx.amountCents, r.cls?.categoryId ?? null, r.cls?.owner ?? null]);

describe('adjustLedger', () => {
  it('turns a split purchase into one row per part', () => {
    const rows = [row({ id: 'shopee', amountCents: -10000 }, { categoryId: 1, reviewReason: 'low_confidence' })];
    const splits: SplitPart[] = [
      { transactionId: 'shopee', position: 0, amountCents: 6000, categoryId: 5, owner: 'pessoa2' },
      { transactionId: 'shopee', position: 1, amountCents: 4000, categoryId: 7, owner: 'casal' },
    ];
    const adjusted = adjustLedger(rows, splits, []);
    expect(view(adjusted)).toEqual([
      ['shopee', -6000, 5, 'pessoa2'],
      ['shopee', -4000, 7, 'casal'],
    ]);
    expect(adjusted.every((r) => r.cls?.reviewReason === null)).toBe(true);
    expect(adjusted.map((r) => r.adjustment)).toEqual([
      { bankCents: -10000, offsetCents: 0, part: { index: 0, count: 2 } },
      { bankCents: -10000, offsetCents: 0, part: { index: 1, count: 2 } },
    ]);
  });

  it('applies a split made on one installment to every installment of the purchase', () => {
    const rows = [installment('p1', 1, 3000, '2026-10-14'), installment('p2', 2, 3000, '2026-11-14')];
    const splits: SplitPart[] = [
      { transactionId: 'p2', position: 0, amountCents: 2000, categoryId: 5, owner: 'casal' },
      { transactionId: 'p2', position: 1, amountCents: 1000, categoryId: 7, owner: 'pessoa1' },
    ];
    expect(view(adjustLedger(rows, splits, []))).toEqual([
      ['p1', -2000, 5, 'casal'],
      ['p1', -1000, 7, 'pessoa1'],
      ['p2', -2000, 5, 'casal'],
      ['p2', -1000, 7, 'pessoa1'],
    ]);
  });

  it('drops a purchase and its refund when the refund covers it', () => {
    const rows = [row({ id: 'buy', amountCents: -5000 }), row({ id: 'refund', amountCents: 5000 })];
    expect(adjustLedger(rows, [], [{ creditId: 'refund', purchaseId: 'buy', amountCents: 5000 }])).toEqual([]);
  });

  it('counts a reimbursement in the purchase month and keeps what the credit has left', () => {
    const rows = [
      row({ id: 'tires', date: '2026-01-20', amountCents: -125000 }, { categoryId: 3 }),
      row({ id: 'pix-feb', date: '2026-02-05', amountCents: 45000 }, { nature: 'income', reviewReason: 'pix_person' }),
      row({ id: 'pix-mar', date: '2026-03-12', amountCents: 25000 }, { nature: 'income', reviewReason: 'pix_person' }),
      row({ id: 'pix-apr', date: '2026-04-24', amountCents: 50000 }, { nature: 'income', reviewReason: 'pix_person' }),
    ];
    const links: Offset[] = [
      { creditId: 'pix-feb', purchaseId: 'tires', amountCents: 45000 },
      { creditId: 'pix-mar', purchaseId: 'tires', amountCents: 25000 },
      { creditId: 'pix-apr', purchaseId: 'tires', amountCents: 20000 },
    ];
    const adjusted = adjustLedger(rows, [], links);
    expect(view(adjusted)).toEqual([
      ['tires', -35000, 3, 'casal'],
      ['pix-apr', 30000, null, 'casal'],
    ]);
    expect(adjusted[0]?.adjustment).toEqual({ bankCents: -125000, offsetCents: 90000, part: null });
    expect(adjusted[1]?.cls?.reviewReason).toBe('pix_person');
  });

  it('spends a refund on the installments in order and keeps the rest for the ones to come', () => {
    const refunds = [row({ id: 'r1', ...card, amountCents: 42000 }), row({ id: 'r2', ...card, amountCents: 42000 })];
    const links: Offset[] = [
      { creditId: 'r1', purchaseId: 'c1', amountCents: 42000 },
      { creditId: 'r2', purchaseId: 'c1', amountCents: 42000 },
    ];
    expect(adjustLedger([installment('c1', 1, 21000, '2026-10-14'), ...refunds], [], links)).toEqual([]);
    const later = [installment('c1', 1, 21000, '2026-10-14'), installment('c2', 2, 21000, '2026-11-14'), installment('c3', 3, 21000, '2026-12-14'), ...refunds];
    expect(adjustLedger(later, [], links)).toEqual([]);
  });

  it('reduces the parts of a split purchase in proportion', () => {
    const rows = [row({ id: 'buy', amountCents: -10000 }), row({ id: 'back', amountCents: 5000 })];
    const splits: SplitPart[] = [
      { transactionId: 'buy', position: 0, amountCents: 6000, categoryId: 5, owner: 'casal' },
      { transactionId: 'buy', position: 1, amountCents: 4000, categoryId: 7, owner: 'casal' },
    ];
    expect(view(adjustLedger(rows, splits, [{ creditId: 'back', purchaseId: 'buy', amountCents: 5000 }]))).toEqual([
      ['buy', -3000, 5, 'casal'],
      ['buy', -2000, 7, 'casal'],
    ]);
  });

  it('ignores links and splits on transfers', () => {
    const rows = [row({ id: 'pay', amountCents: -5000 }, { nature: 'transfer' }), row({ id: 'in', amountCents: 5000 }, { nature: 'income' })];
    const splits: SplitPart[] = [{ transactionId: 'pay', position: 0, amountCents: 5000, categoryId: 5, owner: 'casal' }];
    expect(view(adjustLedger(rows, splits, [{ creditId: 'in', purchaseId: 'pay', amountCents: 5000 }]))).toEqual([
      ['pay', -5000, null, 'casal'],
      ['in', 5000, null, 'casal'],
    ]);
  });
});

describe('purchaseCapacityCents', () => {
  it('is the whole purchase, including installments still to come', () => {
    const rows = [installment('c1', 1, 21000, '2026-10-14')];
    expect(purchaseCapacityCents(rows[0]!.tx, rows.map((r) => r.tx))).toBe(84000);
    expect(purchaseCapacityCents(makeTx({ id: 'x', amountCents: -1500 }), [])).toBe(1500);
  });
});
