import { eq } from 'drizzle-orm';
import type { Actor } from '../core/types';
import type { Db } from '../db/client';
import { accounts } from '../db/schema';
import { writeAudit } from './audit';

type Ctx = { now: () => Date; actor: Actor };

function requireAccount(db: Db, accountId: string): void {
  if (db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get() === undefined) {
    throw new Error(`Conta não encontrada: ${accountId}`);
  }
}

export function setCountsAsInvestment(db: Db, accountId: string, counts: boolean, ctx: Ctx): void {
  requireAccount(db, accountId);
  db.update(accounts).set({ countsAsInvestment: counts }).where(eq(accounts.id, accountId)).run();
  writeAudit(db, 'counts_as_investment', { accountId, counts }, ctx.now().toISOString(), ctx.actor);
}

/** Janela em que a conta vale no livro: de `from` (inclusive) até `until` (exclusive). */
export function setLedgerWindow(db: Db, accountId: string, window: { from: string | null; until: string | null }, ctx: Ctx): void {
  requireAccount(db, accountId);
  for (const date of [window.from, window.until]) {
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida; use AAAA-MM-DD.');
  }
  if (window.from !== null && window.until !== null && window.from >= window.until) throw new Error('O início precisa ser antes do fim.');
  db.update(accounts).set({ ledgerFrom: window.from, ledgerUntil: window.until }).where(eq(accounts.id, accountId)).run();
  writeAudit(db, 'ledger_window', { accountId, ...window }, ctx.now().toISOString(), ctx.actor);
}
