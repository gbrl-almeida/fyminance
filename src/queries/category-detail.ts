import { lastDayOfMonth } from '../core/dates';
import type { Owner } from '../core/types';
import type { Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { accounts, transactionNotes } from '../db/schema';
import { loadLedgerRows } from './rows';

export interface CategoryDetail {
  category: { id: number; name: string; parentName: string | null };
  totalCents: number;
  groups: Array<{
    merchantKey: string;
    totalCents: number;
    items: Array<{
      id: string;
      date: string;
      description: string;
      /** O que conta nesta categoria: a parte da divisão, já sem o que voltou. */
      amountCents: number;
      /** O valor que o banco mandou. */
      bankCents: number;
      /** Quanto voltou desta parcela por estorno ou reembolso. */
      offsetCents: number;
      part: { index: number; count: number } | null;
      note: string | null;
      account: string;
      categoryId: number;
      owner: Owner;
      installment: string | null;
    }>;
  }>;
}

/** Transações do mês numa categoria (e nas subcategorias), agrupadas por estabelecimento. */
export function getCategoryDetail(db: Db, categoryId: number, month: string, owner: Owner | 'all'): CategoryDetail {
  const list = loadCategories(db);
  const category = list.find((c) => c.id === categoryId);
  if (category === undefined) throw new Error('Categoria não encontrada.');
  const parentOf = new Map(list.map((c) => [c.id, c.parentId]));
  const names = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  const groups = new Map<string, CategoryDetail['groups'][number]>();
  const notes = new Map(db.select().from(transactionNotes).all().map((n) => [n.transactionId, n.note]));
  for (const { tx, cls, adjustment } of loadLedgerRows(db, { from: `${month}-01`, to: lastDayOfMonth(month) })) {
    if (cls === null || cls.nature !== 'expense' || cls.categoryId === null) continue;
    if (cls.categoryId !== categoryId && parentOf.get(cls.categoryId) !== categoryId) continue;
    if (owner !== 'all' && cls.owner !== owner) continue;
    const group = groups.get(tx.merchantKey) ?? { merchantKey: tx.merchantKey, totalCents: 0, items: [] };
    group.totalCents -= tx.amountCents;
    group.items.push({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amountCents: tx.amountCents,
      bankCents: adjustment?.bankCents ?? tx.amountCents,
      offsetCents: adjustment?.offsetCents ?? 0,
      part: adjustment?.part ?? null,
      note: notes.get(tx.id) ?? null,
      account: names.get(tx.accountId) ?? tx.accountId,
      categoryId: cls.categoryId,
      owner: cls.owner,
      installment: tx.installmentNumber !== null && tx.installmentTotal !== null ? `${tx.installmentNumber}/${tx.installmentTotal}` : null,
    });
    groups.set(tx.merchantKey, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.totalCents - a.totalCents);
  const parent = category.parentId === null ? null : list.find((c) => c.id === category.parentId);
  return {
    category: { id: category.id, name: category.name, parentName: parent?.name ?? null },
    totalCents: sorted.reduce((sum, g) => sum + g.totalCents, 0),
    groups: sorted,
  };
}
