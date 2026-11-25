import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AppConfig, ConnectionConfig } from '../config';
import type { Db } from '../db/client';
import { loadClassifications } from '../db/ledger';
import { accounts, balanceSnapshots, bills, classifications, connections, investmentMovements, syncRuns, transactionNotes, transactionSplits, transactions } from '../db/schema';
import { categoryIdByName, createTestDb } from '../db/testing';
import type { PluggySource } from '../integrations/pluggy/source';
import { runSync } from './sync';

const T1 = '2026-10-14T10:00:00.000Z';
const T2 = '2026-10-15T10:00:00.000Z';
const at = (iso: string) => () => new Date(iso);

const pluggyTx = (
  id: string,
  accountId: string,
  date: string,
  type: 'DEBIT' | 'CREDIT',
  amount: number,
  description: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  accountId,
  date: `${date}T00:00:00.000Z`,
  description,
  type,
  amount,
  status: 'POSTED',
  paymentData: null,
  creditCardMetadata: null,
  ...extra,
});

function fakeSource() {
  const data = {
    items: {
      'item-c6': { id: 'item-c6', status: 'UPDATED', consentExpiresAt: '2027-03-01T00:00:00.000Z' },
      'item-inter': { id: 'item-inter', status: 'UPDATED', consentExpiresAt: null },
    } as Record<string, unknown>,
    accounts: {
      'item-c6': [
        { id: 'c6-checking', type: 'BANK', name: 'Conta corrente', balance: 1500 },
        { id: 'c6-card', type: 'CREDIT', name: 'Cartão', balance: 800 },
      ],
      'item-inter': [{ id: 'inter-checking', type: 'BANK', name: 'Conta', balance: 2000 }],
    } as Record<string, unknown[]>,
    transactions: {
      'c6-checking': [
        pluggyTx('pix-out', 'c6-checking', '2026-10-10', 'DEBIT', 500, 'TRANSFERENCIA ENVIADA'),
        pluggyTx('bill-pay', 'c6-checking', '2026-10-05', 'DEBIT', 300, 'PAGAMENTO DE FATURA'),
      ],
      'c6-card': [
        pluggyTx('ifood', 'c6-card', '2026-10-07', 'DEBIT', 45.9, 'IFOOD *IFOOD', {
          creditCardMetadata: { billId: 'bill-1' },
        }),
        pluggyTx('pending', 'c6-card', '2026-10-12', 'DEBIT', 20, 'LOJA PENDENTE', { status: 'PENDING' }),
      ],
      'inter-checking': [pluggyTx('pix-in', 'inter-checking', '2026-10-10', 'CREDIT', 500, 'TRANSFERENCIA RECEBIDA')],
    } as Record<string, unknown[]>,
    bills: {
      'c6-card': [{ id: 'bill-1', dueDate: '2026-10-15T03:00:00.000Z', totalAmount: 45.9 }],
    } as Record<string, unknown[]>,
    investments: { 'item-c6': [{ id: 'cdb-1', name: 'CDB', balance: 1000 }] } as Record<string, unknown[]>,
    movements: {
      'cdb-1': [
        { id: 'buy-1', type: 'BUY', date: '2026-09-01T00:00:00.000Z', amount: 1000, netAmount: 1000, quantity: 1000, value: 1 },
        { id: 'sell-1', type: 'SELL', date: '2026-09-20T00:00:00.000Z', amount: 205, netAmount: 204.5, quantity: 200, value: 1.025 },
      ],
    } as Record<string, unknown[]>,
    failing: new Set<string>(),
  };
  const calls: Array<{ accountId: string; dateFrom: string }> = [];
  const source: PluggySource = {
    fetchItem: async (itemId) => {
      if (data.failing.has(itemId)) throw new Error('LOGIN_ERROR no banco');
      return data.items[itemId];
    },
    fetchAccounts: async (itemId) => data.accounts[itemId] ?? [],
    fetchTransactions: async (accountId, dateFrom) => {
      calls.push({ accountId, dateFrom });
      return data.transactions[accountId] ?? [];
    },
    fetchBills: async (accountId) => data.bills[accountId] ?? [],
    fetchInvestments: async (itemId) => data.investments[itemId] ?? [],
    fetchInvestmentMovements: async (investmentId) => data.movements[investmentId] ?? [],
  };
  return { source, data, calls };
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dataDir: '/nao-usado',
    dbFile: '/nao-usado/fyminance.db',
    pluggy: { clientId: 'id', clientSecret: 'secret' },
    pluggyByHolder: {},
    connections: [
      { itemId: 'item-c6', owner: 'pessoa1', institution: 'C6' },
      { itemId: 'item-inter', owner: 'pessoa2', institution: 'Inter' },
    ],
    model: null,
    pipeline: { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() },
    voucherMonthlyCents: null,
    backup: null,
    ...overrides,
  };
}

