import { describe, expect, it } from 'vitest';
import { pairTransfers, transferKindFor } from './pairing';
import { makeTx } from './testing';

const options = { windowDays: 3, householdDocuments: new Set(['11111111111', '22222222222']) };

describe('pairTransfers', () => {
  it('pairs an outflow with an inflow of the same amount in another account', () => {
    const out = makeTx({ id: 'out', accountId: 'c6', amountCents: -50000, date: '2026-10-01' });
    const inflow = makeTx({ id: 'in', accountId: 'inter', amountCents: 50000, date: '2026-10-03' });
    const pairs = pairTransfers([out, inflow], options);
    expect(pairs.get('out')).toEqual({ pairId: 'in', kind: 'internal' });
    expect(pairs.get('in')).toEqual({ pairId: 'out', kind: 'internal' });
  });

  it('names bill payments and investment moves', () => {
    expect(transferKindFor('checking', 'credit_card')).toBe('bill_payment');
    expect(transferKindFor('investment', 'checking')).toBe('investment');
    expect(transferKindFor('checking', 'checking')).toBe('internal');
  });

  it('does not pair within the same account, beyond the window or with different amounts', () => {
    const out = makeTx({ id: 'out', accountId: 'c6', amountCents: -50000, date: '2026-10-01' });
    const sameAccount = makeTx({ id: 'a', accountId: 'c6', amountCents: 50000, date: '2026-10-01' });
    const tooLate = makeTx({ id: 'b', accountId: 'inter', amountCents: 50000, date: '2026-10-05' });
    const otherAmount = makeTx({ id: 'c', accountId: 'inter', amountCents: 50001, date: '2026-10-01' });
    expect(pairTransfers([out, sameAccount, tooLate, otherAmount], options).size).toBe(0);
  });

  it('uses each inflow once, giving it to the earliest outflow', () => {
    const first = makeTx({ id: 'first', accountId: 'c6', amountCents: -10000, date: '2026-10-01' });
    const second = makeTx({ id: 'second', accountId: 'nubank', amountCents: -10000, date: '2026-10-02' });
    const inflow = makeTx({ id: 'in', accountId: 'inter', amountCents: 10000, date: '2026-10-02' });
    const pairs = pairTransfers([second, inflow, first], options);
    expect(pairs.get('first')?.pairId).toBe('in');
    expect(pairs.has('second')).toBe(false);
  });

  it('prefers the closest inflow in time', () => {
    const out = makeTx({ id: 'out', accountId: 'c6', amountCents: -7000, date: '2026-10-05' });
    const far = makeTx({ id: 'far', accountId: 'inter', amountCents: 7000, date: '2026-10-02' });
    const near = makeTx({ id: 'near', accountId: 'nubank', amountCents: 7000, date: '2026-10-06' });
    expect(pairTransfers([out, far, near], options).get('out')?.pairId).toBe('near');
  });

  it('ignores removed transactions and the voucher account', () => {
    const out = makeTx({ id: 'out', accountId: 'c6', amountCents: -3000, status: 'removed' });
    const inflow = makeTx({ id: 'in', accountId: 'inter', amountCents: 3000 });
    const voucherIn = makeTx({ id: 'v', accountId: 'manual:flash', accountKind: 'voucher', amountCents: 3000 });
    const voucherOut = makeTx({ id: 'v2', accountId: 'c6', amountCents: -3000 });
    const pairs = pairTransfers([out, inflow, voucherIn, voucherOut], options);
    expect(pairs.has('out')).toBe(false);
    expect(pairs.has('v')).toBe(false);
    expect(pairs.get('v2')?.pairId).toBe('in');
  });

  it('refuses to pair when a side has a document from outside the household', () => {
    const toFriend = makeTx({
      id: 'friend',
      accountId: 'c6',
      amountCents: -10000,
      counterpartDocType: 'cpf',
      counterpartDoc: '99999999999',
    });
    const pessoa2Receives = makeTx({ id: 'pessoa2', accountId: 'inter', amountCents: 10000 });
    expect(pairTransfers([toFriend, pessoa2Receives], options).size).toBe(0);

    const toPessoa2 = makeTx({
      id: 'to-pessoa2',
      accountId: 'c6',
      amountCents: -10000,
      counterpartDocType: 'cpf',
      counterpartDoc: '22222222222',
    });
    expect(pairTransfers([toPessoa2, pessoa2Receives], options).get('to-pessoa2')?.pairId).toBe('pessoa2');
  });
});

describe('pairTransfers with bill payments', () => {
  const issuer = { counterpartDocType: 'cnpj' as const, counterpartDoc: '33333333000133' };

  it('pairs a checking outflow to the card issuer with the payment received on the card', () => {
    const toIssuer = makeTx({ id: 'out', accountId: 'c6', amountCents: -500000, description: 'C6 BANK', ...issuer });
    const received = makeTx({
      id: 'in',
      accountId: 'c6-card',
      accountKind: 'credit_card',
      amountCents: 500000,
      description: 'Inclusao de Pagamento Ciclo Corrente',
    });
    expect(pairTransfers([toIssuer, received], options).get('out')).toEqual({ pairId: 'in', kind: 'bill_payment' });
  });

  it('does not pair a payment to a company with a card refund or a checking inflow', () => {
    const boleto = makeTx({ id: 'out', accountId: 'c6', amountCents: -7900, ...issuer });
    const refund = makeTx({ id: 'refund', accountId: 'c6-card', accountKind: 'credit_card', amountCents: 7900, description: 'ESTORNO LOJA' });
    const pixIn = makeTx({ id: 'pix', accountId: 'nubank', amountCents: 7900 });
    expect(pairTransfers([boleto, refund, pixIn], options).size).toBe(0);
  });

  it('sends a Pix to a household CPF to the account it lands in, not to a card payment the same day', () => {
    const own = { counterpartDocType: 'cpf' as const, counterpartDoc: '11111111111' };
    const pix = makeTx({ id: 'pix', accountId: 'c6', amountCents: -12000, ...own });
    const cardPayment = makeTx({ id: 'a-card', accountId: 'nu-card', accountKind: 'credit_card', amountCents: 12000, description: 'Pagamento recebido' });
    const lands = makeTx({ id: 'b-lands', accountId: 'nubank', amountCents: 12000, ...own });
    const pays = makeTx({ id: 'z-pays', accountId: 'nubank', amountCents: -12000, description: 'Pagamento de fatura' });
    const pairs = pairTransfers([pix, cardPayment, lands, pays], options);
    expect(pairs.get('pix')).toEqual({ pairId: 'b-lands', kind: 'internal' });
    expect(pairs.get('z-pays')).toEqual({ pairId: 'a-card', kind: 'bill_payment' });
  });
});

describe('pairTransfers with card purchases', () => {
  it('never pairs a card purchase with a checking inflow', () => {
    const purchase = makeTx({ id: 'buy', accountId: 'c6-card', accountKind: 'credit_card', amountCents: -10000, date: '2026-10-01' });
    const pixIn = makeTx({ id: 'pix', accountId: 'c6', amountCents: 10000, date: '2026-10-01' });
    expect(pairTransfers([purchase, pixIn], options).size).toBe(0);
  });
});
