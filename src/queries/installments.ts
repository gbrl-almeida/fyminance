import { monthOf } from '../core/dates';
import { buildPurchaseGroups, upcomingInstallments, type MonthAmount } from '../core/installments';
import type { Db } from '../db/client';
import { loadTxs } from '../db/ledger';

export interface UpcomingInstallments {
  months: MonthAmount[];
  totalCents: number;
  bankReported: MonthAmount[];
  active: Array<{
    description: string;
    installmentTotal: number;
    lastSeenNumber: number;
    installmentCents: number;
    remainingCents: number;
  }>;
}

export function getUpcomingInstallments(db: Db, today: string): UpcomingInstallments {
  const txs = loadTxs(db);
  const groups = buildPurchaseGroups(txs, today);
  const months = upcomingInstallments(groups, monthOf(today));
  const reported = new Map(months.map((m) => [m.month, 0]));
  for (const tx of txs) {
    if (tx.status === 'removed' || tx.amountCents >= 0 || tx.date <= today || (tx.installmentTotal ?? 0) < 2) continue;
    const current = reported.get(monthOf(tx.date));
    if (current !== undefined) reported.set(monthOf(tx.date), current - tx.amountCents);
  }
  return {
    months,
    totalCents: months.reduce((sum, m) => sum + m.cents, 0),
    bankReported: months.map((m) => ({ month: m.month, cents: reported.get(m.month) as number })),
    active: groups
      .filter((g) => g.lastSeenNumber < g.installmentTotal)
      .map((g) => ({
        description: g.description,
        installmentTotal: g.installmentTotal,
        lastSeenNumber: g.lastSeenNumber,
        installmentCents: g.installmentCents,
        remainingCents: (g.installmentTotal - g.lastSeenNumber) * g.installmentCents,
      })),
  };
}
