import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeClassification, makeTx } from '../core/testing';
import type { Confidence } from '../core/types';
import type { Db } from '../db/client';
import { loadClassifications } from '../db/ledger';
import { rules, transactionNotes } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import type { CategoryOption, Classifier, ClassifyItem, Example } from '../integrations/openrouter/classifier';
import { reclassify } from './reclassify';

const pipeline: PipelineConfig = {
  pjDocument: null,
  pjNamePattern: null,
  transferWindowDays: 3,
  householdDocuments: new Set(),
};
const now = () => new Date('2026-10-14T10:00:00.000Z');

function setup(count: number): Db {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'card', kind: 'credit_card' });
  for (let i = 0; i < count; i++) {
    insertTestTx(
      db,
      makeTx({
        id: `t${i}`,
        accountId: 'card',
        accountKind: 'credit_card',
        description: i % 2 === 0 ? 'IFOOD *IFOOD' : 'LOJA XPTO',
        amountCents: -1000 - i,
      }),
    );
  }
  return db;
}

function fakeClassifier(
  answer: (item: ClassifyItem) => { categoryId: number; confidence: Confidence } | null,
  costUsd: number | null = 0.001,
) {
  const calls: Array<{ items: ClassifyItem[]; categories: CategoryOption[]; examples: Example[] }> = [];
  const classifier: Classifier = {
    model: 'fake/model',
    async classify(items, categories, examples) {
      calls.push({ items: [...items], categories: [...categories], examples: [...examples] });
      const results = items.flatMap((item) => {
        const a = answer(item);
        return a === null ? [] : [{ id: item.id, ...a }];
      });
      return { results, model: 'fake/model', totalTokens: 100, costUsd };
    },
  };
  return { classifier, calls };
}

