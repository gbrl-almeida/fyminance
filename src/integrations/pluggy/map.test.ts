import { describe, expect, it } from 'vitest';
import { bankHint, mapAccount, mapBill, mapInvestment, mapInvestmentMovement, mapItem, mapTransaction, pluggyDateToLocal } from './map';
import { normalizeMerchantKey } from '../../core/merchant';

const connection = { itemId: 'item-c6', owner: 'pessoa1' as const, institution: 'C6' };

const cardPurchase = {
  id: 'tx-1',
  accountId: 'acc-card',
  date: new Date('2026-10-05T00:00:00.000Z'),
  description: 'IFOOD *IFOOD',
  type: 'DEBIT',
  amount: 45.9,
  status: 'POSTED',
  paymentData: null,
  creditCardMetadata: {
    installmentNumber: 2,
    totalInstallments: 3,
    purchaseDate: new Date('2026-09-05T03:00:00.000Z'),
    billId: 'bill-9',
    cardNumber: '****1234',
  },
};

describe('pluggyDateToLocal', () => {
  it('keeps the day of date-only values', () => {
    expect(pluggyDateToLocal(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05');
    expect(pluggyDateToLocal(new Date('2026-10-05T03:00:00.000Z'))).toBe('2026-10-05');
  });

  it('converts real instants to the São Paulo day', () => {
    expect(pluggyDateToLocal(new Date('2026-11-01T01:30:00.000Z'))).toBe('2026-10-31');
    expect(pluggyDateToLocal(new Date('2026-10-31T23:30:00.000Z'))).toBe('2026-10-31');
  });
});

describe('mapTransaction', () => {
  it('maps a card purchase as an outflow with installment data', () => {
    const tx = mapTransaction(cardPurchase);
    expect(tx).toMatchObject({
      id: 'tx-1',
      accountId: 'acc-card',
      date: '2026-10-05',
      amountCents: -4590,
      description: 'IFOOD *IFOOD',
      merchantKey: 'IFOOD IFOOD',
      status: 'posted',
      cardLast4: '1234',
      installmentNumber: 2,
      installmentTotal: 3,
      purchaseDate: '2026-09-05',
      billId: 'bill-9',
      counterpartDocType: null,
      counterpartDoc: null,
    });
    expect(JSON.parse(tx.raw)).toMatchObject({ id: 'tx-1', date: '2026-10-05T00:00:00.000Z' });
  });

  it('maps a payment received on the card as an inflow', () => {
    const tx = mapTransaction({ ...cardPurchase, id: 'tx-2', type: 'CREDIT', amount: 1200, description: 'PAGAMENTO RECEBIDO' });
    expect(tx.amountCents).toBe(120000);
  });

  it('trusts the type over the sign of the amount', () => {
    expect(mapTransaction({ ...cardPurchase, amount: -45.9 }).amountCents).toBe(-4590);
    expect(mapTransaction({ ...cardPurchase, type: 'CREDIT', amount: -45.9 }).amountCents).toBe(4590);
  });

  it('maps pending transactions and missing card data', () => {
    const tx = mapTransaction({ ...cardPurchase, status: 'PENDING', creditCardMetadata: null });
    expect(tx).toMatchObject({ status: 'pending', cardLast4: null, installmentNumber: null, billId: null, purchaseDate: null });
  });

  it('uses the payer for inflows and the receiver for outflows', () => {
    const paymentData = {
      payer: { documentNumber: { type: 'CNPJ', value: '12.345.678/0001-99' } },
      receiver: { documentNumber: { type: 'CPF', value: '111.111.111-11' } },
    };
    const inflow = mapTransaction({ ...cardPurchase, type: 'CREDIT', paymentData, creditCardMetadata: null });
    const outflow = mapTransaction({ ...cardPurchase, type: 'DEBIT', paymentData, creditCardMetadata: null });
    expect(inflow).toMatchObject({ counterpartDocType: 'cnpj', counterpartDoc: '12345678000199' });
    expect(outflow).toMatchObject({ counterpartDocType: 'cpf', counterpartDoc: '11111111111' });
  });

  it('names a paid boleto after who receives it, not after the bank', () => {
    const boleto = {
      ...cardPurchase,
      accountId: 'acc-checking',
      description: 'Pagamento Boleto BCO EXEMPLO S.A.',
      creditCardMetadata: null,
      paymentData: {
        paymentMethod: 'BOLETO',
        receiver: { name: 'CONDOMINIO RESIDENCIAL EXEMPLO', documentNumber: { type: 'CNPJ', value: '12.345.678/0001-99' } },
      },
    };
    expect(mapTransaction(boleto)).toMatchObject({
      description: 'Boleto CONDOMINIO RESIDENCIAL EXEMPLO',
      merchantKey: 'CONDOMINIO RESIDENCIAL EXEMPLO',
      counterpartDoc: '12345678000199',
    });
    const withoutName = { ...boleto, paymentData: { paymentMethod: 'BOLETO', receiver: null } };
    expect(mapTransaction(withoutName).description).toBe('Pagamento Boleto BCO EXEMPLO S.A.');
  });

  it('keeps the bank description when a boleto pays the card bill', () => {
    const bill = {
      ...cardPurchase,
      accountId: 'acc-checking',
      description: 'Pagamento efetuado - Pagamento Fatura - FULANA DE TAL',
      creditCardMetadata: null,
      paymentData: { paymentMethod: 'BOLETO', receiver: { name: 'BANCO EXEMPLO S.A', documentNumber: { type: 'CNPJ', value: '12.345.678/0001-99' } } },
    };
    expect(mapTransaction(bill)).toMatchObject({
      description: 'Pagamento efetuado - Pagamento Fatura - FULANA DE TAL',
      merchantKey: normalizeMerchantKey('Pagamento efetuado - Pagamento Fatura - FULANA DE TAL'),
    });
  });

  it('ignores the counterpart of a utility payment, which the bank fills with the payer', () => {
    const utility = {
      ...cardPurchase,
      accountId: 'acc-checking',
      description: 'Pagamento de Convênio - GAS EXEMPLO',
      operationType: 'CONVENIO_ARRECADACAO',
      creditCardMetadata: null,
      paymentData: { paymentMethod: 'OTHER', receiver: { documentNumber: { type: 'CPF', value: '111.111.111-11' } } },
    };
    expect(mapTransaction(utility)).toMatchObject({ counterpartDocType: null, counterpartDoc: null });
  });

  it('rejects payloads without the required fields', () => {
    expect(() => mapTransaction({ id: 'x' })).toThrow();
  });
});

describe('accounts, investments, bills and items', () => {
  it('maps bank and credit accounts', () => {
    const bank = mapAccount({ id: 'a1', type: 'BANK', name: 'Conta corrente', balance: 1500.5 }, connection);
    const card = mapAccount({ id: 'a2', type: 'CREDIT', name: 'Cartão', balance: 800 }, connection);
    expect(bank).toMatchObject({
      account: { id: 'a1', connectionId: 'item-c6', kind: 'checking', name: 'C6 · Conta corrente', owner: 'pessoa1' },
      balanceCents: 150050,
    });
    expect(card.account.kind).toBe('credit_card');
  });

  it('trims the padding some banks leave in account names', () => {
    const card = mapAccount({ id: 'a2', type: 'CREDIT', name: 'BANDEIRADO          ', balance: 800 }, connection);
    expect(card.account.name).toBe('C6 · BANDEIRADO');
  });

  it('names bank accounts by their kind, since banks send their own name instead', () => {
    const inter = { ...connection, institution: 'Inter' };
    expect(mapAccount({ id: 'a1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'BANCO INTER', balance: 0 }, inter).account.name).toBe('Inter · Conta corrente');
    expect(mapAccount({ id: 'a2', type: 'BANK', subtype: 'SAVINGS_ACCOUNT', name: 'BANCO INTER', balance: 0 }, inter).account.name).toBe('Inter · Poupança');
    expect(mapAccount({ id: 'a3', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'gold', balance: 0 }, inter).account.name).toBe('Inter · gold');
  });

  it('maps applications and redemptions of an investment', () => {
    const sell = {
      id: 'm2',
      type: 'SELL',
      movementType: 'DEBIT',
      date: '2026-03-21T00:00:00.000Z',
      amount: 5030,
      netAmount: 5015.58,
      quantity: 5000,
      value: 1.006,
    };
    expect(mapInvestmentMovement(sell, 'i1')).toMatchObject({
      id: 'm2',
      accountId: 'i1',
      date: '2026-03-21',
      type: 'SELL',
      amountCents: 503000,
      netCents: 501558,
      quantity: 5000,
      unitValue: 1.006,
    });
    const buy = mapInvestmentMovement({ id: 'm1', type: 'BUY', date: '2026-03-01T00:00:00.000Z', amount: 5000, quantity: 5000 }, 'i1');
    expect(buy).toMatchObject({ amountCents: 500000, netCents: null, unitValue: null });
    expect(JSON.parse(buy.raw)).toMatchObject({ id: 'm1' });
  });

  it('maps investments as investment accounts', () => {
    expect(mapInvestment({ id: 'i1', name: 'CDB Liquidez Diária', balance: 1000.01 }, connection)).toMatchObject({
      account: { id: 'i1', kind: 'investment', name: 'C6 · CDB Liquidez Diária' },
      balanceCents: 100001,
    });
  });

  it('maps bills', () => {
    expect(mapBill({ id: 'b1', dueDate: new Date('2026-10-15T03:00:00.000Z'), totalAmount: 560 }, 'a2')).toMatchObject({
      id: 'b1',
      accountId: 'a2',
      dueDate: '2026-10-15',
      totalCents: 56000,
    });
  });

  it('maps item status and consent expiry', () => {
    expect(mapItem({ id: 'item-c6', status: 'UPDATED', consentExpiresAt: new Date('2027-01-01T00:00:00.000Z') })).toEqual({
      status: 'UPDATED',
      consentExpiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(mapItem({ id: 'item-c6', status: 'LOGIN_ERROR', consentExpiresAt: null }).consentExpiresAt).toBeNull();
  });
});

describe('bankHint', () => {
  it('sums up what the bank says about the merchant', () => {
    const merchant = { cnae: '4530703', cnpj: '11222333000181', category: 'Automotive', businessName: 'AUTOPECAS EXEMPLO LTDA' };
    expect(bankHint({ category: 'Automotive', merchant })).toBe('categoria do banco: Automotive; empresa: AUTOPECAS EXEMPLO LTDA (CNAE 4530703)');
    expect(bankHint({ category: 'Groceries', merchant: null })).toBe('categoria do banco: Groceries');
    expect(bankHint({ category: null, merchant: { cnpj: '', name: 'sorveteria exemplo', businessName: '' } })).toBe('empresa: sorveteria exemplo');
    expect(bankHint({})).toBeNull();
    expect(bankHint('não é objeto')).toBeNull();
  });
});
