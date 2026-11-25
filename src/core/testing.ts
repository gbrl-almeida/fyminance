import { normalizeMerchantKey } from './merchant';
import type { Classification, Rule, Tx } from './types';

export function makeTx(overrides: Partial<Tx> & Pick<Tx, 'id'>): Tx {
  const description = overrides.description ?? 'COMPRA TESTE';
  return {
    accountId: 'checking-1',
    accountKind: 'checking',
    date: '2026-10-01',
    amountCents: -1000,
    description,
    merchantKey: normalizeMerchantKey(description),
    status: 'posted',
    cardLast4: null,
    installmentNumber: null,
    installmentTotal: null,
    purchaseDate: null,
    billId: null,
    counterpartDocType: null,
    counterpartDoc: null,
    ...overrides,
  };
}

export function makeRule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    merchantKey: null,
    cardLast4: null,
    accountId: null,
    minCents: null,
    maxCents: null,
    direction: null,
    setNature: null,
    setCategoryId: null,
    setOwner: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeClassification(
  overrides: Partial<Classification> & Pick<Classification, 'transactionId'>,
): Classification {
  return {
    nature: 'expense',
    transferKind: null,
    transferPairId: null,
    categoryId: null,
    owner: 'casal',
    source: 'system',
    ruleId: null,
    model: null,
    confidence: null,
    purchaseGroup: null,
    reviewReason: null,
    ...overrides,
  };
}
