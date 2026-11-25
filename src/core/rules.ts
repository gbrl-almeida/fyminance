import type { Rule, Tx } from './types';

export function ruleConditionCount(rule: Rule): number {
  return [rule.merchantKey, rule.cardLast4, rule.accountId, rule.minCents, rule.maxCents, rule.direction].filter(
    (value) => value !== null,
  ).length;
}

export function ruleMatches(rule: Rule, tx: Tx): boolean {
  if (ruleConditionCount(rule) === 0) return false;
  const absolute = Math.abs(tx.amountCents);
  if (rule.merchantKey !== null && rule.merchantKey !== tx.merchantKey) return false;
  if (rule.cardLast4 !== null && rule.cardLast4 !== tx.cardLast4) return false;
  if (rule.accountId !== null && rule.accountId !== tx.accountId) return false;
  if (rule.minCents !== null && absolute < rule.minCents) return false;
  if (rule.maxCents !== null && absolute > rule.maxCents) return false;
  if (rule.direction !== null && rule.direction !== (tx.amountCents >= 0 ? 'in' : 'out')) return false;
  return true;
}

function isNewer(candidate: Rule, current: Rule): boolean {
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt;
  return candidate.id > current.id;
}

export function findRule(tx: Tx, rules: readonly Rule[]): Rule | null {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, tx)) continue;
    if (best === null) {
      best = rule;
      continue;
    }
    const diff = ruleConditionCount(rule) - ruleConditionCount(best);
    if (diff > 0 || (diff === 0 && isNewer(rule, best))) best = rule;
  }
  return best;
}
