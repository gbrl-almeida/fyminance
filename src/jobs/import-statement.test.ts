import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { loadClassifications } from '../db/ledger';
import { accounts, transactions } from '../db/schema';
import { createTestDb } from '../db/testing';
import type { ParsedStatement } from '../integrations/files/statement';
import { getPendingItems } from '../queries/pending';
import { importStatement } from './import-statement';

const pipeline: PipelineConfig = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() };
const now = () => new Date('2026-10-20T10:00:00.000Z');

const row = (date: string, description: string, amountCents: number, extra: Partial<ParsedStatement['rows'][number]> = {}) => ({
  date,
  purchaseDate: null,
  description,
  amountCents,
  installmentNumber: null,
  installmentTotal: null,
  cardLast4: '1234',
  ...extra,
});

const statement: ParsedStatement = {
  bank: 'teste',
  cardLast4: '1234',
  dueDate: '2026-10-15',
  totalCents: null,
  rows: [
    row('2026-09-10', 'PADARIA DO BAIRRO', -1500),
    row('2026-09-12', 'LOJA TV 02/10', -50000, { purchaseDate: '2026-08-12', installmentNumber: 2, installmentTotal: 10 }),
    row('2026-09-20', 'ESTORNO LOJA', 2000),
  ],
};

function run(db: ReturnType<typeof createTestDb>['db'], s: ParsedStatement, totalCents?: number) {
  return importStatement(
    { db, pipeline, classifier: null, now },
    { accountId: 'file:c6', accountName: 'C6 · Cartão (arquivo)', owner: 'pessoa1', statement: s, ...(totalCents === undefined ? {} : { totalCents }) },
  );
}

describe('importStatement', () => {
  it('import inserts file transactions and classifies', async () => {
    const { db } = createTestDb();
    const result = await run(db, statement, 49500);
    expect(result).toEqual({ inserted: 3, skipped: 0, billId: 'file:file:c6:2026-10-15' });
    const rows = db.select().from(transactions).all();
    expect(rows.every((t) => t.origin === 'file' && t.accountId === 'file:c6' && t.billId === result.billId)).toBe(true);
    expect(rows.find((t) => t.description === 'PADARIA DO BAIRRO')?.merchantKey).toBe('PADARIA DO BAIRRO');
    expect(db.select().from(accounts).all()).toEqual([expect.objectContaining({ id: 'file:c6', kind: 'credit_card', connectionId: null })]);
    expect(loadClassifications(db).size).toBe(3);
  });

  it('keeps the purchase date of an installment', async () => {
    const { db } = createTestDb();
    await run(db, statement);
    const tv = db.select().from(transactions).all().find((t) => t.description === 'LOJA TV 02/10');
    expect(tv).toMatchObject({ date: '2026-09-12', purchaseDate: '2026-08-12' });
  });

  it('reimporting the same statement inserts nothing', async () => {
    const { db } = createTestDb();
    await run(db, statement, 49500);
    expect(await run(db, statement, 49500)).toMatchObject({ inserted: 0, skipped: 3 });
    expect(db.select().from(transactions).all()).toHaveLength(3);
  });

  it('two identical lines in one file are both kept', async () => {
    const { db } = createTestDb();
    const twice = { ...statement, rows: [row('2026-09-10', 'CAFE', -800), row('2026-09-10', 'CAFE', -800)] };
    expect(await run(db, twice, 1600)).toMatchObject({ inserted: 2 });
  });

  it('overlapping statements do not duplicate', async () => {
    const { db } = createTestDb();
    await run(db, statement, 49500);
    const later = { ...statement, rows: [...statement.rows, row('2026-09-25', 'MERCADO', -10000)] };
    expect(await run(db, later, 59500)).toMatchObject({ inserted: 1, skipped: 3 });
  });

  it('bill total feeds the bill check', async () => {
    const { db } = createTestDb();
    await run(db, statement, 50000);
    expect(getPendingItems(db, { today: '2026-10-20' }).billDivergences).toEqual([
      expect.objectContaining({ id: 'file:file:c6:2026-10-15', totalCents: 50000, computedCents: 49500, diffCents: 500 }),
    ]);
  });

  it('without due date or total there is no bill', async () => {
    const { db } = createTestDb();
    expect(await run(db, { ...statement, dueDate: null })).toMatchObject({ billId: null });
  });

  it('refuses an account that is not a card', async () => {
    const { db } = createTestDb();
    db.insert(accounts).values({ id: 'file:c6', kind: 'checking', name: 'x', owner: 'pessoa1' }).run();
    await expect(run(db, statement, 49500)).rejects.toThrow('A conta file:c6 não é de cartão.');
  });

  it('reimporting with a total links the existing rows to the bill', async () => {
    const { db } = createTestDb();
    expect(await run(db, statement)).toMatchObject({ inserted: 3, billId: null });
    expect(await run(db, statement, 49500)).toMatchObject({ inserted: 0, billId: 'file:file:c6:2026-10-15' });
    expect(getPendingItems(db, { today: '2026-10-20' }).billDivergences).toEqual([]);
  });
});
