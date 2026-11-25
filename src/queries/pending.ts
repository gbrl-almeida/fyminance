import { and, eq, isNotNull } from 'drizzle-orm';
import { addDays, monthOf } from '../core/dates';
import {
  balanceDivergence,
  billDivergences,
  type BalanceDivergence,
  type BillDivergence,
  type Snapshot,
} from '../core/reconciliation';
import { findRefundTargets } from '../core/refunds';
import type { Actor, ReviewReason, Tx } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories, loadTxs } from '../db/ledger';
import { accounts, balanceSnapshots, bills, divergenceNotes, monthClosings, transactions } from '../db/schema';
import { getBalances, type ConnectionHealth } from './balances';
import { loadLedgerRows } from './rows';

const BILL_PERIOD_DAYS = 45;

export interface ReviewGroup {
  key: string;
  merchantKey: string;
  reason: ReviewReason;
  count: number;
  totalCents: number;
  direction: 'in' | 'out' | 'mixed';
  samples: string[];
  transactionIds: string[];
  /** Data da transação mais recente do grupo. */
  lastDate: string;
  suggestedCategory: string | null;
  suggestedCategoryId: number | null;
  /** Mês já fechado de onde o item veio, quando chegou depois do fechamento. */
  lateFromMonth: string | null;
  /** Num possível estorno, a compra de que ele parece ser. */
  refundOf: { id: string; date: string; description: string; amountCents: number; installment: string | null } | null;
}

export interface DivergenceExplanation {
  note: string;
  by: Actor;
  at: string;
}

interface Explained {
  account: string;
  /** Identifica a divergência; a explicação deixa de valer quando a diferença muda. */
  key: string;
  explanation: DivergenceExplanation | null;
}

export interface PendingItems {
  review: ReviewGroup[];
  balanceDivergences: Array<BalanceDivergence & Explained>;
  billDivergences: Array<BillDivergence & Explained>;
  missingPosted: Array<{ id: string; date: string; description: string; amountCents: number; account: string; missingSince: string }>;
  connections: ConnectionHealth[];
}

