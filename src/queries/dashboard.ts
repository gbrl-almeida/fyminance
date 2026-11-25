import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { addMonths, lastDayOfMonth } from '../core/dates';
import { averageOverMonths } from '../core/goals';
import type { MonthAmount } from '../core/installments';
import { savingsRate, summarizeMonth, type LedgerRow } from '../core/summary';
import type { Owner } from '../core/types';
import type { Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { accounts, categoryGoals } from '../db/schema';
import { closedMonthDrift, getClosingStatus, pendingClosingMonth, type ClosingStatus } from './closing';
import { firstDataMonth } from './goals';
import { getUpcomingInstallments } from './installments';
import { loadLedgerRows } from './rows';
import { balanceAt } from './yield';

export interface DashboardCategory {
  categoryId: number | null;
  name: string;
  cents: number;
  averageCents: number;
  goalCents: number | null;
  children: Array<{ categoryId: number; name: string; cents: number; averageCents: number }>;
}

export interface DashboardView {
  month: string;
  owner: Owner | 'all';
  /** Renda, sobra e taxa de poupança são do casal; somem com o filtro numa pessoa. */
  household: {
    incomeCents: number;
    expenseCents: number;
    surplusCents: number;
    savingsRate: number | null;
    averageSurplusCents: number | null;
  } | null;
  expenseCents: number;
  categories: DashboardCategory[];
  installments: { totalCents: number; months: MonthAmount[] };
  openBills: Array<{ accountId: string; name: string; cents: number; dueDate: string | null; limitUsedPct: number | null }>;
  closing: ClosingStatus | null;
  drift: { incomeCents: number; expenseCents: number } | null;
}

const CreditData = z.object({
  creditData: z
    .object({
      creditLimit: z.number().nullish(),
      availableCreditLimit: z.number().nullish(),
      balanceDueDate: z.string().nullish(),
    })
    .nullish(),
});

function creditInfo(raw: string | null): { dueDate: string | null; limitUsedPct: number | null } {
  let parsed: z.infer<typeof CreditData> | null = null;
  try {
    const result = CreditData.safeParse(JSON.parse(raw ?? 'null'));
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  const data = parsed?.creditData;
  const limit = data?.creditLimit ?? null;
  const available = data?.availableCreditLimit ?? null;
  return {
    dueDate: data?.balanceDueDate ? data.balanceDueDate.slice(0, 10) : null,
    limitUsedPct: limit === null || available === null || limit <= 0 ? null : Math.round(((limit - available) / limit) * 1000) / 1000,
  };
}

const keepOwner = (owner: Owner | 'all') => (row: LedgerRow) =>
  owner === 'all' || row.cls === null || row.cls.nature !== 'expense' || row.cls.owner === owner;

export function getDashboard(db: Db, month: string, owner: Owner | 'all', today: string, dataDir: string): DashboardView {
  const categories = loadCategories(db);
  const previous = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const rows = loadLedgerRows(db, { from: `${previous[0]}-01`, to: lastDayOfMonth(month) }).filter(keepOwner(owner));
  const first = firstDataMonth(db);
  const current = summarizeMonth(rows, categories, month);
  const past = previous.map((m) => ({ month: m, summary: summarizeMonth(rows, categories, m) }));

  const pastTotals = new Map<string, Map<string, number>>();
  const addPast = (key: string, m: string, cents: number) => {
    const totals = pastTotals.get(key) ?? new Map<string, number>();
    totals.set(m, (totals.get(m) ?? 0) + cents);
    pastTotals.set(key, totals);
  };
  for (const { month: m, summary } of past) {
    for (const total of summary.expenseByCategory) {
      addPast(`p:${total.categoryId}`, m, total.cents);
      for (const child of total.children) addPast(`c:${child.categoryId}`, m, child.cents);
    }
  }
  const average = (key: string) => averageOverMonths(pastTotals.get(key) ?? new Map(), previous, first);
  const goals =
    owner === 'all'
      ? new Map(db.select().from(categoryGoals).where(eq(categoryGoals.month, month)).all().map((g) => [g.categoryId, g.cents]))
      : new Map<number, number>();

  const countedPast = previous.filter((m) => first !== null && m >= first);
  const averageSurplusCents =
    countedPast.length === 0 ? null : averageOverMonths(new Map(past.map((p) => [p.month, p.summary.surplusCents])), previous, first);

  const cards = db.select().from(accounts).where(eq(accounts.kind, 'credit_card')).orderBy(accounts.id).all();
  const openBills = cards.flatMap((card) => {
    const cents = balanceAt(db, card.id, today);
    return cents === null ? [] : [{ accountId: card.id, name: card.name, cents, ...creditInfo(card.raw) }];
  });

  const installments = getUpcomingInstallments(db, today);
  const closingMonth = pendingClosingMonth(db, today, dataDir);
  return {
    month,
    owner,
    household:
      owner === 'all'
        ? {
            incomeCents: current.incomeCents,
            expenseCents: current.expenseCents,
            surplusCents: current.surplusCents,
            savingsRate: savingsRate(current.incomeCents, current.surplusCents),
            averageSurplusCents,
          }
        : null,
    expenseCents: owner === 'all' ? current.expenseCents : current.expenseByOwner[owner],
    categories: current.expenseByCategory.map((total) => ({
      categoryId: total.categoryId,
      name: total.name,
      cents: total.cents,
      averageCents: average(`p:${total.categoryId}`),
      goalCents: total.categoryId === null ? null : (goals.get(total.categoryId) ?? null),
      children: total.children.map((child) => ({ ...child, averageCents: average(`c:${child.categoryId}`) })),
    })),
    installments: { totalCents: installments.totalCents, months: installments.months },
    openBills,
    closing: closingMonth === null ? null : getClosingStatus(db, closingMonth, today, dataDir),
    drift: closedMonthDrift(db, month, today, dataDir),
  };
}
