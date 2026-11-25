import { describe, expect, it } from 'vitest';
import { findRule, ruleConditionCount, ruleMatches } from './rules';
import { makeRule, makeTx } from './testing';

const purchase = makeTx({
  id: 't1',
  description: 'IFOOD *IFOOD',
  amountCents: -4590,
  accountId: 'card-1',
  accountKind: 'credit_card',
  cardLast4: '1234',
});

describe('rules', () => {
  it('counts conditions, with each range bound counting once', () => {
    expect(ruleConditionCount(makeRule({ id: 1, merchantKey: 'X', minCents: 1, maxCents: 2 }))).toBe(3);
    expect(ruleConditionCount(makeRule({ id: 1, setCategoryId: 3 }))).toBe(0);
  });

  it('matches on merchant key', () => {
    const rule = makeRule({ id: 1, merchantKey: 'IFOOD IFOOD', setCategoryId: 7 });
    expect(findRule(purchase, [rule])).toBe(rule);
  });

  it('ignores rules whose conditions do not match', () => {
    expect(findRule(purchase, [makeRule({ id: 1, merchantKey: 'UBER TRIP' })])).toBeNull();
  });

  it('never matches a rule without conditions', () => {
    expect(findRule(purchase, [makeRule({ id: 1, setCategoryId: 7 })])).toBeNull();
  });

  it('checks direction and the absolute amount range', () => {
    expect(ruleMatches(makeRule({ id: 1, direction: 'out', minCents: 4000, maxCents: 5000 }), purchase)).toBe(true);
    expect(ruleMatches(makeRule({ id: 2, merchantKey: 'IFOOD IFOOD', direction: 'in' }), purchase)).toBe(false);
    expect(ruleMatches(makeRule({ id: 3, merchantKey: 'IFOOD IFOOD', maxCents: 1000 }), purchase)).toBe(false);
    expect(ruleMatches(makeRule({ id: 4, merchantKey: 'IFOOD IFOOD', minCents: 5000 }), purchase)).toBe(false);
  });

  it('checks card and account', () => {
    expect(ruleMatches(makeRule({ id: 1, cardLast4: '1234' }), purchase)).toBe(true);
    expect(ruleMatches(makeRule({ id: 2, cardLast4: '9999' }), purchase)).toBe(false);
    expect(ruleMatches(makeRule({ id: 3, accountId: 'card-1' }), purchase)).toBe(true);
    expect(ruleMatches(makeRule({ id: 4, accountId: 'other' }), purchase)).toBe(false);
  });

  it('prefers the rule with more conditions', () => {
    const generic = makeRule({ id: 1, merchantKey: 'IFOOD IFOOD', setCategoryId: 7, createdAt: '2026-10-10T00:00:00.000Z' });
    const specific = makeRule({
      id: 2,
      merchantKey: 'IFOOD IFOOD',
      cardLast4: '1234',
      setOwner: 'pessoa2',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(findRule(purchase, [generic, specific])).toBe(specific);
  });

  it('breaks ties by the most recent rule, then by id', () => {
    const older = makeRule({ id: 1, merchantKey: 'IFOOD IFOOD', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeRule({ id: 2, merchantKey: 'IFOOD IFOOD', createdAt: '2026-02-01T00:00:00.000Z' });
    expect(findRule(purchase, [newer, older])).toBe(newer);
    expect(findRule(purchase, [older, newer])).toBe(newer);
    const sameTimeHigherId = makeRule({ id: 3, merchantKey: 'IFOOD IFOOD', createdAt: '2026-02-01T00:00:00.000Z' });
    expect(findRule(purchase, [sameTimeHigherId, newer])).toBe(sameTimeHigherId);
  });
});
