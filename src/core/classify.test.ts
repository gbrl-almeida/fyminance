import { describe, expect, it } from 'vitest';
import { classifyAll, type PipelineConfig, type PipelineOutput } from './classify';
import { makeClassification, makeRule, makeTx } from './testing';
import type { Classification, Rule, Tx } from './types';

const config: PipelineConfig = {
  pjDocument: '12345678000199',
  pjNamePattern: null,
  transferWindowDays: 3,
  householdDocuments: new Set(['11111111111', '22222222222']),
};

function run(txs: Tx[], options: { existing?: Classification[]; rules?: Rule[] } = {}): PipelineOutput {
  return classifyAll({
    txs,
    existing: new Map((options.existing ?? []).map((c) => [c.transactionId, c])),
    rules: options.rules ?? [],
    config,
  });
}

const byId = (out: PipelineOutput, id: string) => out.classifications.find((c) => c.transactionId === id);
const card = { accountId: 'card', accountKind: 'credit_card' } as const;

describe('classifyAll', () => {
  it('leaves manual decisions out of the output', () => {
    const out = run([makeTx({ id: 't1', description: 'LOJA' })], {
      existing: [makeClassification({ transactionId: 't1', source: 'manual', categoryId: 5 })],
    });
    expect(byId(out, 't1')).toBeUndefined();
    expect(out.modelQueue).toEqual([]);
  });

  it('applies a category rule with its owner', () => {
    const tx = makeTx({ id: 't1', ...card, description: 'NETFLIX.COM', amountCents: -4590 });
    const out = run([tx], { rules: [makeRule({ id: 3, merchantKey: 'NETFLIX COM', setCategoryId: 9, setOwner: 'pessoa1' })] });
    expect(byId(out, 't1')).toMatchObject({
      nature: 'expense',
      categoryId: 9,
      owner: 'pessoa1',
      source: 'rule',
      ruleId: 3,
      reviewReason: null,
    });
    expect(out.modelQueue).toEqual([]);
  });

  it('classifies paired transfers without category', () => {
    const out = run([
      makeTx({ id: 'out', accountId: 'c6', amountCents: -50000, description: 'TRANSFERENCIA ENVIADA' }),
      makeTx({ id: 'in', accountId: 'inter', amountCents: 50000, description: 'TRANSFERENCIA RECEBIDA' }),
    ]);
    expect(byId(out, 'out')).toMatchObject({
      nature: 'transfer',
      transferKind: 'internal',
      transferPairId: 'in',
      categoryId: null,
      reviewReason: null,
      source: 'system',
    });
    expect(byId(out, 'in')).toMatchObject({ nature: 'transfer', transferPairId: 'out' });
    expect(out.modelQueue).toEqual([]);
  });

  it('lets a rule that sets the nature win over pairing', () => {
    const out = run(
      [
        makeTx({ id: 'out', accountId: 'c6', amountCents: -50000, description: 'COMPRA LOJA' }),
        makeTx({ id: 'in', accountId: 'inter', amountCents: 50000, description: 'REEMBOLSO EMPRESA' }),
      ],
      { rules: [makeRule({ id: 1, merchantKey: 'REEMBOLSO EMPRESA', setNature: 'income', setCategoryId: 20 })] },
    );
    expect(byId(out, 'in')).toMatchObject({ nature: 'income', categoryId: 20, source: 'rule', transferPairId: null });
    expect(byId(out, 'out')).toMatchObject({ nature: 'expense', reviewReason: 'uncategorized' });
    expect(out.modelQueue.map((t) => t.id)).toEqual(['out']);
  });

  it('sends income from the PJ to review and lets amount rules split it', () => {
    const tx = makeTx({
      id: 'pj',
      amountCents: 300000,
      description: 'PIX RECEBIDO FULANO SERVICOS LTDA',
      counterpartDocType: 'cnpj',
      counterpartDoc: '12345678000199',
    });
    const out = run([tx]);
    expect(byId(out, 'pj')).toMatchObject({ nature: 'income', categoryId: null, reviewReason: 'pj_income' });
    expect(out.modelQueue).toEqual([]);

    const rule = makeRule({ id: 4, merchantKey: tx.merchantKey, minCents: 300000, maxCents: 300000, setCategoryId: 21 });
    expect(byId(run([tx], { rules: [rule] }), 'pj')).toMatchObject({ nature: 'income', categoryId: 21, reviewReason: null });
  });

  it('sends Pix between people to review, never to the model', () => {
    const tx = makeTx({
      id: 'pix',
      amountCents: -5000,
      description: 'PIX ENVIADO MARIA',
      counterpartDocType: 'cpf',
      counterpartDoc: '33333333333',
    });
    const out = run([tx]);
    expect(byId(out, 'pix')).toMatchObject({ nature: 'expense', reviewReason: 'pix_person' });
    expect(out.modelQueue).toEqual([]);
  });

  it('flags other inflows as ambiguous', () => {
    const out = run([makeTx({ id: 'cash', amountCents: 2000, description: 'CASHBACK' })]);
    expect(byId(out, 'cash')).toMatchObject({ nature: 'income', reviewReason: 'ambiguous_inflow' });
    expect(out.modelQueue).toEqual([]);
  });

  it('queues unknown expenses for the model', () => {
    const out = run([makeTx({ id: 'u', ...card, description: 'LOJA XPTO', amountCents: -3300 })]);
    expect(byId(out, 'u')).toMatchObject({
      nature: 'expense',
      categoryId: null,
      reviewReason: 'uncategorized',
      source: 'system',
    });
    expect(out.modelQueue.map((t) => t.id)).toEqual(['u']);
  });

  it('applies an owner-only rule and still asks the model for the category', () => {
    const tx = makeTx({ id: 'g', ...card, cardLast4: '9876', description: 'LOJA ROUPA', amountCents: -15000 });
    const out = run([tx], { rules: [makeRule({ id: 7, cardLast4: '9876', setOwner: 'pessoa2' })] });
    expect(byId(out, 'g')).toMatchObject({ owner: 'pessoa2', reviewReason: 'uncategorized', ruleId: 7 });
    expect(out.modelQueue.map((t) => t.id)).toEqual(['g']);
  });

  it('keeps earlier model answers instead of asking again', () => {
    const out = run(
      [
        makeTx({ id: 'sure', ...card, description: 'IFOOD', amountCents: -100 }),
        makeTx({ id: 'unsure', ...card, description: 'LOJA NOVA', amountCents: -200 }),
      ],
      {
        existing: [
          makeClassification({ transactionId: 'sure', source: 'model', model: 'm', categoryId: 12, confidence: 'high' }),
          makeClassification({ transactionId: 'unsure', source: 'model', model: 'm', categoryId: 13, confidence: 'medium' }),
        ],
      },
    );
    expect(byId(out, 'sure')).toMatchObject({ categoryId: 12, source: 'model', model: 'm', reviewReason: null });
    expect(byId(out, 'unsure')).toMatchObject({ categoryId: 13, confidence: 'medium', reviewReason: 'low_confidence' });
    expect(out.modelQueue).toEqual([]);
  });

  it('gives a card refund the category and owner of the matching purchase', () => {
    const purchase = makeTx({ id: 'buy', ...card, description: 'NETFLIX.COM', amountCents: -4590 });
    const refund = makeTx({ id: 'back', ...card, description: 'NETFLIX.COM', amountCents: 4590 });
    const out = run([purchase, refund], {
      existing: [makeClassification({ transactionId: 'buy', source: 'manual', categoryId: 9, owner: 'pessoa1' })],
    });
    expect(byId(out, 'back')).toMatchObject({ nature: 'expense', categoryId: 9, owner: 'pessoa1', reviewReason: null });
  });

  it('gives every installment of a purchase the decision made by hand on one of them', () => {
    const installment = (id: string, number: number, date: string) =>
      makeTx({ id, ...card, date, description: 'APP *CURSO ONLINE', amountCents: -70000, installmentNumber: number, installmentTotal: 12, purchaseDate: '2026-05-07' });
    const out = run([installment('p6', 6, '2026-09-21'), installment('p7', 7, '2026-10-20')], {
      existing: [
        makeClassification({ transactionId: 'p6', source: 'manual', categoryId: 12, owner: 'pessoa1' }),
        makeClassification({ transactionId: 'p7', source: 'model', categoryId: 17, confidence: 'low', reviewReason: 'low_confidence' }),
      ],
    });
    expect(byId(out, 'p7')).toMatchObject({ categoryId: 12, owner: 'pessoa1', source: 'system', reviewReason: null });
    expect(out.modelQueue).toEqual([]);
  });

  it('sends a card credit that matches a purchase value to review as a possible refund', () => {
    const purchase = makeTx({ id: 'trip', ...card, date: '2026-10-14', description: 'BUS SERVICOS*CLICKBUS', amountCents: -21000, installmentNumber: 1, installmentTotal: 4, purchaseDate: '2026-10-14' });
    const refund = makeTx({ id: 'back', ...card, date: '2026-10-14', description: 'Refund', amountCents: 42000 });
    const out = run([purchase, refund], {
      existing: [makeClassification({ transactionId: 'trip', source: 'model', categoryId: 14, owner: 'casal', confidence: 'high' })],
    });
    expect(byId(out, 'back')).toMatchObject({ nature: 'expense', categoryId: 14, source: 'system', reviewReason: 'refund' });
    expect(out.modelQueue.map((tx) => tx.id)).not.toContain('back');
  });

  it('ignores removed transactions and the voucher account', () => {
    const out = run([
      makeTx({ id: 'gone', status: 'removed' }),
      makeTx({ id: 'v', accountKind: 'voucher', accountId: 'manual:flash' }),
    ]);
    expect(out.classifications).toEqual([]);
  });

  it('records the purchase group of installments', () => {
    const tx = makeTx({
      id: 'tv',
      ...card,
      description: 'LOJA TV',
      amountCents: -10000,
      date: '2026-10-05',
      installmentNumber: 2,
      installmentTotal: 10,
    });
    expect(byId(run([tx]), 'tv')?.purchaseGroup).toBe('card|LOJA TV|2026-09|10');
  });
});
