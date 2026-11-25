import { and, desc, eq, lte } from 'drizzle-orm';
import { addMonths, lastDayOfMonth, monthOf } from '../core/dates';
import type { Db } from '../db/client';
import { accounts, balanceSnapshots } from '../db/schema';
import { loadLedgerRows } from './rows';

export function balanceAt(db: Db, accountId: string, date: string): number | null {
  const row = db
    .select({ cents: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), lte(balanceSnapshots.date, date)))
    .orderBy(desc(balanceSnapshots.date), desc(balanceSnapshots.takenAt))
    .limit(1)
    .get();
  return row?.cents ?? null;
}

// A conexão já era acompanhada no início do mês se alguma conta dela tinha saldo registrado até lá.
function trackedSince(db: Db, connectionId: string, date: string): boolean {
  const row = db
    .select({ id: balanceSnapshots.id })
    .from(balanceSnapshots)
    .innerJoin(accounts, eq(accounts.id, balanceSnapshots.accountId))
    .where(and(eq(accounts.connectionId, connectionId), lte(balanceSnapshots.date, date)))
    .limit(1)
    .get();
  return row !== undefined;
}

/** Fim da medição do mês: hoje, no mês corrente; senão, o primeiro dia do mês seguinte. */
export function measureEnd(month: string, today: string): string {
  return month === monthOf(today) ? today : `${addMonths(month, 1)}-01`;
}

export function monthlyYield(db: Db, month: string, today: string, options: { accountIds?: readonly string[] } = {}): number | null {
  const wanted = options.accountIds === undefined ? null : new Set(options.accountIds);
  const investmentAccounts = db
    .select({ id: accounts.id, connectionId: accounts.connectionId })
    .from(accounts)
    .where(eq(accounts.kind, 'investment'))
    .all()
    .filter((a) => wanted === null || wanted.has(a.id));
  if (investmentAccounts.length === 0) return null;
  const start = `${month}-01`;
  const end = measureEnd(month, today);
  let variation = 0;
  let measured = 0;
  for (const { id, connectionId } of investmentAccounts) {
    const after = balanceAt(db, id, end);
    if (after === null) continue;
    let before = balanceAt(db, id, start);
    if (before === null) {
      // Posição aberta durante o mês numa conexão já acompanhada começou do zero; sem acompanhamento
      // anterior, o saldo inicial é desconhecido.
      if (connectionId === null || !trackedSince(db, connectionId, start)) return null;
      before = 0;
    }
    variation += after - before;
    measured += 1;
  }
  if (measured === 0) return null;
  // Com filtro, só contam as aplicações feitas a partir das conexões das contas medidas.
  const connectionsOf = new Set(investmentAccounts.map((a) => a.connectionId));
  const connectionOf = new Map(db.select({ id: accounts.id, connectionId: accounts.connectionId }).from(accounts).all().map((a) => [a.id, a.connectionId]));
  const invested = loadLedgerRows(db, { from: start, to: lastDayOfMonth(month) })
    .filter(({ tx, cls }) => cls?.transferKind === 'investment' && tx.accountKind === 'checking')
    .filter(({ tx }) => wanted === null || connectionsOf.has(connectionOf.get(tx.accountId) ?? null))
    .reduce((sum, { tx }) => sum - tx.amountCents, 0);
  return variation - invested;
}
