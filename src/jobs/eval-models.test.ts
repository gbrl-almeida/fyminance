import { describe, expect, it } from 'vitest';
import { makeClassification, makeTx } from '../core/testing';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import type { Classifier, ClassifyItem } from '../integrations/openrouter/classifier';
import { evaluateModels, formatEvaluation } from './eval-models';

function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'card', kind: 'credit_card' });
  const truth = new Map<string, number>();
  const label = (id: string, description: string, category: string) => {
    insertTestTx(db, makeTx({ id, accountId: 'card', accountKind: 'credit_card', description, amountCents: -1000 }));
    const categoryId = categoryIdByName(db, category);
    insertTestClassification(db, makeClassification({ transactionId: id, categoryId, source: 'manual' }));
    truth.set(id, categoryId);
  };
  label('a', 'IFOOD *IFOOD', 'Delivery');
  label('b', 'SUPERMERCADO BOM PRECO', 'Mercado');
  label('c', 'UBER *TRIP', 'Transporte');
  label('d', 'NETFLIX.COM', 'Assinaturas');
  insertTestTx(db, makeTx({ id: 'model', accountId: 'card', accountKind: 'credit_card', description: 'LOJA X' }));
  insertTestClassification(db, makeClassification({ transactionId: 'model', categoryId: categoryIdByName(db, 'Outros'), source: 'model' }));
  return { db, truth };
}

function fixed(model: string, answer: (item: ClassifyItem) => number): Classifier {
  return {
    model,
    async classify(items) {
      return { results: items.map((item) => ({ id: item.id, categoryId: answer(item), confidence: 'high' as const })), model, totalTokens: 10, costUsd: 0.001 };
    },
  };
}

describe('evaluateModels', () => {
  it('scores exact and parent-level answers over the labeled set only', async () => {
    const { db, truth } = setup();
    const restaurant = categoryIdByName(db, 'Restaurante');
    const perfect = fixed('perfect', (item) => truth.get(item.id) as number);
    const sibling = fixed('sibling', (item) => (item.id === 'a' ? restaurant : (truth.get(item.id) as number)));
    const broken: Classifier = {
      model: 'broken',
      async classify() {
        throw new Error('fora do ar');
      },
    };

    const results = await evaluateModels(db, [perfect, sibling, broken], { sample: 10, batchSize: 2 });

    expect(results).toEqual([
      { model: 'perfect', total: 4, exact: 4, sameParent: 4, costUsd: 0.002, tokens: 20, failedBatches: 0 },
      { model: 'sibling', total: 4, exact: 3, sameParent: 4, costUsd: 0.002, tokens: 20, failedBatches: 0 },
      { model: 'broken', total: 4, exact: 0, sameParent: 0, costUsd: 0, tokens: 0, failedBatches: 2 },
    ]);
  });

  it('never shows the model an example from the merchants being tested', async () => {
    const { db } = setup();
    const seen: string[][] = [];
    const spy: Classifier = {
      model: 'spy',
      async classify(items, _categories, examples) {
        seen.push(examples.map((e) => e.merchantKey));
        return { results: [], model: 'spy', totalTokens: 0, costUsd: null };
      },
    };
    await evaluateModels(db, [spy], { sample: 2 });
    const sampled = new Set(['IFOOD IFOOD', 'SUPERMERCADO BOM PRECO', 'UBER TRIP', 'NETFLIX COM']);
    expect(seen[0]?.length).toBe(2);
    expect(seen[0]?.every((m) => sampled.has(m))).toBe(true);
  });

  it('formats the comparison', () => {
    expect(
      formatEvaluation([{ model: 'm', total: 4, exact: 3, sameParent: 4, costUsd: 0.0021, tokens: 20, failedBatches: 1 }]),
    ).toBe('m: acerto exato 75%, categoria-mãe 100%, custo US$ 0.0021, 20 tokens, 1 lote(s) com erro');
  });
});
