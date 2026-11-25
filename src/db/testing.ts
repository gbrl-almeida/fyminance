import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { AccountKind, Classification, Holder, Tx, TxOrigin } from '../core/types';
import { migrateDb, wrap, type Db, type OpenDb } from './client';
import { accounts, categories, classifications, transactions } from './schema';
import { seedCategories } from './seed';

const TEST_TIME = '2026-01-01T00:00:00.000Z';

export function createTestDb(): OpenDb {
  const sqlite = new Database(':memory:');
  const db = wrap(sqlite);
  migrateDb(db);
  seedCategories(db);
  return { db, sqlite };
}

export function insertTestAccount(
  db: Db,
  account: {
    id: string;
    kind: AccountKind;
    owner?: Holder;
    name?: string;
    connectionId?: string | null;
    countsAsInvestment?: boolean | null;
    ledgerFrom?: string | null;
    ledgerUntil?: string | null;
    raw?: string | null;
  },
): void {
  db.insert(accounts)
    .values({
      id: account.id,
      kind: account.kind,
      owner: account.owner ?? 'pessoa1',
      name: account.name ?? account.id,
      connectionId: account.connectionId ?? null,
      raw: account.raw ?? null,
      countsAsInvestment: account.countsAsInvestment ?? null,
      ledgerFrom: account.ledgerFrom ?? null,
      ledgerUntil: account.ledgerUntil ?? null,
    })
    .run();
}

export function insertTestTx(
  db: Db,
  tx: Tx,
  options: { missingSince?: string | null; origin?: TxOrigin; createdBy?: Holder | null; raw?: unknown } = {},
): void {
  db.insert(transactions)
    .values({
      id: tx.id,
      accountId: tx.accountId,
      date: tx.date,
      amountCents: tx.amountCents,
      description: tx.description,
      merchantKey: tx.merchantKey,
      status: tx.status,
      cardLast4: tx.cardLast4,
      installmentNumber: tx.installmentNumber,
      installmentTotal: tx.installmentTotal,
      purchaseDate: tx.purchaseDate,
      billId: tx.billId,
      counterpartDocType: tx.counterpartDocType,
      counterpartDoc: tx.counterpartDoc,
      raw: JSON.stringify(options.raw ?? {}),
      firstSeenAt: TEST_TIME,
      updatedAt: TEST_TIME,
      missingSince: options.missingSince ?? null,
      origin: options.origin ?? 'pluggy',
      createdBy: options.createdBy ?? null,
    })
    .run();
}

export function insertTestClassification(db: Db, cls: Classification): void {
  db.insert(classifications).values({ ...cls, updatedAt: TEST_TIME }).run();
}

export function categoryIdByName(db: Db, name: string): number {
  const row = db.select({ id: categories.id }).from(categories).where(eq(categories.name, name)).get();
  if (row === undefined) throw new Error(`Categoria de teste não encontrada: ${name}`);
  return row.id;
}
