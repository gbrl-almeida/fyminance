import { addMonths } from './dates';
import type { PurchaseGroup } from './installments';

/**
 * Média mensal arredondada para baixo. Meses anteriores ao primeiro mês com dados não contam no divisor,
 * para que pouco histórico não puxe a média para baixo.
 */
export function averageOverMonths(totals: ReadonlyMap<string, number>, months: readonly string[], firstDataMonth: string | null): number {
  if (firstDataMonth === null) return 0;
  const counted = months.filter((month) => month >= firstDataMonth);
  if (counted.length === 0) return 0;
  const sum = counted.reduce((total, month) => total + (totals.get(month) ?? 0), 0);
  return Math.floor(sum / counted.length);
}

export function suggestGoal(averageCents: number, deltas: readonly number[]): number {
  return Math.max(0, deltas.reduce((total, delta) => total + delta, averageCents));
}

/** Soma das parcelas que caem em `month`, contando o grupo desde a primeira parcela. */
export function installmentsDueIn(groups: readonly PurchaseGroup[], month: string): number {
  let total = 0;
  for (const group of groups) {
    const first = addMonths(group.lastSeenMonth, -(group.lastSeenNumber - 1));
    const last = addMonths(first, group.installmentTotal - 1);
    if (month >= first && month <= last) total += group.installmentCents;
  }
  return total;
}
