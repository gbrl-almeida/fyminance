import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeTx } from '../core/testing';
import { loadClassifications } from '../db/ledger';
import { offsets, transactionNotes, transactionSplits } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { reclassify } from '../jobs/reclassify';
import { categorize } from './categorize';
import { annotate, offsetCredit, splitTransaction } from './entries';

const pipeline: PipelineConfig = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() };
const ctx = { pipeline, now: () => new Date('2026-10-20T10:00:00.000Z'), actor: 'pessoa1' as const };
const card = { accountId: 'card', accountKind: 'credit_card' as const };

async function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'card', kind: 'credit_card' });
  insertTestAccount(db, { id: 'c6', kind: 'checking' });
  const add = (tx: Parameters<typeof makeTx>[0]) => insertTestTx(db, makeTx(tx));
  add({ id: 'shopee', ...card, date: '2026-10-05', amountCents: -10000, description: 'SHOPEE *LOJA' });
  add({ id: 'trip', ...card, date: '2026-10-14', amountCents: -21000, description: 'BUS SERVICOS*CLICKBUS', installmentNumber: 1, installmentTotal: 4, purchaseDate: '2026-10-14' });
  add({ id: 'refund-1', ...card, date: '2026-10-14', amountCents: 42000, description: 'Refund' });
  add({ id: 'refund-2', ...card, date: '2026-10-14', amountCents: 42000, description: 'Refund' });
  add({ id: 'dad', accountId: 'c6', date: '2026-10-16', amountCents: 40000, description: 'PIX RECEBIDO JOSE', counterpartDocType: 'cpf', counterpartDoc: '55555555555' });
  add({ id: 'bill', accountId: 'c6', date: '2026-10-10', amountCents: -30000, description: 'PAGAMENTO DE FATURA DO CARTAO' });
  await reclassify({ db, pipeline, classifier: null, now: ctx.now });
  return db;
}

describe('annotate', () => {
  it('saves, replaces and clears the note of a transaction', async () => {
    const db = await setup();
    await annotate(db, { transactionId: 'shopee', note: '  creatina e pré-treino ' }, ctx);
    expect(db.select().from(transactionNotes).all()).toEqual([
      { transactionId: 'shopee', note: 'creatina e pré-treino', updatedBy: 'pessoa1', updatedAt: '2026-10-20T10:00:00.000Z' },
    ]);
    await annotate(db, { transactionId: 'shopee', note: 'capinha' }, { ...ctx, actor: 'pessoa2' });
    expect(db.select().from(transactionNotes).all()).toMatchObject([{ note: 'capinha', updatedBy: 'pessoa2' }]);
    await annotate(db, { transactionId: 'shopee', note: ' ' }, ctx);
    expect(db.select().from(transactionNotes).all()).toEqual([]);
    await expect(annotate(db, { transactionId: 'nope', note: 'x' }, ctx)).rejects.toThrow(/não existe/);
  });
});

