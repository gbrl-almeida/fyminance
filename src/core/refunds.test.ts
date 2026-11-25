import { describe, expect, it } from 'vitest';
import { findRefundTargets } from './refunds';
import { makeTx } from './testing';
import type { Tx } from './types';

const card = (overrides: Partial<Tx> & Pick<Tx, 'id'>) => makeTx({ accountId: 'card', accountKind: 'credit_card', ...overrides });
const refund = card({ id: 'refund', date: '2026-10-14', amountCents: 42000, description: 'Refund' });
const clickbus = (id: string, number: number, date: string) =>
  card({ id, date, amountCents: -21000, description: 'BUS SERVICOS*CLICKBUS', installmentNumber: number, installmentTotal: 4, purchaseDate: '2026-10-14' });

describe('findRefundTargets', () => {
  it('finds a purchase on the same card with the same value', () => {
    const buy = card({ id: 'buy', date: '2026-09-20', amountCents: -42000 });
    const otherCard = makeTx({ id: 'other', accountId: 'card-2', accountKind: 'credit_card', date: '2026-09-20', amountCents: -42000 });
    expect(findRefundTargets(refund, [buy, otherCard, refund]).map((t) => t.id)).toEqual(['buy']);
  });

  it('matches a whole number of installments or the whole installment purchase', () => {
    expect(findRefundTargets(refund, [clickbus('c1', 1, '2026-10-14'), refund]).map((t) => t.id)).toEqual(['c1']);
    const whole = card({ id: 'whole', date: '2026-10-14', amountCents: 84000, description: 'Refund' });
    expect(findRefundTargets(whole, [clickbus('c1', 1, '2026-10-14'), clickbus('c2', 2, '2026-11-14')]).map((t) => t.id)).toEqual(['c1']);
  });

  it('ignores purchases older than 120 days or after the credit, and credits outside the card', () => {
    const old = card({ id: 'old', date: '2026-06-01', amountCents: -42000 });
    const after = card({ id: 'after', date: '2026-10-20', amountCents: -42000 });
    expect(findRefundTargets(refund, [old, after])).toEqual([]);
    const pix = makeTx({ id: 'pix', date: '2026-10-14', amountCents: 42000 });
    expect(findRefundTargets(pix, [card({ id: 'buy', date: '2026-10-01', amountCents: -42000, accountId: 'checking-1' })])).toEqual([]);
  });

  it('lists the most recent purchase first', () => {
    const a = card({ id: 'a', date: '2026-09-01', amountCents: -42000 });
    const b = card({ id: 'b', date: '2026-10-10', amountCents: -42000 });
    expect(findRefundTargets(refund, [a, b]).map((t) => t.id)).toEqual(['b', 'a']);
  });
});