export function getPendingItems(db: Db, options: { today: string; month?: string }): PendingItems {
  const accountRows = db.select().from(accounts).all();
  const accountName = (id: string) => accountRows.find((a) => a.id === id)?.name ?? id;
  const list = loadCategories(db);
  const rows = loadLedgerRows(db);
  const notes = new Map(db.select().from(divergenceNotes).all().map((n) => [n.key, n]));
  const explanationOf = (key: string): DivergenceExplanation | null => {
    const note = notes.get(key);
    return note === undefined ? null : { note: note.note, by: note.explainedBy as Actor, at: note.explainedAt };
  };

  const allTxs = loadTxs(db);
  const refundTarget = (credit: Tx): ReviewGroup['refundOf'] => {
    const target = findRefundTargets(credit, allTxs)[0];
    if (target === undefined) return null;
    const installment = target.installmentNumber !== null && target.installmentTotal !== null ? `${target.installmentNumber}/${target.installmentTotal}` : null;
    return { id: target.id, date: target.date, description: target.description, amountCents: target.amountCents, installment };
  };

  // Item de mês já fechado vai para a fila do fechamento em aberto seguinte.
  const closedMonths = new Set(db.select({ month: monthClosings.month }).from(monthClosings).all().map((r) => r.month));
  const groups = new Map<string, ReviewGroup & { categoryVotes: Map<number, number> }>();
  for (const { tx, cls } of rows) {
    if (cls === null || cls.reviewReason === null) continue;
    const txMonth = monthOf(tx.date);
    let lateFromMonth: string | null = null;
    if (options.month !== undefined) {
      const closed = closedMonths.has(txMonth);
      if (txMonth === options.month && closed) continue;
      if (txMonth !== options.month) {
        if (txMonth > options.month || !closed) continue;
        lateFromMonth = txMonth;
      }
    }
    const direction = tx.amountCents >= 0 ? 'in' : 'out';
    // O mesmo PJ manda pró-labore e lucros, e cada estorno é de uma compra: cada um é decidido sozinho.
    const alone = cls.reviewReason === 'pj_income' || cls.reviewReason === 'refund';
    const key = `${tx.merchantKey}|${cls.reviewReason}|${direction}|${lateFromMonth ?? ''}${alone ? `|${tx.id}` : ''}`;
    const group = groups.get(key) ?? {
      key,
      merchantKey: tx.merchantKey,
      reason: cls.reviewReason,
      count: 0,
      totalCents: 0,
      direction,
      samples: [],
      transactionIds: [],
      lastDate: tx.date,
      suggestedCategory: null,
      suggestedCategoryId: null,
      lateFromMonth,
      refundOf: cls.reviewReason === 'refund' ? refundTarget(tx) : null,
      categoryVotes: new Map<number, number>(),
    };
    group.count += 1;
    group.totalCents += Math.abs(tx.amountCents);
    if (group.direction !== direction) group.direction = 'mixed';
    if (group.samples.length < 3 && !group.samples.includes(tx.description)) group.samples.push(tx.description);
    group.transactionIds.push(tx.id);
    if (tx.date > group.lastDate) group.lastDate = tx.date;
    if (cls.categoryId !== null) group.categoryVotes.set(cls.categoryId, (group.categoryVotes.get(cls.categoryId) ?? 0) + 1);
    groups.set(key, group);
  }
  const review = [...groups.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map(({ categoryVotes, ...group }) => {
      const best = [...categoryVotes.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        ...group,
        suggestedCategory: best === undefined ? null : categoryPath(list, best[0]),
        suggestedCategoryId: best === undefined ? null : best[0],
      };
    });

  const txs = allTxs;
  const snapshots = db.select().from(balanceSnapshots).all();
  const balance = accountRows
    .filter((a) => a.kind === 'checking')
    .flatMap((a) => {
      const accountSnapshots: Snapshot[] = snapshots.filter((s) => s.accountId === a.id);
      const divergence = balanceDivergence(accountSnapshots, txs.filter((tx) => tx.accountId === a.id));
      if (divergence === null) return [];
      const key = `balance:${a.id}:${divergence.sinceDate}:${divergence.diffCents}`;
      return [{ ...divergence, account: a.name, key, explanation: explanationOf(key) }];
    });

  const transferIds = new Set(rows.filter((r) => r.cls?.nature === 'transfer').map((r) => r.tx.id));
  const billRows = db
    .select({ id: bills.id, accountId: bills.accountId, dueDate: bills.dueDate, totalCents: bills.totalCents })
    .from(bills)
    .orderBy(bills.dueDate)
    .all();
  // Uma fatura só pode ser conferida se o histórico importado cobre o período dela inteiro
  // (compras de até ~45 dias antes do vencimento).
  const firstTxDate = new Map<string, string>();
  for (const tx of txs) {
    const current = firstTxDate.get(tx.accountId);
    if (current === undefined || tx.date < current) firstTxDate.set(tx.accountId, tx.date);
  }
  // Fatura importada de arquivo vem inteira: dá para conferir mesmo sem histórico anterior.
  const checkableBills = billRows.filter((bill) => {
    const first = firstTxDate.get(bill.accountId);
    if (first === undefined) return false;
    if (!bill.id.startsWith('file:') && bill.dueDate < addDays(first, BILL_PERIOD_DAYS)) return false;
    return options.month === undefined || monthOf(bill.dueDate) === options.month;
  });
  const billIssues = billDivergences(checkableBills, txs, transferIds).map((d) => ({
    ...d,
    account: accountName(d.accountId),
    key: `bill:${d.id}`,
    explanation: explanationOf(`bill:${d.id}`),
  }));

  const missingPosted = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.status, 'posted'), isNotNull(transactions.missingSince)))
    .orderBy(transactions.date)
    .all()
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      account: accountName(t.accountId),
      missingSince: t.missingSince as string,
    }));

  return {
    review,
    balanceDivergences: balance,
    billDivergences: billIssues,
    missingPosted,
    connections: getBalances(db, options.today).connections.filter((c) => c.problems.length > 0),
  };
}