describe('splitTransaction', () => {
  it('saves the parts and gives the purchase the category and owner of the biggest one', async () => {
    const db = await setup();
    const home = categoryIdByName(db, 'Casa');
    const health = categoryIdByName(db, 'Saúde');
    await splitTransaction(
      db,
      {
        transactionId: 'shopee',
        parts: [
          { amountCents: 3000, categoryId: health, owner: 'pessoa1' },
          { amountCents: 7000, categoryId: home, owner: 'casal' },
        ],
      },
      ctx,
    );
    expect(db.select().from(transactionSplits).all()).toEqual([
      { transactionId: 'shopee', position: 0, amountCents: 3000, categoryId: health, owner: 'pessoa1' },
      { transactionId: 'shopee', position: 1, amountCents: 7000, categoryId: home, owner: 'casal' },
    ]);
    expect(loadClassifications(db).get('shopee')).toMatchObject({ categoryId: home, owner: 'casal', source: 'manual', reviewReason: null });

    await splitTransaction(db, { transactionId: 'shopee', parts: [] }, ctx);
    expect(db.select().from(transactionSplits).all()).toEqual([]);
  });

  it('refuses parts that do not add up, income categories, credits and transfers', async () => {
    const db = await setup();
    const home = categoryIdByName(db, 'Casa');
    const part = (amountCents: number, categoryId = home) => ({ amountCents, categoryId, owner: 'casal' as const });
    await expect(splitTransaction(db, { transactionId: 'shopee', parts: [part(3000), part(6000)] }, ctx)).rejects.toThrow(/somar R\$ 100,00/);
    await expect(splitTransaction(db, { transactionId: 'shopee', parts: [part(10000)] }, ctx)).rejects.toThrow(/duas partes/);
    await expect(splitTransaction(db, { transactionId: 'shopee', parts: [part(5000), part(5000, categoryIdByName(db, 'Salário'))] }, ctx)).rejects.toThrow(/gasto/);
    await expect(splitTransaction(db, { transactionId: 'dad', parts: [part(20000), part(20000)] }, ctx)).rejects.toThrow(/saídas/);
    await expect(splitTransaction(db, { transactionId: 'bill', parts: [part(10000), part(20000)] }, ctx)).rejects.toThrow(/transferência/);
  });
});

describe('offsetCredit', () => {
  it('links refunds to an installment purchase up to its whole value and settles the credit', async () => {
    const db = await setup();
    const travel = categoryIdByName(db, 'Viagem');
    await categorize(db, { target: { transactionIds: ['trip'] }, categoryId: travel, scope: 'only_these' }, ctx);

    expect(await offsetCredit(db, { creditId: 'refund-1', purchaseId: 'trip' }, ctx)).toEqual({ amountCents: 42000 });
    expect(await offsetCredit(db, { creditId: 'refund-2', purchaseId: 'trip' }, ctx)).toEqual({ amountCents: 42000 });
    expect(db.select().from(offsets).all().map((o) => [o.creditId, o.purchaseId, o.amountCents, o.createdBy])).toEqual([
      ['refund-1', 'trip', 42000, 'pessoa1'],
      ['refund-2', 'trip', 42000, 'pessoa1'],
    ]);
    expect(loadClassifications(db).get('refund-1')).toMatchObject({ nature: 'expense', categoryId: travel, source: 'manual', reviewReason: null });
    await expect(offsetCredit(db, { creditId: 'dad', purchaseId: 'trip' }, ctx)).rejects.toThrow(/já foi abatida/);
  });

  it('takes only what the purchase still lacks and leaves the rest of the credit undecided', async () => {
    const db = await setup();
    expect(await offsetCredit(db, { creditId: 'dad', purchaseId: 'shopee' }, ctx)).toEqual({ amountCents: 10000 });
    expect(loadClassifications(db).get('dad')).toMatchObject({ reviewReason: 'pix_person' });
    await expect(offsetCredit(db, { creditId: 'dad', purchaseId: 'shopee', amountCents: 20000 }, ctx)).rejects.toThrow(/R\$ 100,00/);
  });

  it('removes a link with a zero amount', async () => {
    const db = await setup();
    await offsetCredit(db, { creditId: 'dad', purchaseId: 'shopee', amountCents: 5000 }, ctx);
    await offsetCredit(db, { creditId: 'dad', purchaseId: 'shopee', amountCents: 0 }, ctx);
    expect(db.select().from(offsets).all()).toEqual([]);
  });

  it('refuses links between the wrong kinds of transaction', async () => {
    const db = await setup();
    await expect(offsetCredit(db, { creditId: 'shopee', purchaseId: 'trip' }, ctx)).rejects.toThrow(/crédito/);
    await expect(offsetCredit(db, { creditId: 'dad', purchaseId: 'refund-1' }, ctx)).rejects.toThrow(/compra/);
    await expect(offsetCredit(db, { creditId: 'dad', purchaseId: 'bill' }, ctx)).rejects.toThrow(/transferência/);
  });
});
