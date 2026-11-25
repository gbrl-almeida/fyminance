import { purchaseUnitKey, type SplitPart } from '../core/adjustments';
import { matchesSearch } from '../core/search';
import type { Nature, Owner, ReviewReason, Tx, TxStatus } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories } from '../db/ledger';
import { accounts, transactionNotes } from '../db/schema';
import { loadBankRows, loadOffsets, loadSplits } from './rows';

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: number;
  owner?: Owner;
  merchantKey?: string;
  accountId?: string;
  nature?: Nature;
  reviewOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionView {
  id: string;
  date: string;
  description: string;
  merchantKey: string;
  amountCents: number;
  account: string;
  status: TxStatus;
  nature: Nature | null;
  category: string | null;
  owner: Owner | null;
  reviewReason: ReviewReason | null;
  installment: string | null;
  note: string | null;
  /** Partes de uma compra dividida (numa compra parcelada, valem para todas as parcelas). */
  split: Array<{ amountCents: number; category: string; owner: Owner }> | null;
  /** Créditos que abateram esta compra, ou compras que este crédito abateu. */
  offsets: Array<{ transactionId: string; amountCents: number }>;
}

export function listTransactions(db: Db, filters: TransactionFilters = {}): { total: number; items: TransactionView[] } {
  const list = loadCategories(db);
  const parentOf = new Map(list.map((c) => [c.id, c.parentId]));
  const accountNames = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  const search = filters.search?.trim() ?? '';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const notes = new Map(db.select().from(transactionNotes).all().map((n) => [n.transactionId, n.note]));
  const offsetRows = loadOffsets(db);
  const bankRows = loadBankRows(db);
  const unitParts = new Map<string, SplitPart[]>();
  const byId = new Map(bankRows.map((r) => [r.tx.id, r.tx]));
  for (const part of loadSplits(db).sort((a, b) => a.position - b.position)) {
    const anchor = byId.get(part.transactionId);
    if (anchor === undefined) continue;
    const key = purchaseUnitKey(anchor);
    if (unitParts.has(key) && unitParts.get(key)?.[0]?.transactionId !== part.transactionId) continue;
    unitParts.set(key, [...(unitParts.get(key) ?? []), part]);
  }
  const inRange = (date: string) => (filters.from === undefined || date >= filters.from) && (filters.to === undefined || date <= filters.to);

  const matching = bankRows.filter(({ tx }) => inRange(tx.date)).filter(({ tx, cls }) => {
    if (filters.categoryId !== undefined) {
      const id = cls?.categoryId ?? null;
      if (id === null || (id !== filters.categoryId && parentOf.get(id) !== filters.categoryId)) return false;
    }
    if (filters.owner !== undefined && cls?.owner !== filters.owner) return false;
    if (filters.merchantKey !== undefined && tx.merchantKey !== filters.merchantKey) return false;
    if (filters.accountId !== undefined && tx.accountId !== filters.accountId) return false;
    if (filters.nature !== undefined && cls?.nature !== filters.nature) return false;
    if (filters.reviewOnly === true && (cls?.reviewReason ?? null) === null) return false;
    if (search !== '') {
      const texts = [tx.description, tx.merchantKey, accountNames.get(tx.accountId) ?? '', cls?.categoryId == null ? '' : categoryPath(list, cls.categoryId), notes.get(tx.id) ?? ''];
      if (!matchesSearch(search, texts, [tx.amountCents])) return false;
    }
    return true;
  });
  matching.sort((a, b) => b.tx.date.localeCompare(a.tx.date) || a.tx.id.localeCompare(b.tx.id));

  return {
    total: matching.length,
    items: matching.slice(offset, offset + limit).map(({ tx, cls }) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      merchantKey: tx.merchantKey,
      amountCents: tx.amountCents,
      account: accountNames.get(tx.accountId) ?? tx.accountId,
      status: tx.status,
      nature: cls?.nature ?? null,
      category: cls?.categoryId == null ? null : categoryPath(list, cls.categoryId),
      owner: cls?.owner ?? null,
      reviewReason: cls?.reviewReason ?? null,
      installment:
        tx.installmentNumber !== null && tx.installmentTotal !== null ? `${tx.installmentNumber}/${tx.installmentTotal}` : null,
      note: notes.get(tx.id) ?? null,
      split: unitParts.get(purchaseUnitKey(tx))?.map((p) => ({ amountCents: p.amountCents, category: categoryPath(list, p.categoryId), owner: p.owner })) ?? null,
      offsets: offsetRows
        .filter((o) => (tx.amountCents > 0 ? o.creditId === tx.id : byId.has(o.purchaseId) && purchaseUnitKey(byId.get(o.purchaseId) as Tx) === purchaseUnitKey(tx)))
        .map((o) => ({ transactionId: tx.amountCents > 0 ? o.purchaseId : o.creditId, amountCents: o.amountCents })),
    })),
  };
}
