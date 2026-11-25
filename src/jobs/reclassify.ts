import { eq, inArray } from 'drizzle-orm';
import { classifyAll, type PipelineConfig } from '../core/classify';
import { isPixBetweenPersons } from '../core/nature';
import type { Category, Classification, Tx } from '../core/types';
import type { Db } from '../db/client';
import {
  categoryPath,
  loadCategories,
  loadClassifications,
  loadRules,
  loadTxs,
  saveClassifications,
} from '../db/ledger';
import { classifications, transactionNotes, transactions } from '../db/schema';
import {
  selectExamples,
  type CategoryOption,
  type Classifier,
  type ClassifyItem,
  type Example,
} from '../integrations/openrouter/classifier';
import { bankHint } from '../integrations/pluggy/map';

export interface ModelLimits {
  maxCostUsdPerRun: number;
  maxItemsPerRun: number;
}

export interface ReclassifyDeps {
  db: Db;
  pipeline: PipelineConfig;
  classifier: Classifier | null;
  limits?: ModelLimits;
  batchSize?: number;
  now: () => Date;
  /** Pergunta de novo ao modelo o que ele classificou sem certeza. */
  retryUnsure?: boolean;
}

export interface ReclassifyReport {
  classified: number;
  modelQueued: number;
  modelClassified: number;
  modelTokens: number;
  modelCostUsd: number;
  modelError: string | null;
}

const DEFAULT_LIMITS: ModelLimits = { maxCostUsdPerRun: 0.5, maxItemsPerRun: 2000 };
const DEFAULT_BATCH_SIZE = 40;

function toItem(tx: Tx, hints: ReadonlyMap<string, string | null>, notes: ReadonlyMap<string, string>): ClassifyItem {
  return {
    id: tx.id,
    merchantKey: tx.merchantKey,
    description: tx.description,
    amountCents: tx.amountCents,
    date: tx.date,
    accountKind: tx.accountKind === 'credit_card' ? 'credit_card' : 'checking',
    bankHint: hints.get(tx.id) ?? null,
    note: notes.get(tx.id) ?? null,
  };
}

function loadNotes(db: Db, ids: readonly string[]): Map<string, string> {
  const rows = db.select().from(transactionNotes).where(inArray(transactionNotes.transactionId, [...ids])).all();
  return new Map(rows.map((row) => [row.transactionId, row.note]));
}

function loadHints(db: Db, ids: readonly string[]): Map<string, string | null> {
  const rows = db.select({ id: transactions.id, raw: transactions.raw }).from(transactions).where(inArray(transactions.id, [...ids])).all();
  return new Map(rows.map((row) => [row.id, bankHint(JSON.parse(row.raw))]));
}

function examplePool(db: Db, categoryList: readonly Category[]): Example[] {
  const rows = db
    .select({
      merchantKey: transactions.merchantKey,
      description: transactions.description,
      counterpartDocType: transactions.counterpartDocType,
      nature: classifications.nature,
      categoryId: classifications.categoryId,
    })
    .from(classifications)
    .innerJoin(transactions, eq(transactions.id, classifications.transactionId))
    .where(inArray(classifications.source, ['rule', 'manual']))
    .orderBy(transactions.date)
    .all();
  const pool = new Map<string, Example>();
  for (const row of rows) {
    if (row.categoryId === null || pool.has(row.merchantKey)) continue;
    // Só servem de exemplo os gastos que o próprio modelo poderia ver: nunca Pix entre pessoas nem renda.
    if (row.nature !== 'expense' || isPixBetweenPersons(row)) continue;
    pool.set(row.merchantKey, {
      merchantKey: row.merchantKey,
      description: row.description,
      categoryPath: categoryPath(categoryList, row.categoryId),
    });
  }
  return [...pool.values()];
}

export async function reclassify(deps: ReclassifyDeps): Promise<ReclassifyReport> {
  const { db, pipeline, classifier, now } = deps;
  const txs = loadTxs(db);
  const { classifications: computed, modelQueue: firstAsk } = classifyAll({
    txs,
    existing: loadClassifications(db),
    rules: loadRules(db),
    config: pipeline,
  });
  saveClassifications(db, computed, now().toISOString());
  const unsure = new Set(computed.filter((c) => c.source === 'model' && c.reviewReason === 'low_confidence').map((c) => c.transactionId));
  const modelQueue = deps.retryUnsure === true ? [...firstAsk, ...txs.filter((tx) => unsure.has(tx.id))] : firstAsk;
  const report: ReclassifyReport = {
    classified: computed.length,
    modelQueued: modelQueue.length,
    modelClassified: 0,
    modelTokens: 0,
    modelCostUsd: 0,
    modelError: null,
  };
  if (classifier === null || modelQueue.length === 0) return report;

  const limits = deps.limits ?? DEFAULT_LIMITS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const categoryList = loadCategories(db);
  const options: CategoryOption[] = categoryList
    .filter((c) => c.kind === 'expense' && !c.archived)
    .map((c) => ({ id: c.id, path: categoryPath(categoryList, c.id), description: c.description }));
  const pool = examplePool(db, categoryList);
  const current = new Map(computed.map((c) => [c.transactionId, c]));
  const queue = modelQueue.slice(0, limits.maxItemsPerRun);

  try {
    for (let start = 0; start < queue.length; start += batchSize) {
      if (report.modelCostUsd >= limits.maxCostUsdPerRun) break;
      const batch = queue.slice(start, start + batchSize);
      const hints = loadHints(db, batch.map((tx) => tx.id));
      const notes = loadNotes(db, batch.map((tx) => tx.id));
      const items = batch.map((tx) => toItem(tx, hints, notes));
      const run = await classifier.classify(items, options, selectExamples(items, pool));
      report.modelTokens += run.totalTokens;
      report.modelCostUsd += run.costUsd ?? 0;
      const updates: Classification[] = [];
      for (const result of run.results) {
        const base = current.get(result.id);
        if (base === undefined) continue;
        updates.push({
          ...base,
          categoryId: result.categoryId,
          source: 'model',
          model: run.model,
          confidence: result.confidence,
          reviewReason: result.confidence === 'high' ? null : 'low_confidence',
        });
      }
      saveClassifications(db, updates, now().toISOString());
      report.modelClassified += updates.length;
    }
  } catch (error) {
    report.modelError = error instanceof Error ? error.message : String(error);
  }
  return report;
}
