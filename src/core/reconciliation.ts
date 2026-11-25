import type { Tx } from './types';

export interface Snapshot {
  accountId: string;
  date: string;
  takenAt: string;
  balanceCents: number;
}

export interface BalanceDivergence {
  accountId: string;
  sinceDate: string;
  asOfDate: string;
  diffCents: number;
}

export interface BillLike {
  id: string;
  accountId: string;
  dueDate: string;
  totalCents: number;
}

export interface BillDivergence extends BillLike {
  computedCents: number;
  diffCents: number;
}

function sumPosted(txs: readonly Tx[], fromInclusive: string, toExclusive: string): number {
  let total = 0;
  for (const tx of txs) {
    if (tx.status === 'posted' && tx.date >= fromInclusive && tx.date < toExclusive) total += tx.amountCents;
  }
  return total;
}

export function balanceDivergence(snapshots: readonly Snapshot[], txs: readonly Tx[]): BalanceDivergence | null {
  const lastOfDay = new Map<string, Snapshot>();
  for (const s of [...snapshots].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) lastOfDay.set(s.date, s);
  const days = [...lastOfDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 3) return null;
  const anchor = days[0] as Snapshot;
  const drift = (s: Snapshot) => s.balanceCents - anchor.balanceCents - sumPosted(txs, anchor.date, s.date);
  // A deriva da primeira comparação é a linha de base: o horário de atualização do banco pode já
  // incluir lançamentos do dia da âncora, e essa diferença constante não é divergência.
  const baseline = drift(days[1] as Snapshot);
  const latest = days[days.length - 1] as Snapshot;
  const previous = days[days.length - 2] as Snapshot;
  const latestDrift = drift(latest);
  if (latestDrift === baseline || latestDrift !== drift(previous)) return null;
  return { accountId: anchor.accountId, sinceDate: anchor.date, asOfDate: latest.date, diffCents: latestDrift - baseline };
}

export function billDivergences(
  bills: readonly BillLike[],
  txs: readonly Tx[],
  transferIds: ReadonlySet<string>,
): BillDivergence[] {
  const charges = new Map<string, number>();
  for (const tx of txs) {
    if (tx.billId === null || tx.status === 'removed' || transferIds.has(tx.id)) continue;
    charges.set(tx.billId, (charges.get(tx.billId) ?? 0) - tx.amountCents);
  }
  return bills.flatMap((bill) => {
    const computedCents = charges.get(bill.id) ?? 0;
    const diffCents = bill.totalCents - computedCents;
    return diffCents === 0 ? [] : [{ ...bill, computedCents, diffCents }];
  });
}
