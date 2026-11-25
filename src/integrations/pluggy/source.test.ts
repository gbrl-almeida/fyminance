import { describe, expect, it } from 'vitest';
import { createPluggySource, fetchAllPages } from './source';

describe('pluggy source', () => {
  it('walks every page', async () => {
    const pages: Record<number, string[]> = { 1: ['a', 'b'], 2: ['c'] };
    const seen: number[] = [];
    const all = await fetchAllPages(async (page) => {
      seen.push(page);
      return { results: pages[page] ?? [], totalPages: 2 };
    });
    expect(all).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([1, 2]);
  });

  it('builds a source without calling the network', () => {
    const source = createPluggySource({ clientId: 'id', clientSecret: 'secret' });
    expect(Object.keys(source).sort()).toEqual([
      'fetchAccounts',
      'fetchBills',
      'fetchInvestmentMovements',
      'fetchInvestments',
      'fetchItem',
      'fetchTransactions',
    ]);
  });
});
