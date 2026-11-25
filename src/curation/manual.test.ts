import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeTx } from '../core/testing';
import { loadClassifications } from '../db/ledger';
import { accounts, bills, monthChecks, transactions } from '../db/schema';
import { getPendingItems } from '../queries/pending';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { reclassify } from '../jobs/reclassify';
import { ensureVoucher } from '../jobs/voucher';
import { createManualEntry, deleteManualEntry, MANUAL_ACCOUNT_ID, setVoucherSpend, updateManualEntry } from './manual';

const pipeline: PipelineConfig = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() };
const ctx = { pipeline, now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa2' as const };

describe('manual entries', () => {
  it('createManualEntry stores a manual expense', async () => {
    const { db } = createTestDb();
    const food = categoryIdByName(db, 'Mercado');
    const { id } = await createManualEntry(
      db,
      { date: '2026-10-03', amountCents: 1500, description: 'Feira de domingo', nature: 'expense', categoryId: food, owner: 'casal' },
      ctx,
    );
    const tx = db.select().from(transactions).where(eq(transactions.id, id)).get();
    expect(tx).toMatchObject({ accountId: MANUAL_ACCOUNT_ID, amountCents: -1500, origin: 'manual', createdBy: 'pessoa2', status: 'posted' });
    expect(loadClassifications(db).get(id)).toMatchObject({ source: 'manual', nature: 'expense', categoryId: food, owner: 'casal' });
    expect(db.select().from(accounts).where(eq(accounts.id, MANUAL_ACCOUNT_ID)).get()).toMatchObject({ kind: 'cash' });
  });

  it('manual income is positive', async () => {
    const { db } = createTestDb();
    const { id } = await createManualEntry(
      db,
      { date: '2026-10-05', amountCents: 300000, description: 'Pró-labore', nature: 'income', categoryId: categoryIdByName(db, 'Pró-labore'), owner: 'pessoa1' },
      ctx,
    );
    expect(db.select().from(transactions).where(eq(transactions.id, id)).get()?.amountCents).toBe(300000);
  });

  it('entry on a card account keeps that account', async () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    const { id } = await createManualEntry(
      db,
      { accountId: 'card', date: '2026-10-10', amountCents: 4590, description: 'Diferença da fatura', nature: 'expense', categoryId: categoryIdByName(db, 'Outros'), owner: 'casal' },
      ctx,
    );
    expect(db.select().from(transactions).where(eq(transactions.id, id)).get()?.accountId).toBe('card');
  });

  it('update and delete refuse bank data', async () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    insertTestTx(db, makeTx({ id: 'bank', accountId: 'card', accountKind: 'credit_card' }));
    const input = { date: '2026-10-10', amountCents: 100, description: 'x', nature: 'expense' as const, categoryId: categoryIdByName(db, 'Outros'), owner: 'casal' as const };
    await expect(updateManualEntry(db, 'bank', input, ctx)).rejects.toThrow('Só lançamentos manuais podem ser alterados.');
    await expect(deleteManualEntry(db, 'bank', ctx)).rejects.toThrow('Só lançamentos manuais podem ser alterados.');
  });

  it('update changes a manual entry and delete removes it', async () => {
    const { db } = createTestDb();
    const base = { date: '2026-10-03', amountCents: 1500, description: 'Feira', nature: 'expense' as const, categoryId: categoryIdByName(db, 'Mercado'), owner: 'casal' as const };
    const { id } = await createManualEntry(db, base, ctx);
    await updateManualEntry(db, id, { ...base, amountCents: 2000, owner: 'pessoa1' }, ctx);
    expect(db.select().from(transactions).where(eq(transactions.id, id)).get()?.amountCents).toBe(-2000);
    expect(loadClassifications(db).get(id)?.owner).toBe('pessoa1');
    await deleteManualEntry(db, id, ctx);
    expect(db.select().from(transactions).where(eq(transactions.id, id)).get()).toBeUndefined();
    expect(loadClassifications(db).get(id)).toBeUndefined();
  });

  it('reclassify keeps manual entries', async () => {
    const { db } = createTestDb();
    const food = categoryIdByName(db, 'Mercado');
    const { id } = await createManualEntry(
      db,
      { date: '2026-10-03', amountCents: 1500, description: 'Feira', nature: 'expense', categoryId: food, owner: 'pessoa1' },
      ctx,
    );
    await reclassify({ db, pipeline, classifier: null, now: ctx.now });
    expect(loadClassifications(db).get(id)).toMatchObject({ source: 'manual', categoryId: food, owner: 'pessoa1' });
  });

  it('setVoucherSpend overwrites the month estimate', () => {
    const { db } = createTestDb();
    ensureVoucher(db, { monthlyCents: 80000, today: '2026-10-14', nowIso: '2026-10-14T10:00:00.000Z' });
    setVoucherSpend(db, '2026-10', 110000, ctx);
    expect(db.select().from(transactions).where(eq(transactions.id, 'voucher:2026-10:out')).get()?.amountCents).toBe(-110000);
    expect(db.select().from(monthChecks).all()).toEqual([
      expect.objectContaining({ month: '2026-10', key: 'flash', doneBy: 'pessoa2' }),
    ]);
  });

  it('setVoucherSpend fails when the month has no voucher entry', () => {
    const { db } = createTestDb();
    expect(() => setVoucherSpend(db, '2026-10', 110000, ctx)).toThrow('O vale-alimentação não tem lançamento em 2026-10.');
  });

  it('a difference launched on a bill resolves the bill divergence', async () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'card', kind: 'credit_card' });
    insertTestTx(db, makeTx({ id: 'buy', accountId: 'card', accountKind: 'credit_card', date: '2026-08-01', amountCents: -10000, billId: 'b1' }));
    insertTestTx(db, makeTx({ id: 'buy2', accountId: 'card', accountKind: 'credit_card', date: '2026-09-20', amountCents: -20000, billId: 'b1' }));
    db.insert(bills).values({ id: 'b1', accountId: 'card', dueDate: '2026-10-10', totalCents: 30500, raw: '{}' }).run();
    expect(getPendingItems(db, { today: '2026-10-14' }).billDivergences.map((d) => d.diffCents)).toEqual([500]);
    await createManualEntry(
      db,
      { accountId: 'card', billId: 'b1', date: '2026-09-30', amountCents: 500, description: 'Diferença da fatura', nature: 'expense', categoryId: categoryIdByName(db, 'Outros'), owner: 'casal' },
      ctx,
    );
    expect(getPendingItems(db, { today: '2026-10-14' }).billDivergences).toEqual([]);
  });
});
