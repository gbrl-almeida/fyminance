import { purchaseGroupKey } from './installments';
import { inferNature, isPixBetweenPersons, type NatureConfig, type NatureResult } from './nature';
import { pairTransfers, type TransferPair } from './pairing';
import { findRefundTargets } from './refunds';
import { findRule } from './rules';
import type { Classification, Owner, ReviewReason, Rule, Tx } from './types';

export interface PipelineConfig extends NatureConfig {
  transferWindowDays: number;
  householdDocuments: ReadonlySet<string>;
}

export interface PipelineInput {
  txs: readonly Tx[];
  existing: ReadonlyMap<string, Classification>;
  rules: readonly Rule[];
  config: PipelineConfig;
}

export interface PipelineOutput {
  classifications: Classification[];
  modelQueue: Tx[];
}

function natureFor(tx: Tx, rule: Rule | null, pair: TransferPair | undefined, config: PipelineConfig): NatureResult {
  if (rule !== null && rule.setNature !== null) {
    return { nature: rule.setNature, transferKind: rule.setNature === 'transfer' ? 'internal' : null, fromPj: false };
  }
  if (pair !== undefined) return { nature: 'transfer', transferKind: pair.kind, fromPj: false };
  return inferNature(tx, config);
}

function reviewReasonFor(tx: Tx, nature: NatureResult): ReviewReason | null {
  if (nature.fromPj) return 'pj_income';
  if (tx.accountKind === 'checking' && isPixBetweenPersons(tx)) return 'pix_person';
  if (nature.nature === 'income') return 'ambiguous_inflow';
  return null;
}

function refundKey(accountId: string, merchantKey: string, cents: number): string {
  return `${accountId}|${merchantKey}|${cents}`;
}

function indexCategorizedPurchases(
  txs: readonly Tx[],
  existing: ReadonlyMap<string, Classification>,
): Map<string, Classification> {
  const index = new Map<string, Classification>();
  for (const tx of txs) {
    if (tx.amountCents >= 0 || tx.status === 'removed') continue;
    const cls = existing.get(tx.id);
    if (cls === undefined || cls.categoryId === null) continue;
    index.set(refundKey(tx.accountId, tx.merchantKey, -tx.amountCents), cls);
  }
  return index;
}

/** Decisão tomada à mão numa parcela, por compra parcelada: as outras parcelas seguem. */
function indexDecidedPurchases(txs: readonly Tx[], existing: ReadonlyMap<string, Classification>): Map<string, Classification> {
  const index = new Map<string, Classification>();
  for (const tx of txs) {
    const group = purchaseGroupKey(tx);
    const cls = existing.get(tx.id);
    if (group === null || tx.status === 'removed' || cls === undefined || cls.source !== 'manual' || cls.categoryId === null) continue;
    index.set(group, cls);
  }
  return index;
}

export function classifyAll({ txs, existing, rules, config }: PipelineInput): PipelineOutput {
  const candidates = txs.filter(
    (tx) => tx.status !== 'removed' && tx.accountKind !== 'voucher' && existing.get(tx.id)?.source !== 'manual',
  );
  const ruleFor = new Map(candidates.map((tx) => [tx.id, findRule(tx, rules)]));
  const pairs = pairTransfers(
    candidates.filter((tx) => (ruleFor.get(tx.id)?.setNature ?? null) === null),
    { windowDays: config.transferWindowDays, householdDocuments: config.householdDocuments },
  );
  const purchases = indexCategorizedPurchases(txs, existing);
  const decided = indexDecidedPurchases(txs, existing);
  const classifications: Classification[] = [];
  const modelQueue: Tx[] = [];

  for (const tx of candidates) {
    const rule = ruleFor.get(tx.id) ?? null;
    const pair = pairs.get(tx.id);
    const nature = natureFor(tx, rule, pair, config);
    const decidedByRule = rule !== null && (rule.setNature !== null || rule.setCategoryId !== null);
    const owner: Owner = rule?.setOwner ?? 'casal';
    const base = {
      transactionId: tx.id,
      nature: nature.nature,
      transferKind: nature.transferKind,
      transferPairId: pair?.pairId ?? null,
      purchaseGroup: purchaseGroupKey(tx),
      ruleId: rule?.id ?? null,
      model: null,
      confidence: null,
    };

    if (nature.nature === 'transfer') {
      classifications.push({ ...base, categoryId: null, owner: 'casal', source: decidedByRule ? 'rule' : 'system', reviewReason: null });
      continue;
    }
    if (rule !== null && rule.setCategoryId !== null) {
      classifications.push({ ...base, categoryId: rule.setCategoryId, owner, source: 'rule', reviewReason: null });
      continue;
    }
    const sibling = base.purchaseGroup === null ? undefined : decided.get(base.purchaseGroup);
    if (sibling !== undefined) {
      classifications.push({ ...base, categoryId: sibling.categoryId, owner: rule?.setOwner ?? sibling.owner, source: 'system', reviewReason: null });
      continue;
    }
    const reason = reviewReasonFor(tx, nature);
    if (reason !== null) {
      classifications.push({ ...base, categoryId: null, owner, source: decidedByRule ? 'rule' : 'system', reviewReason: reason });
      continue;
    }
    if (tx.amountCents > 0) {
      const purchase = purchases.get(refundKey(tx.accountId, tx.merchantKey, tx.amountCents));
      if (purchase !== undefined) {
        classifications.push({
          ...base,
          categoryId: purchase.categoryId,
          owner: rule?.setOwner ?? purchase.owner,
          source: 'system',
          reviewReason: null,
        });
        continue;
      }
    }
    // Crédito no cartão sem o nome da loja ("Refund"): se o valor bate com uma compra, pergunta se é estorno dela.
    const refundOf = tx.amountCents > 0 ? findRefundTargets(tx, txs)[0] : undefined;
    if (refundOf !== undefined) {
      const purchase = existing.get(refundOf.id);
      classifications.push({
        ...base,
        categoryId: purchase?.categoryId ?? null,
        owner: rule?.setOwner ?? purchase?.owner ?? owner,
        source: 'system',
        reviewReason: 'refund',
      });
      continue;
    }
    const previous = existing.get(tx.id);
    if (previous !== undefined && previous.source === 'model' && previous.categoryId !== null) {
      classifications.push({
        ...base,
        categoryId: previous.categoryId,
        owner,
        source: 'model',
        model: previous.model,
        confidence: previous.confidence,
        reviewReason: previous.confidence === 'high' ? null : 'low_confidence',
      });
      continue;
    }
    classifications.push({ ...base, categoryId: null, owner, source: decidedByRule ? 'rule' : 'system', reviewReason: 'uncategorized' });
    modelQueue.push(tx);
  }
  return { classifications, modelQueue };
}
