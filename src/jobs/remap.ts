import { eq } from 'drizzle-orm';
import { inTransaction, type Db } from '../db/client';
import { transactions } from '../db/schema';
import { mapTransaction } from '../integrations/pluggy/map';

/**
 * Relê o que a Pluggy mandou com a leitura atual (descrição, estabelecimento e contraparte), para uma
 * correção na leitura valer também para o histórico. Devolve quantas transações mudaram.
 */
export function remapPluggyTransactions(db: Db): number {
  const rows = db
    .select({
      id: transactions.id,
      raw: transactions.raw,
      description: transactions.description,
      merchantKey: transactions.merchantKey,
      counterpartDocType: transactions.counterpartDocType,
      counterpartDoc: transactions.counterpartDoc,
    })
    .from(transactions)
    .where(eq(transactions.origin, 'pluggy'))
    .all();
  let changed = 0;
  inTransaction(db, () => {
    for (const row of rows) {
      let mapped;
      try {
        mapped = mapTransaction(JSON.parse(row.raw));
      } catch {
        continue;
      }
      const next = {
        description: mapped.description,
        merchantKey: mapped.merchantKey,
        counterpartDocType: mapped.counterpartDocType,
        counterpartDoc: mapped.counterpartDoc,
      };
      if (next.description === row.description && next.merchantKey === row.merchantKey && next.counterpartDocType === row.counterpartDocType && next.counterpartDoc === row.counterpartDoc) {
        continue;
      }
      db.update(transactions).set(next).where(eq(transactions.id, row.id)).run();
      changed += 1;
    }
  });
  return changed;
}
