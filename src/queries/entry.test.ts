import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeClassification, makeTx } from '../core/testing';
import { annotate, offsetCredit, splitTransaction } from '../curation/entries';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import { reclassify } from '../jobs/reclassify';
import { getEntry } from './entry';

const pipeline: PipelineConfig = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() };
const ctx = { pipeline, now: () => new Date('2026-10-20T10:00:00.000Z'), actor: 'pessoa1' as const };
const card = { accountId: 'card', accountKind: 'credit_card' as const };
const dad = { accountId: 'c6', counterpartDocType: 'cpf' as const, counterpartDoc: '55555555555' };

async function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'card', kind: 'credit_card', name: 'C6 · Cartão' });
  insertTestAccount(db, { id: 'c6', kind: 'checking', name: 'C6 · Conta' });
  const add = (tx: Parameters<typeof makeTx>[0]) => insertTestTx(db, makeTx(tx));
  add({ id: 'tires', ...card, date: '2026-01-20', amountCents: -125000, description: 'LOJA DE PNEUS EXEMPLO LTDA' });
  add({ id: 'pix-feb', ...dad, date: '2026-02-05', amountCents: 45000, description: 'JOSE DA SILVA' });
  add({ id: 'pix-mar', ...dad, date: '2026-03-12', amountCents: 25000, description: 'JOSE DA SILVA' });
  add({ id: 'trip', ...card, date: '2026-10-14', amountCents: -21000, description: 'BUS SERVICOS*CLICKBUS', installmentNumber: 1, installmentTotal: 4, purchaseDate: '2026-10-14' });
  add({ id: 'refund', ...card, date: '2026-10-14', amountCents: 42000, description: 'Refund' });
  add({ id: 'shopee', ...card, date: '2026-10-05', amountCents: -10000, description: 'SHOPEE *LOJA' });
  await reclassify({ db, pipeline, classifier: null, now: ctx.now });
  return db;
}

describe('getEntry', () => {
  it('shows a purchase with its note, the credits that paid it back and what is still missing', async () => {
    const db = await setup();
    await annotate(db, { transactionId: 'tires', note: 'pneus do carro' }, ctx);
    await offsetCredit(db, { creditId: 'pix-feb', purchaseId: 'tires' }, ctx);
    const entry = getEntry(db, 'tires');
    expect(entry).toMatchObject({
      id: 'tires',
      account: 'C6 · Cartão',
      amountCents: -125000,
      note: { text: 'pneus do carro', by: 'pessoa1' },
      purchase: { totalCents: 125000, offsetCents: 45000, leftCents: 80000 },
      credit: null,
    });
    expect(entry.purchase?.links).toEqual([{ id: 'pix-feb', date: '2026-02-05', description: 'JOSE DA SILVA', account: 'C6 · Conta', amountCents: 45000 }]);
    expect(entry.candidates.map((c) => [c.id, c.leftCents])).toEqual([['pix-mar', 25000]]);
  });

  it('leaves decided income out of the credits that may pay a purchase back, unless searched', async () => {
    const db = await setup();
    insertTestTx(db, makeTx({ id: 'salary', accountId: 'c6', date: '2026-02-05', amountCents: 500000, description: 'SALARIO EMPRESA' }));
    insertTestClassification(db, makeClassification({ transactionId: 'salary', nature: 'income', categoryId: categoryIdByName(db, 'Salário'), source: 'rule' }));
    expect(getEntry(db, 'tires').candidates.map((c) => c.id)).not.toContain('salary');
    expect(getEntry(db, 'tires', { search: 'salario' }).candidates.map((c) => c.id)).toEqual(['salary']);
  });

  it('puts the matching purchase first among the candidates of a refund', async () => {
    const db = await setup();
    const entry = getEntry(db, 'refund');
    expect(entry.credit).toEqual({ totalCents: 42000, usedCents: 0, leftCents: 42000, links: [] });
    expect(entry.candidates[0]).toMatchObject({ id: 'trip', installment: '1/4', leftCents: 84000, match: true });
    // Sem busca, só compras do mesmo cartão até 120 dias antes; a busca procura em todas.
    expect(entry.candidates.map((c) => c.id)).toEqual(['trip', 'shopee']);
    expect(getEntry(db, 'refund', { search: 'shopee' }).candidates.map((c) => c.id)).toEqual(['shopee']);
    expect(getEntry(db, 'refund', { search: 'pneus' }).candidates.map((c) => c.id)).toEqual(['tires']);
  });

  it('shows the parts of a split purchase', async () => {
    const db = await setup();
    const home = categoryIdByName(db, 'Casa');
    const health = categoryIdByName(db, 'Saúde');
    await splitTransaction(db, { transactionId: 'shopee', parts: [{ amountCents: 7000, categoryId: home, owner: 'casal' }, { amountCents: 3000, categoryId: health, owner: 'pessoa1' }] }, ctx);
    expect(getEntry(db, 'shopee').split).toEqual({
      anchorId: 'shopee',
      parts: [
        { amountCents: 7000, categoryId: home, category: 'Casa', owner: 'casal' },
        { amountCents: 3000, categoryId: health, category: 'Saúde', owner: 'pessoa1' },
      ],
    });
  });

  it('fails for an unknown transaction', () => {
    const { db } = createTestDb();
    expect(() => getEntry(db, 'nope')).toThrow(/não existe/);
  });
});
