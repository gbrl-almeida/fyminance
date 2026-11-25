import { addMonths, monthOf } from './dates';
import type { Tx } from './types';

export interface PurchaseGroup {
  key: string;
  accountId: string;
  merchantKey: string;
  description: string;
  purchaseMonth: string;
  installmentTotal: number;
  installmentCents: number;
  totalCents: number;
  lastSeenNumber: number;
  lastSeenMonth: string;
}

export interface MonthAmount {
  month: string;
  cents: number;
}

export function purchaseMonthOf(tx: Tx): string | null {
  if (tx.installmentTotal === null || tx.installmentTotal < 2 || tx.installmentNumber === null) return null;
  if (tx.purchaseDate !== null) return monthOf(tx.purchaseDate);
  return addMonths(monthOf(tx.date), -(tx.installmentNumber - 1));
}

export function purchaseGroupKey(tx: Tx): string | null {
  const purchaseMonth = purchaseMonthOf(tx);
  if (purchaseMonth === null) return null;
  return `${tx.accountId}|${tx.merchantKey}|${purchaseMonth}|${tx.installmentTotal}`;
}

export function buildPurchaseGroups(txs: readonly Tx[], today: string): PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();
  for (const tx of txs) {
    if (tx.status === 'removed' || tx.amountCents >= 0 || tx.date > today) continue;
    const key = purchaseGroupKey(tx);
    if (key === null) continue;
    const number = tx.installmentNumber as number;
    const total = tx.installmentTotal as number;
    const cents = -tx.amountCents;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        key,
        accountId: tx.accountId,
        merchantKey: tx.merchantKey,
        description: tx.description,
        purchaseMonth: purchaseMonthOf(tx) as string,
        installmentTotal: total,
        installmentCents: cents,
        totalCents: cents * total,
        lastSeenNumber: number,
        lastSeenMonth: monthOf(tx.date),
      });
      continue;
    }
    if (number > current.lastSeenNumber) {
      current.lastSeenNumber = number;
      current.lastSeenMonth = monthOf(tx.date);
    }
    if (number >= 2) {
      current.installmentCents = cents;
      current.totalCents = cents * total;
    }
  }
  return [...groups.values()];
}

export function upcomingInstallments(groups: readonly PurchaseGroup[], currentMonth: string, horizon = 12): MonthAmount[] {
  const months = Array.from({ length: horizon }, (_, i) => addMonths(currentMonth, i));
  const totals = new Map(months.map((month) => [month, 0]));
  for (const group of groups) {
    const remaining = group.installmentTotal - group.lastSeenNumber;
    for (let i = 1; i <= remaining; i++) {
      const month = addMonths(group.lastSeenMonth, i);
      const current = totals.get(month);
      if (current !== undefined) totals.set(month, current + group.installmentCents);
    }
  }
  return months.map((month) => ({ month, cents: totals.get(month) as number }));
}

export function newInstallmentPurchases(groups: readonly PurchaseGroup[], month: string): PurchaseGroup[] {
  return groups.filter((group) => group.purchaseMonth === month);
}