function txRows(db: Db) {
  return db
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      status: transactions.status,
      missingSince: transactions.missingSince,
      firstSeenAt: transactions.firstSeenAt,
    })
    .from(transactions)
    .orderBy(transactions.id)
    .all();
}

describe('runSync', () => {
  it('imports a first year of history from every connection', async () => {
    const { db } = createTestDb();
    const { source, calls } = fakeSource();

    const report = await runSync({ db, source, config: config(), classifier: null, now: at(T1) });

    expect(report.status).toBe('ok');
    expect(report.connections).toEqual([
      { itemId: 'item-c6', institution: 'C6', ok: true, error: null, transactions: 4 },
      { itemId: 'item-inter', institution: 'Inter', ok: true, error: null, transactions: 1 },
    ]);
    expect(calls).toContainEqual({ accountId: 'c6-checking', dateFrom: '2025-10-14' });
    expect(db.select({ id: accounts.id, kind: accounts.kind }).from(accounts).orderBy(accounts.id).all()).toEqual([
      { id: 'c6-card', kind: 'credit_card' },
      { id: 'c6-checking', kind: 'checking' },
      { id: 'cdb-1', kind: 'investment' },
      { id: 'inter-checking', kind: 'checking' },
    ]);
    expect(db.select().from(balanceSnapshots).all()).toHaveLength(4);
    expect(txRows(db)).toHaveLength(5);
    expect(db.select().from(bills).all()).toHaveLength(1);

    const saved = loadClassifications(db);
    expect(saved.get('pix-out')).toMatchObject({ nature: 'transfer', transferKind: 'internal', transferPairId: 'pix-in' });
    expect(saved.get('bill-pay')).toMatchObject({ nature: 'transfer', transferKind: 'bill_payment' });
    expect(saved.get('ifood')).toMatchObject({ nature: 'expense', reviewReason: 'uncategorized' });

    expect(db.select().from(connections).where(eq(connections.id, 'item-c6')).get()).toMatchObject({
      status: 'UPDATED',
      lastSuccessAt: T1,
      lastError: null,
      consentExpiresAt: '2027-03-01T00:00:00.000Z',
    });
    expect(db.select().from(syncRuns).all()).toEqual([
      expect.objectContaining({ id: report.runId, status: 'ok', finishedAt: T1 }),
    ]);
  });

  it('fetches each connection through the source of its holder', async () => {
    const { db } = createTestDb();
    const { source } = fakeSource();
    const asked: Array<[string, string]> = [];
    const sourceFor = (connection: ConnectionConfig): PluggySource => ({
      ...source,
      fetchItem: (itemId) => {
        asked.push([connection.owner, itemId]);
        return source.fetchItem(itemId);
      },
    });

    const report = await runSync({ db, source: sourceFor, config: config(), classifier: null, now: at(T1) });

    expect(report.status).toBe('ok');
    expect(asked).toEqual([
      ['pessoa1', 'item-c6'],
      ['pessoa2', 'item-inter'],
    ]);
  });

  it('is idempotent and later asks only for the overlap window', async () => {
    const { db } = createTestDb();
    const { source, calls } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    const before = { txs: txRows(db), classifications: loadClassifications(db) };
    calls.length = 0;

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    expect(calls).toContainEqual({ accountId: 'c6-checking', dateFrom: '2026-10-04' });
    expect(txRows(db)).toEqual(before.txs);
    expect(loadClassifications(db)).toEqual(before.classifications);
  });

  it('marks vanished pending transactions as removed and vanished posted ones as missing', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    const card = data.transactions['c6-card'] ?? [];
    data.transactions['c6-card'] = [];

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });
    const rows = new Map(txRows(db).map((row) => [row.id, row]));
    expect(rows.get('pending')).toMatchObject({ status: 'removed' });
    expect(rows.get('ifood')).toMatchObject({ status: 'posted', missingSince: '2026-10-15' });

    data.transactions['c6-card'] = card;
    await runSync({ db, source, config: config(), classifier: null, now: at('2026-10-16T10:00:00.000Z') });
    expect(txRows(db).find((row) => row.id === 'ifood')?.missingSince).toBeNull();
  });

  it('moves what the couple added to a pending purchase over to the posted one that replaces it', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    const home = categoryIdByName(db, 'Casa');
    const health = categoryIdByName(db, 'Saúde');
    db.update(classifications).set({ source: 'manual', categoryId: home, owner: 'pessoa2', reviewReason: null }).where(eq(classifications.transactionId, 'pending')).run();
    db.insert(transactionNotes).values({ transactionId: 'pending', note: 'vaso e vitamina', updatedBy: 'pessoa2', updatedAt: T1 }).run();
    db.insert(transactionSplits)
      .values([
        { transactionId: 'pending', position: 0, amountCents: 1500, categoryId: home, owner: 'pessoa2' },
        { transactionId: 'pending', position: 1, amountCents: 500, categoryId: health, owner: 'pessoa2' },
      ])
      .run();
    data.transactions['c6-card'] = [
      ...(data.transactions['c6-card'] ?? []).filter((tx) => (tx as { id: string }).id !== 'pending'),
      pluggyTx('posted', 'c6-card', '2026-10-13', 'DEBIT', 20, 'LOJA PENDENTE'),
    ];

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    expect(loadClassifications(db).get('posted')).toMatchObject({ source: 'manual', categoryId: home, owner: 'pessoa2' });
    expect(db.select().from(transactionNotes).all()).toEqual([expect.objectContaining({ transactionId: 'posted', note: 'vaso e vitamina' })]);
    expect(db.select().from(transactionSplits).all().map((p) => p.transactionId)).toEqual(['posted', 'posted']);
  });

  it('keeps going when one connection fails', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    data.failing.add('item-inter');

    const report = await runSync({ db, source, config: config(), classifier: null, now: at(T1) });

    expect(report.status).toBe('partial');
    expect(report.connections[1]).toEqual({
      itemId: 'item-inter',
      institution: 'Inter',
      ok: false,
      error: 'LOGIN_ERROR no banco',
      transactions: 0,
    });
    expect(db.select().from(connections).where(eq(connections.id, 'item-inter')).get()).toMatchObject({
      lastError: 'LOGIN_ERROR no banco',
      lastSuccessAt: null,
    });
    expect(txRows(db).map((row) => row.id)).toContain('ifood');
    expect(JSON.parse(db.select().from(syncRuns).get()?.errors ?? '[]')).toEqual([
      { itemId: 'item-inter', error: 'LOGIN_ERROR no banco' },
    ]);
  });

  it('never overwrites a manual decision', async () => {
    const { db } = createTestDb();
    const { source } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    const delivery = categoryIdByName(db, 'Delivery');
    db.update(classifications)
      .set({ source: 'manual', categoryId: delivery, reviewReason: null })
      .where(eq(classifications.transactionId, 'ifood'))
      .run();

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    expect(loadClassifications(db).get('ifood')).toMatchObject({ source: 'manual', categoryId: delivery });
  });

  it('refuses to run beside a recent sync and recovers from stale ones', async () => {
    const { db } = createTestDb();
    const { source } = fakeSource();
    const runId = Number(db.insert(syncRuns).values({ startedAt: '2026-10-14T09:55:00.000Z', status: 'running' }).run().lastInsertRowid);

    await expect(runSync({ db, source, config: config(), classifier: null, now: at(T1) })).rejects.toThrow(/em andamento/);

    db.update(syncRuns).set({ startedAt: '2026-10-14T07:00:00.000Z' }).where(eq(syncRuns.id, runId)).run();
    const report = await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    expect(report.status).toBe('ok');
    expect(db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get()?.status).toBe('failed');
  });

  it('adds the voucher when configured', async () => {
    const { db } = createTestDb();
    const { source } = fakeSource();
    await runSync({ db, source, config: config({ voucherMonthlyCents: 80000 }), classifier: null, now: at(T1) });
    expect(txRows(db).some((row) => row.id === 'voucher:2026-10:out')).toBe(true);
  });

  it('refuses a card whose purchases arrive as inflows', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    // Formato visto na sandbox da Pluggy: compra com valor negativo e type CREDIT.
    data.transactions['c6-card'] = [1, 2, 3, 4, 5].map((day) =>
      pluggyTx(`sb-${day}`, 'c6-card', `2026-10-0${day}`, 'CREDIT', -21.9, 'SPOTIFY AB'),
    );

    const report = await runSync({ db, source, config: config(), classifier: null, now: at(T1) });

    expect(report.connections[0]).toMatchObject({ itemId: 'item-c6', ok: false });
    expect(report.connections[0]?.error).toMatch(/sinal/i);
    expect(txRows(db).map((row) => row.id)).toEqual(['pix-in']);
  });

  it('does not move the history window while the bank connection is not updated', async () => {
    const { db } = createTestDb();
    const { source, data, calls } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    data.items['item-inter'] = { id: 'item-inter', status: 'LOGIN_ERROR', consentExpiresAt: null };

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    expect(db.select().from(connections).where(eq(connections.id, 'item-inter')).get()).toMatchObject({
      status: 'LOGIN_ERROR',
      lastSuccessAt: T1,
    });
    data.items['item-inter'] = { id: 'item-inter', status: 'UPDATED', consentExpiresAt: null };
    calls.length = 0;
    await runSync({ db, source, config: config(), classifier: null, now: at('2026-11-20T10:00:00.000Z') });
    expect(calls).toContainEqual({ accountId: 'inter-checking', dateFrom: '2026-10-04' });
  });

  it('records a zero balance for an investment that is gone', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    data.investments['item-c6'] = [];

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    const cdb = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, 'cdb-1')).all();
    expect(cdb.map((s) => [s.date, s.balanceCents])).toEqual([
      ['2026-10-14', 100000],
      ['2026-10-15', 0],
    ]);
  });

  it('keeps investment movements after the bank stops sending them', async () => {
    const { db } = createTestDb();
    const { source, data } = fakeSource();
    await runSync({ db, source, config: config(), classifier: null, now: at(T1) });
    data.movements['cdb-1'] = [];

    await runSync({ db, source, config: config(), classifier: null, now: at(T2) });

    const rows = db.select().from(investmentMovements).orderBy(investmentMovements.id).all();
    expect(rows.map((m) => [m.id, m.accountId, m.date, m.type, m.amountCents, m.netCents])).toEqual([
      ['buy-1', 'cdb-1', '2026-09-01', 'BUY', 100000, 100000],
      ['sell-1', 'cdb-1', '2026-09-20', 'SELL', 20500, 20450],
    ]);
    expect(rows[0]?.firstSeenAt).toBe(T1);
  });
});
