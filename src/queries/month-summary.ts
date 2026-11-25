import { lastDayOfMonth } from '../core/dates';
import { buildPurchaseGroups, newInstallmentPurchases } from '../core/installments';
import { summarizeMonth, type MonthSummary } from '../core/summary';
import type { Db } from '../db/client';
import { loadCategories, loadTxs } from '../db/ledger';
import { loadLedgerRows } from './rows';
import { monthlyYield } from './yield';

export interface MonthReport extends MonthSummary {
  yieldCents: number | null;
  newInstallmentPurchases: Array<{ description: string; installmentTotal: number; installmentCents: number; totalCents: number }>;
}

export function getMonthSummary(db: Db, month: string, today: string): MonthReport {
  const rows = loadLedgerRows(db, { from: `${month}-01`, to: lastDayOfMonth(month) });
  const summary = summarizeMonth(rows, loadCategories(db), month);
  const groups = buildPurchaseGroups(loadTxs(db), today);
  return {
    ...summary,
    yieldCents: monthlyYield(db, month, today),
    newInstallmentPurchases: newInstallmentPurchases(groups, month).map((g) => ({
      description: g.description,
      installmentTotal: g.installmentTotal,
      installmentCents: g.installmentCents,
      totalCents: g.totalCents,
    })),
  };
}
