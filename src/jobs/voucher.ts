import { and, eq, min, ne } from 'drizzle-orm';
import { addMonths, monthOf } from '../core/dates';
import type { CategoryKind, Nature, Owner } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { accounts, categories, classifications, transactions } from '../db/schema';

export const VOUCHER_ACCOUNT_ID = 'manual:flash';

function categoryId(db: Db, name: string, kind: CategoryKind): number {
  const row = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), eq(categories.kind, kind)))
    .get();
  if (row === undefined) throw new Error(`Categoria "${name}" não encontrada. Rode "pnpm fy migrate".`);
  return row.id;
}

export function ensureVoucher(db: Db, options: { monthlyCents: number; today: string; nowIso: string }): number {
  const { monthlyCents, today, nowIso } = options;
  const entries: Array<{ side: 'in' | 'out'; amountCents: number; description: string; nature: Nature; categoryId: number; owner: Owner }> = [
    {
      side: 'in',
      amountCents: monthlyCents,
      description: 'Crédito do vale-alimentação',
      nature: 'income',
      categoryId: categoryId(db, 'Voucher', 'income'),
      owner: 'pessoa2',
    },
    {
      side: 'out',
      amountCents: -monthlyCents,
      description: 'Gasto do vale-alimentação (estimado)',
      nature: 'expense',
      categoryId: categoryId(db, 'Alimentação', 'expense'),
      owner: 'casal',
    },
  ];
  const first = db
    .select({ date: min(transactions.date) })
    .from(transactions)
    .where(ne(transactions.accountId, VOUCHER_ACCOUNT_ID))
    .get();
  const lastMonth = monthOf(today);
  const startMonth = first?.date ? monthOf(first.date) : addMonths(lastMonth, -11);

  let inserted = 0;
  inTransaction(db, () => {
    db.insert(accounts)
      .values({ id: VOUCHER_ACCOUNT_ID, connectionId: null, kind: 'voucher', name: 'Vale-alimentação', owner: 'pessoa2', raw: null })
      .onConflictDoNothing()
      .run();
    for (let month = startMonth; month <= lastMonth; month = addMonths(month, 1)) {
      for (const entry of entries) {
        const id = `voucher:${month}:${entry.side}`;
        const result = db
          .insert(transactions)
          .values({
            id,
            accountId: VOUCHER_ACCOUNT_ID,
            date: `${month}-01`,
            amountCents: entry.amountCents,
            description: entry.description,
            merchantKey: 'VOUCHER FLASH',
            status: 'posted',
            raw: '{}',
            firstSeenAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoNothing()
          .run();
        if (result.changes === 0) continue;
        db.insert(classifications)
          .values({
            transactionId: id,
            nature: entry.nature,
            categoryId: entry.categoryId,
            owner: entry.owner,
            source: 'system',
            updatedAt: nowIso,
          })
          .onConflictDoNothing()
          .run();
        inserted += 1;
      }
    }
  });
  return inserted;
}
