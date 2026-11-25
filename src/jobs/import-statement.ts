import { createHash } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import type { PipelineConfig } from '../core/classify';
import { normalizeMerchantKey } from '../core/merchant';
import type { Holder } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { accounts, bills, transactions } from '../db/schema';
import type { ParsedStatement } from '../integrations/files/statement';
import type { Classifier } from '../integrations/openrouter/classifier';
import { reclassify } from './reclassify';

export interface ImportDeps {
  db: Db;
  pipeline: PipelineConfig;
  classifier: Classifier | null;
  now: () => Date;
}

export interface ImportInput {
  accountId: string;
  accountName: string;
  owner: Holder;
  statement: ParsedStatement;
  /** Total da fatura informado à mão quando o arquivo não traz. */
  totalCents?: number;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);

/** Grava a fatura de um arquivo na camada do banco. Importar de novo, ou um arquivo que se sobrepõe, não duplica. */
export async function importStatement(deps: ImportDeps, input: ImportInput): Promise<{ inserted: number; skipped: number; billId: string | null }> {
  const { db, now } = deps;
  const { accountId, statement } = input;
  const nowIso = now().toISOString();
  const totalCents = statement.totalCents ?? input.totalCents ?? null;
  const billId = statement.dueDate !== null && totalCents !== null ? `file:${accountId}:${statement.dueDate}` : null;
  let inserted = 0;

  inTransaction(db, () => {
    const existing = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (existing !== undefined && existing.kind !== 'credit_card') throw new Error(`A conta ${accountId} não é de cartão.`);
    if (existing === undefined) {
      db.insert(accounts).values({ id: accountId, connectionId: null, kind: 'credit_card', name: input.accountName, owner: input.owner, raw: null }).run();
    }
    if (billId !== null && statement.dueDate !== null && totalCents !== null) {
      const bill = { id: billId, accountId, dueDate: statement.dueDate, totalCents, raw: JSON.stringify({ bank: statement.bank }) };
      db.insert(bills).values(bill).onConflictDoUpdate({ target: bills.id, set: { totalCents, raw: bill.raw } }).run();
    }
    const existingIds = new Set(db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, accountId)).all().map((r) => r.id));
    const seen = new Map<string, number>();
    for (const row of statement.rows) {
      const base = `${row.date}|${row.description}|${row.amountCents}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const id = `file:${accountId}:${digest(`${base}|${n}`)}`;
      const insert = db.insert(transactions).values({
        id,
        accountId,
        date: row.date,
        amountCents: row.amountCents,
        description: row.description,
        merchantKey: normalizeMerchantKey(row.description),
        status: 'posted',
        cardLast4: row.cardLast4 ?? statement.cardLast4,
        installmentNumber: row.installmentNumber,
        installmentTotal: row.installmentTotal,
        purchaseDate: row.purchaseDate,
        billId,
        counterpartDocType: null,
        counterpartDoc: null,
        raw: JSON.stringify(row),
        firstSeenAt: nowIso,
        updatedAt: nowIso,
        origin: 'file',
      });
      // A linha já importada sem fatura passa a pertencer a ela quando o total chega depois.
      const result =
        billId === null
          ? insert.onConflictDoNothing().run()
          : insert.onConflictDoUpdate({ target: transactions.id, set: { billId }, where: isNull(transactions.billId) }).run();
      if (result.changes > 0 && !existingIds.has(id)) inserted += 1;
    }
  });

  await reclassify({ db, pipeline: deps.pipeline, classifier: deps.classifier, now });
  return { inserted, skipped: statement.rows.length - inserted, billId };
}
