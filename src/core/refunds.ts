import { addDays } from './dates';
import { purchaseGroupKey } from './installments';
import type { Tx } from './types';

const LOOKBACK_DAYS = 120;

/**
 * Compras de que um crédito no cartão parece ser estorno: mesmo cartão, até 120 dias antes, com o
 * valor da compra, o de um número exato de parcelas ou o da compra parcelada inteira. Uma compra
 * parcelada aparece uma vez, pela parcela mais antiga. A mais recente vem primeiro.
 */
export function findRefundTargets(credit: Tx, txs: readonly Tx[]): Tx[] {
  if (credit.accountKind !== 'credit_card' || credit.amountCents <= 0) return [];
  const from = addDays(credit.date, -LOOKBACK_DAYS);
  const units = new Map<string, Tx[]>();
  for (const tx of txs) {
    if (tx.accountId !== credit.accountId || tx.amountCents >= 0 || tx.status === 'removed') continue;
    const key = purchaseGroupKey(tx) ?? tx.id;
    units.set(key, [...(units.get(key) ?? []), tx]);
  }
  const matches: Tx[] = [];
  for (const members of units.values()) {
    const first = [...members].sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) || a.date.localeCompare(b.date))[0] as Tx;
    const bought = first.purchaseDate ?? first.date;
    if (bought < from || bought > credit.date) continue;
    const value = -first.amountCents;
    const total = first.installmentTotal !== null && purchaseGroupKey(first) !== null ? first.installmentTotal : 1;
    const matchesValue = Array.from({ length: total }, (_, k) => (k + 1) * value).includes(credit.amountCents);
    if (matchesValue) matches.push(first);
  }
  return matches.sort((a, b) => (b.purchaseDate ?? b.date).localeCompare(a.purchaseDate ?? a.date) || a.id.localeCompare(b.id));
}
