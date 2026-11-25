import { PluggyClient } from 'pluggy-sdk';

export interface PluggySource {
  fetchItem(itemId: string): Promise<unknown>;
  fetchAccounts(itemId: string): Promise<unknown[]>;
  fetchTransactions(accountId: string, dateFrom: string): Promise<unknown[]>;
  fetchBills(accountId: string): Promise<unknown[]>;
  fetchInvestments(itemId: string): Promise<unknown[]>;
  fetchInvestmentMovements(investmentId: string): Promise<unknown[]>;
}

export async function fetchAllPages<T>(load: (page: number) => Promise<{ results: T[]; totalPages: number }>): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await load(page);
    all.push(...response.results);
    totalPages = response.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

export function createPluggySource(credentials: { clientId: string; clientSecret: string }): PluggySource {
  const client = new PluggyClient({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
  return {
    fetchItem: (itemId) => client.fetchItem(itemId),
    fetchAccounts: async (itemId) => (await client.fetchAccounts(itemId)).results,
    fetchTransactions: (accountId, dateFrom) => client.fetchAllTransactions(accountId, { dateFrom }),
    fetchBills: (accountId) => fetchAllPages((page) => client.fetchCreditCardBills(accountId, { page })),
    fetchInvestments: (itemId) => fetchAllPages((page) => client.fetchInvestments(itemId, undefined, { page })),
    fetchInvestmentMovements: (investmentId) => client.fetchAllInvestmentTransactions(investmentId),
  };
}