describe('reclassify', () => {
  it('classifies the ledger and asks the model only for what is left', async () => {
    const db = setup(4);
    const delivery = categoryIdByName(db, 'Delivery');
    const others = categoryIdByName(db, 'Outros');
    const { classifier } = fakeClassifier((item) =>
      item.merchantKey === 'IFOOD IFOOD' ? { categoryId: delivery, confidence: 'high' } : { categoryId: others, confidence: 'low' },
    );

    const report = await reclassify({ db, pipeline, classifier, now });

    expect(report).toMatchObject({ classified: 4, modelQueued: 4, modelClassified: 4, modelTokens: 100, modelError: null });
    expect(report.modelCostUsd).toBeCloseTo(0.001);
    const saved = loadClassifications(db);
    expect(saved.get('t0')).toMatchObject({ categoryId: delivery, source: 'model', model: 'fake/model', confidence: 'high', reviewReason: null });
    expect(saved.get('t1')).toMatchObject({ categoryId: others, confidence: 'low', reviewReason: 'low_confidence' });
  });

  it('asks again, with the bank hints, about the suggestions the model was unsure of', async () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    const others = categoryIdByName(db, 'Outros');
    const car = categoryIdByName(db, 'Transporte');
    insertTestTx(db, makeTx({ id: 'parts', accountId: 'card', accountKind: 'credit_card', description: 'AUTOPECAS EXEMPLO LTDA' }), {
      raw: { category: 'Automotive', merchant: { cnae: '4530703', businessName: 'AUTOPECAS EXEMPLO LTDA' } },
    });
    insertTestClassification(db, makeClassification({ transactionId: 'parts', categoryId: others, source: 'model', confidence: 'low', reviewReason: 'low_confidence' }));
    db.insert(transactionNotes).values({ transactionId: 'parts', note: 'pastilha de freio', updatedBy: 'pessoa1', updatedAt: '2026-10-20T10:00:00.000Z' }).run();
    const { classifier, calls } = fakeClassifier(() => ({ categoryId: car, confidence: 'high' }));

    expect((await reclassify({ db, pipeline, classifier, now })).modelQueued).toBe(0);
    const report = await reclassify({ db, pipeline, classifier, now, retryUnsure: true });

    expect(report.modelQueued).toBe(1);
    expect(calls.at(-1)?.items[0]?.bankHint).toBe('categoria do banco: Automotive; empresa: AUTOPECAS EXEMPLO LTDA (CNAE 4530703)');
    expect(calls.at(-1)?.items[0]?.note).toBe('pastilha de freio');
    expect(loadClassifications(db).get('parts')).toMatchObject({ categoryId: car, confidence: 'high', reviewReason: null });
  });

  it('does not ask the model again on the next run', async () => {
    const db = setup(4);
    const others = categoryIdByName(db, 'Outros');
    const { classifier, calls } = fakeClassifier(() => ({ categoryId: others, confidence: 'high' }));
    await reclassify({ db, pipeline, classifier, now });
    const second = await reclassify({ db, pipeline, classifier, now });
    expect(calls).toHaveLength(1);
    expect(second.modelQueued).toBe(0);
  });

  it('offers only expense categories and learns examples from confirmed decisions', async () => {
    const db = setup(1);
    const transport = categoryIdByName(db, 'Transporte');
    db.insert(rules)
      .values({ merchantKey: 'UBER TRIP', setCategoryId: transport, origin: 'user', createdAt: '2026-10-01T00:00:00.000Z' })
      .run();
    insertTestTx(db, makeTx({ id: 'u1', accountId: 'card', accountKind: 'credit_card', description: 'UBER *TRIP', amountCents: -2500 }));
    const { classifier, calls } = fakeClassifier(() => null);

    await reclassify({ db, pipeline, classifier, now });

    const call = calls[0];
    expect(call?.items.map((i) => i.id)).toEqual(['t0']);
    expect(call?.categories.some((c) => c.path === 'Alimentação > Delivery')).toBe(true);
    expect(call?.categories.some((c) => c.path === 'Salário')).toBe(false);
    expect(call?.examples).toEqual([{ merchantKey: 'UBER TRIP', description: 'UBER *TRIP', categoryPath: 'Transporte' }]);
  });

  it('never shows the model examples it would not be allowed to see', async () => {
    const db = setup(1);
    insertTestAccount(db, { id: 'c6', kind: 'checking' });
    const pix = makeTx({ id: 'pix', accountId: 'c6', description: 'PIX ENVIADO JOAO SILVA', amountCents: -5000, counterpartDocType: 'cpf', counterpartDoc: '44444444444' });
    const salary = makeTx({ id: 'sal', accountId: 'c6', description: 'SALARIO FULANO DE TAL', amountCents: 600000 });
    insertTestTx(db, pix);
    insertTestTx(db, salary);
    insertTestClassification(db, makeClassification({ transactionId: 'pix', source: 'manual', nature: 'expense', categoryId: categoryIdByName(db, 'Outros') }));
    insertTestClassification(db, makeClassification({ transactionId: 'sal', source: 'manual', nature: 'income', categoryId: categoryIdByName(db, 'Salário') }));
    const { classifier, calls } = fakeClassifier(() => null);

    await reclassify({ db, pipeline, classifier, now });

    expect(calls[0]?.examples).toEqual([]);
  });

  it('stops sending batches once the cost cap is reached', async () => {
    const db = setup(5);
    const others = categoryIdByName(db, 'Outros');
    const { classifier, calls } = fakeClassifier(() => ({ categoryId: others, confidence: 'high' }), 0.001);
    const report = await reclassify({
      db,
      pipeline,
      classifier,
      now,
      batchSize: 2,
      limits: { maxCostUsdPerRun: 0.0015, maxItemsPerRun: 100 },
    });
    expect(calls).toHaveLength(2);
    expect(report.modelClassified).toBe(4);
    expect([...loadClassifications(db).values()].filter((c) => c.reviewReason === 'uncategorized')).toHaveLength(1);
  });

  it('respects the item cap', async () => {
    const db = setup(5);
    const others = categoryIdByName(db, 'Outros');
    const { classifier } = fakeClassifier(() => ({ categoryId: others, confidence: 'high' }));
    const report = await reclassify({ db, pipeline, classifier, now, limits: { maxCostUsdPerRun: 1, maxItemsPerRun: 3 } });
    expect(report.modelClassified).toBe(3);
  });

  it('keeps the pipeline result when the model fails', async () => {
    const db = setup(2);
    const classifier: Classifier = {
      model: 'broken',
      async classify() {
        throw new Error('modelo fora do ar');
      },
    };
    const report = await reclassify({ db, pipeline, classifier, now });
    expect(report.modelError).toBe('modelo fora do ar');
    expect(loadClassifications(db).get('t0')).toMatchObject({ reviewReason: 'uncategorized' });
  });

  it('works without a classifier', async () => {
    const db = setup(2);
    const report = await reclassify({ db, pipeline, classifier: null, now });
    expect(report).toMatchObject({ classified: 2, modelQueued: 2, modelClassified: 0, modelError: null });
  });
});
