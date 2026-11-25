import { and, eq, gte, isNull, lt, or } from 'drizzle-orm';
import type { AccountKind, Category, Classification, Rule, Tx } from '../core/types';
import { inTransaction, type Db } from './client';
import { accounts, categories, classifications, rules, transactions } from './schema';

export function toTx(row: typeof transactions.$inferSelect, accountKind: AccountKind): Tx {
  return {
    id: row.id,
    accountId: row.accountId,
    accountKind,
    date: row.date,
    amountCents: row.amountCents,
    description: row.description,
    merchantKey: row.merchantKey,
    status: row.status,
    cardLast4: row.cardLast4,
    installmentNumber: row.installmentNumber,
    installmentTotal: row.installmentTotal,
    purchaseDate: row.purchaseDate,
    billId: row.billId,
    counterpartDocType: row.counterpartDocType,
    counterpartDoc: row.counterpartDoc,
  };
}

export function loadTxs(db: Db): Tx[] {
  return db
    .select({ row: transactions, kind: accounts.kind })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        or(isNull(accounts.ledgerFrom), gte(transactions.date, accounts.ledgerFrom)),
        or(isNull(accounts.ledgerUntil), lt(transactions.date, accounts.ledgerUntil)),
      ),
    )
    .orderBy(transactions.date, transactions.id)
    .all()
    .map(({ row, kind }) => toTx(row, kind));
}

export function loadClassifications(db: Db): Map<string, Classification> {
  const rows = db.select().from(classifications).all();
  return new Map(rows.map(({ updatedAt: _updatedAt, ...cls }) => [cls.transactionId, cls]));
}

export function saveClassifications(db: Db, list: readonly Classification[], nowIso: string): number {
  if (list.length === 0) return 0;
  const manual = new Set(
    db
      .select({ id: classifications.transactionId })
      .from(classifications)
      .where(eq(classifications.source, 'manual'))
      .all()
      .map((row) => row.id),
  );
  let saved = 0;
  inTransaction(db, () => {
    for (const cls of list) {
      if (manual.has(cls.transactionId)) continue;
      const values = { ...cls, updatedAt: nowIso };
      db.insert(classifications).values(values).onConflictDoUpdate({ target: classifications.transactionId, set: values }).run();
      saved += 1;
    }
  });
  return saved;
}

export function loadRules(db: Db): Rule[] {
  return db
    .select()
    .from(rules)
    .orderBy(rules.id)
    .all()
    .map(({ origin: _origin, ...rule }) => rule);
}

export function loadCategories(db: Db): Category[] {
  return db.select().from(categories).orderBy(categories.id).all();
}

export function categoryPath(list: readonly Category[], id: number): string {
  const category = list.find((c) => c.id === id);
  if (category === undefined) return `#${id}`;
  if (category.parentId === null) return category.name;
  const parent = list.find((c) => c.id === category.parentId);
  return parent === undefined ? category.name : `${parent.name} > ${category.name}`;
}
