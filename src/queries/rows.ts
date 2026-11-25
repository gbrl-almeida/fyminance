import { adjustLedger, type Offset, type SplitPart } from '../core/adjustments';
import type { LedgerRow } from '../core/summary';
import type { Db } from '../db/client';
import { loadClassifications, loadTxs } from '../db/ledger';
import { offsets, transactionSplits } from '../db/schema';

type Range = { from?: string; to?: string };

const inRange = (range: Range) => (row: LedgerRow) =>
  (range.from === undefined || row.tx.date >= range.from) && (range.to === undefined || row.tx.date <= range.to);

export function loadSplits(db: Db): SplitPart[] {
  return db.select().from(transactionSplits).all();
}

export function loadOffsets(db: Db): Offset[] {
  return db.select({ creditId: offsets.creditId, purchaseId: offsets.purchaseId, amountCents: offsets.amountCents }).from(offsets).all();
}

/** Transações com os valores que o banco mandou, sem divisões nem abatimentos. */
export function loadBankRows(db: Db, range: Range = {}): LedgerRow[] {
  const classifications = loadClassifications(db);
  return loadTxs(db)
    .filter((tx) => tx.status !== 'removed')
    .map((tx) => ({ tx, cls: classifications.get(tx.id) ?? null }))
    .filter(inRange(range));
}

/**
 * Linhas para somar: divisões viram uma linha por parte e abatimentos reduzem a compra no mês dela.
 * O ajuste olha o histórico inteiro, porque o crédito pode ser de outro mês.
 */
export function loadLedgerRows(db: Db, range: Range = {}): LedgerRow[] {
  return adjustLedger(loadBankRows(db), loadSplits(db), loadOffsets(db)).filter(inRange(range));
}
