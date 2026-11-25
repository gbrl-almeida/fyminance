import { isPixBetweenPersons } from '../core/nature';
import type { Db } from '../db/client';
import { categoryPath, loadCategories } from '../db/ledger';
import {
  selectExamples,
  type CategoryOption,
  type Classifier,
  type ClassifyItem,
  type Example,
} from '../integrations/openrouter/classifier';
import { loadLedgerRows } from '../queries/rows';

export interface EvalResult {
  model: string;
  total: number;
  exact: number;
  sameParent: number;
  costUsd: number;
  tokens: number;
  failedBatches: number;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function evaluateModels(
  db: Db,
  classifiers: readonly Classifier[],
  options: { sample: number; batchSize?: number },
): Promise<EvalResult[]> {
  const list = loadCategories(db);
  const byId = new Map(list.map((c) => [c.id, c]));
  const parentOf = (id: number) => byId.get(id)?.parentId ?? id;
  const labeled = loadLedgerRows(db).flatMap(({ tx, cls }) => {
    if (cls === null || cls.categoryId === null || cls.nature !== 'expense') return [];
    if (cls.source !== 'manual' && cls.source !== 'rule') return [];
    if (tx.amountCents >= 0 || (tx.accountKind !== 'checking' && tx.accountKind !== 'credit_card')) return [];
    if (tx.accountKind === 'checking' && isPixBetweenPersons(tx)) return [];
    return [{ tx, categoryId: cls.categoryId }];
  });
  const sample = [...labeled]
    .sort((a, b) => hash(a.tx.id) - hash(b.tx.id) || a.tx.id.localeCompare(b.tx.id))
    .slice(0, options.sample);
  const truth = new Map(sample.map(({ tx, categoryId }) => [tx.id, categoryId]));
  const sampledMerchants = new Set(sample.map(({ tx }) => tx.merchantKey));
  const pool: Example[] = [];
  for (const { tx, categoryId } of labeled) {
    if (sampledMerchants.has(tx.merchantKey) || pool.some((e) => e.merchantKey === tx.merchantKey)) continue;
    pool.push({ merchantKey: tx.merchantKey, description: tx.description, categoryPath: categoryPath(list, categoryId) });
  }
  const categoryOptions: CategoryOption[] = list
    .filter((c) => c.kind === 'expense' && !c.archived)
    .map((c) => ({ id: c.id, path: categoryPath(list, c.id), description: c.description }));
  const items: ClassifyItem[] = sample.map(({ tx }) => ({
    id: tx.id,
    merchantKey: tx.merchantKey,
    description: tx.description,
    amountCents: tx.amountCents,
    date: tx.date,
    accountKind: tx.accountKind === 'credit_card' ? 'credit_card' : 'checking',
  }));
  const batchSize = options.batchSize ?? 40;

  const results: EvalResult[] = [];
  for (const classifier of classifiers) {
    const result: EvalResult = { model: classifier.model, total: items.length, exact: 0, sameParent: 0, costUsd: 0, tokens: 0, failedBatches: 0 };
    for (let start = 0; start < items.length; start += batchSize) {
      const batch = items.slice(start, start + batchSize);
      try {
        const run = await classifier.classify(batch, categoryOptions, selectExamples(batch, pool));
        result.costUsd += run.costUsd ?? 0;
        result.tokens += run.totalTokens;
        for (const answer of run.results) {
          const expected = truth.get(answer.id);
          if (expected === undefined) continue;
          if (answer.categoryId === expected) result.exact += 1;
          if (parentOf(answer.categoryId) === parentOf(expected)) result.sameParent += 1;
        }
      } catch {
        result.failedBatches += 1;
      }
    }
    result.costUsd = Math.round(result.costUsd * 1e6) / 1e6;
    results.push(result);
  }
  return results;
}

export function formatEvaluation(results: readonly EvalResult[]): string {
  const percent = (value: number, total: number) => (total === 0 ? '-' : `${Math.round((100 * value) / total)}%`);
  return results
    .map((r) => {
      const failures = r.failedBatches > 0 ? `, ${r.failedBatches} lote(s) com erro` : '';
      return `${r.model}: acerto exato ${percent(r.exact, r.total)}, categoria-mãe ${percent(r.sameParent, r.total)}, custo US$ ${r.costUsd.toFixed(4)}, ${r.tokens} tokens${failures}`;
    })
    .join('\n');
}
