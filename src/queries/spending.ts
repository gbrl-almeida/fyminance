import { monthOf } from '../core/dates';
import type { Category, Classification, Owner, Tx } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories } from '../db/ledger';
import { accounts } from '../db/schema';
import { loadLedgerRows } from './rows';

export type SpendingGroupBy = 'month' | 'category' | 'parent_category' | 'merchant' | 'owner' | 'account';

export interface SpendingFilters {
  from: string;
  to: string;
  groupBy: SpendingGroupBy;
  categoryId?: number;
  owner?: Owner;
  merchantKey?: string;
  accountId?: string;
}

export interface SpendingLine {
  key: string;
  label: string;
  cents: number;
  count: number;
}

const NONE = { key: 'none', label: 'Sem categoria' };

export function getSpending(db: Db, filters: SpendingFilters): SpendingLine[] {
  const list = loadCategories(db);
  const byId = new Map(list.map((c) => [c.id, c]));
  const accountNames = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  const parentOf = (id: number) => byId.get(id)?.parentId ?? id;

  const groupKey = (tx: Tx, cls: Classification): { key: string; label: string } => {
    switch (filters.groupBy) {
      case 'month':
        return { key: monthOf(tx.date), label: monthOf(tx.date) };
      case 'category':
        return cls.categoryId === null ? NONE : { key: String(cls.categoryId), label: categoryPath(list, cls.categoryId) };
      case 'parent_category': {
        if (cls.categoryId === null) return NONE;
        const parentId = parentOf(cls.categoryId);
        return { key: String(parentId), label: (byId.get(parentId) as Category | undefined)?.name ?? `#${parentId}` };
      }
      case 'merchant':
        return { key: tx.merchantKey, label: tx.merchantKey };
      case 'owner':
        return { key: cls.owner, label: cls.owner };
      case 'account':
        return { key: tx.accountId, label: accountNames.get(tx.accountId) ?? tx.accountId };
    }
  };

  const lines = new Map<string, SpendingLine>();
  for (const { tx, cls } of loadLedgerRows(db, { from: filters.from, to: filters.to })) {
    if (cls === null || cls.nature !== 'expense') continue;
    if (filters.categoryId !== undefined) {
      if (cls.categoryId === null) continue;
      if (cls.categoryId !== filters.categoryId && parentOf(cls.categoryId) !== filters.categoryId) continue;
    }
    if (filters.owner !== undefined && cls.owner !== filters.owner) continue;
    if (filters.merchantKey !== undefined && tx.merchantKey !== filters.merchantKey) continue;
    if (filters.accountId !== undefined && tx.accountId !== filters.accountId) continue;
    const { key, label } = groupKey(tx, cls);
    const line = lines.get(key) ?? { key, label, cents: 0, count: 0 };
    line.cents -= tx.amountCents;
    line.count += 1;
    lines.set(key, line);
  }
  const result = [...lines.values()];
  return filters.groupBy === 'month'
    ? result.sort((a, b) => a.key.localeCompare(b.key))
    : result.sort((a, b) => b.cents - a.cents);
}
