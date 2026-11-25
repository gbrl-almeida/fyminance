import { eq } from 'drizzle-orm';
import { lastDayOfMonth } from '../core/dates';
import { summarizeMonth } from '../core/summary';
import type { Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { accounts, connections, monthPlans } from '../db/schema';
import { getRedemptionYields, type RedemptionYields } from './redemption-yields';
import { loadLedgerRows } from './rows';
import { balanceAt, measureEnd, monthlyYield } from './yield';

export interface InvestmentsView {
  totalCents: number;
  yieldCents: number | null;
  yieldPct: number | null;
  contributions: Array<{ date: string; account: string; cents: number }>;
  withdrawals: Array<{ date: string; account: string; cents: number }>;
  contributedCents: number;
  goalCents: number | null;
  surplusCents: number;
  accounts: Array<{ id: string; name: string; balanceCents: number | null; counts: boolean }>;
  /** Rendimento dos resgates, de todas as contas de investimento (inclusive as que são caixa). */
  redemptions: RedemptionYields;
}

/** O CDB de liquidez diária do C6 é caixa até o pagamento da fatura; o resto conta como investimento. */
export function countsAsInvestment(account: { countsAsInvestment: boolean | null; institution: string | null }): boolean {
  if (account.countsAsInvestment !== null) return account.countsAsInvestment;
  return !/c6/i.test(account.institution ?? '');
}

export function getInvestments(db: Db, month: string, today: string): InvestmentsView {
  const start = `${month}-01`;
  const end = measureEnd(month, today);
  const all = db
    .select({ id: accounts.id, name: accounts.name, kind: accounts.kind, connectionId: accounts.connectionId, flag: accounts.countsAsInvestment, institution: connections.institution })
    .from(accounts)
    .leftJoin(connections, eq(connections.id, accounts.connectionId))
    .orderBy(accounts.id)
    .all();
  const investmentAccounts = all
    .filter((a) => a.kind === 'investment')
    .map((a) => ({ ...a, counts: countsAsInvestment({ countsAsInvestment: a.flag, institution: a.institution }) }));
  const counting = investmentAccounts.filter((a) => a.counts);
  const countingConnections = new Set(counting.map((a) => a.connectionId).filter((id) => id !== null));
  const byId = new Map(all.map((a) => [a.id, a]));

  const totalCents = counting.reduce((sum, a) => sum + (balanceAt(db, a.id, end) ?? 0), 0);
  const opening = counting.reduce((sum, a) => sum + (balanceAt(db, a.id, start) ?? 0), 0);
  const yieldCents = counting.length === 0 ? null : monthlyYield(db, month, today, { accountIds: counting.map((a) => a.id) });

  const rows = loadLedgerRows(db, { from: start, to: lastDayOfMonth(month) });
  const contributions: InvestmentsView['contributions'] = [];
  const withdrawals: InvestmentsView['withdrawals'] = [];
  for (const { tx, cls } of rows) {
    if (cls?.transferKind !== 'investment' || tx.accountKind !== 'checking') continue;
    const account = byId.get(tx.accountId);
    if (account?.connectionId == null || !countingConnections.has(account.connectionId)) continue;
    const line = { date: tx.date, account: account.name, cents: Math.abs(tx.amountCents) };
    (tx.amountCents < 0 ? contributions : withdrawals).push(line);
  }

  const plan = db.select().from(monthPlans).where(eq(monthPlans.month, month)).get();
  return {
    totalCents,
    yieldCents,
    yieldPct: yieldCents === null || opening === 0 ? null : yieldCents / opening,
    contributions,
    withdrawals,
    contributedCents: contributions.reduce((sum, c) => sum + c.cents, 0),
    goalCents: plan?.investmentGoalCents ?? null,
    surplusCents: summarizeMonth(rows, loadCategories(db), month).surplusCents,
    accounts: investmentAccounts.map((a) => ({ id: a.id, name: a.name, balanceCents: balanceAt(db, a.id, end), counts: a.counts })),
    redemptions: getRedemptionYields(db, month, today),
  };
}
