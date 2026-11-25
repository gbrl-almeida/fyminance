import { describe, expect, it } from 'vitest';
import { makeClassification, makeTx } from '../core/testing';
import { balanceSnapshots, bills } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestClassification, insertTestTx } from '../db/testing';
import { getBalances } from './balances';
import { getPendingItems } from './pending';
import { getSpending } from './spending';
import { runReadOnlySql } from './sql';
import { FIXTURE_TODAY, buildLedgerFixture } from './test-fixture';
import { listTransactions } from './transactions';

function fixture() {
  const handle = createTestDb();
  buildLedgerFixture(handle.db);
  return handle;
}

describe('getSpending', () => {
  it('groups October spending by parent category', () => {
    const { db } = fixture();
    expect(getSpending(db, { from: '2026-10-01', to: '2026-10-31', groupBy: 'parent_category' }).map((l) => [l.label, l.cents])).toEqual([
      ['Moradia', 250000],
      ['Casa', 50000],
      ['Alimentação', 29590],
      ['Lazer', 19990],
      ['Sem categoria', 8300],
    ]);
  });

  it('groups by month in chronological order', () => {
    const { db } = fixture();
    expect(getSpending(db, { from: '2026-09-01', to: '2026-10-31', groupBy: 'month' })).toEqual([
      { key: '2026-09', label: '2026-09', cents: 56000, count: 2 },
      { key: '2026-10', label: '2026-10', cents: 357880, count: 7 },
    ]);
  });

  it('includes child categories when filtering by a parent, and filters by owner', () => {
    const { db } = fixture();
    const food = getSpending(db, {
      from: '2026-10-01',
      to: '2026-10-31',
      groupBy: 'category',
      categoryId: categoryIdByName(db, 'Alimentação'),
    });
    expect(food.map((l) => [l.label, l.cents])).toEqual([
      ['Alimentação > Mercado', 25000],
      ['Alimentação > Delivery', 4590],
    ]);
    expect(getSpending(db, { from: '2026-10-01', to: '2026-10-31', groupBy: 'owner', owner: 'pessoa1' })).toEqual([
      { key: 'pessoa1', label: 'pessoa1', cents: 19990, count: 1 },
    ]);
  });
});

describe('listTransactions', () => {
  it('lists the newest first with pagination', () => {
    const { db } = fixture();
    const page = listTransactions(db, { limit: 3 });
    expect(page.total).toBe(15);
    expect(page.items.map((t) => t.id)).toEqual(['friend', 'unknown', 'rent']);
  });

  it('filters the review queue and searches descriptions', () => {
    const { db } = fixture();
    expect(listTransactions(db, { reviewOnly: true }).items.map((t) => t.id)).toEqual(['friend', 'unknown']);
    expect(listTransactions(db, { search: 'ifood' }).items.map((t) => t.id)).toEqual(['ifood-oct', 'ifood-sep']);
  });

  it('searches by value, category and account as well', () => {
    const { db } = fixture();
    const ids = (search: string) => listTransactions(db, { search }).items.map((t) => t.id);
    expect(ids('45,90')).toEqual(['ifood-oct']);
    expect(ids('250')).toEqual(['market']);
    expect(ids('2.500')).toEqual(['rent']);
    expect(ids('delivery')).toEqual(['ifood-oct', 'ifood-sep']);
    expect(ids('salario inter')).toEqual(['salary']);
  });

  it('describes each transaction for reading', () => {
    const { db } = fixture();
    expect(listTransactions(db, { search: 'LOJA TV 02' }).items[0]).toEqual({
      id: 'tv-2',
      date: '2026-10-10',
      description: 'LOJA TV 02/10',
      merchantKey: 'LOJA TV',
      amountCents: -50000,
      account: 'C6 · Cartão',
      status: 'posted',
      nature: 'expense',
      category: 'Casa',
      owner: 'casal',
      reviewReason: null,
      installment: '2/10',
      note: null,
      split: null,
      offsets: [],
    });
  });
});

describe('getBalances', () => {
  it('shows the latest balance per account and explains connection problems', () => {
    const { db } = fixture();
    const balances = getBalances(db, FIXTURE_TODAY);
    expect(balances.accounts.find((a) => a.id === 'c6-checking')).toMatchObject({ balanceCents: 415000, asOf: '2026-10-14' });
    expect(balances.accounts.find((a) => a.id === 'c6-card')).toMatchObject({ balanceCents: null, asOf: null });
    expect(balances.connections.find((c) => c.id === 'item-c6')?.problems).toEqual([]);
    expect(balances.connections.find((c) => c.id === 'item-inter')?.problems).toEqual([
      'Status no Meu Pluggy: LOGIN_ERROR. Reconectar Inter no Meu Pluggy.',
      'Sem sincronizar há 13 dias.',
      'Consentimento vence em 2026-11-01. Renovar no Meu Pluggy.',
    ]);
  });
});

describe('getPendingItems', () => {
  it('groups the review queue by merchant, biggest first', () => {
    const { db } = fixture();
    const pending = getPendingItems(db, { today: FIXTURE_TODAY });
    expect(pending.review).toEqual([
      {
        key: 'MARIA|pix_person|out|',
        merchantKey: 'MARIA',
        reason: 'pix_person',
        count: 1,
        totalCents: 5000,
        direction: 'out',
        samples: ['PIX ENVIADO MARIA'],
        transactionIds: ['friend'],
        lastDate: '2026-10-12',
        suggestedCategory: null,
        suggestedCategoryId: null,
        lateFromMonth: null,
        refundOf: null,
      },
      {
        key: 'LOJA XPTO|uncategorized|out|',
        merchantKey: 'LOJA XPTO',
        reason: 'uncategorized',
        count: 1,
        totalCents: 3300,
        direction: 'out',
        samples: ['LOJA XPTO'],
        transactionIds: ['unknown'],
        lastDate: '2026-10-11',
        suggestedCategory: null,
        suggestedCategoryId: null,
        lateFromMonth: null,
        refundOf: null,
      },
    ]);
    expect(getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-09' }).review).toEqual([]);
  });

  it('points a possible refund to the purchase it matches, one credit per row', () => {
    const { db } = fixture();
    const card = { accountId: 'c6-card', accountKind: 'credit_card' as const };
    insertTestTx(db, makeTx({ id: 'trip', ...card, date: '2026-10-03', amountCents: -21000, description: 'BUS SERVICOS*CLICKBUS', installmentNumber: 1, installmentTotal: 4, purchaseDate: '2026-10-03' }));
    insertTestTx(db, makeTx({ id: 'back', ...card, date: '2026-10-04', amountCents: 42000, description: 'Refund' }));
    insertTestClassification(db, makeClassification({ transactionId: 'trip', categoryId: categoryIdByName(db, 'Viagem'), source: 'rule' }));
    insertTestClassification(db, makeClassification({ transactionId: 'back', categoryId: categoryIdByName(db, 'Viagem'), source: 'system', reviewReason: 'refund' }));
    const row = getPendingItems(db, { today: FIXTURE_TODAY }).review.find((g) => g.reason === 'refund');
    expect(row).toMatchObject({
      key: 'REFUND|refund|in||back',
      transactionIds: ['back'],
      refundOf: { id: 'trip', date: '2026-10-03', description: 'BUS SERVICOS*CLICKBUS', amountCents: -21000, installment: '1/4' },
    });
  });

  it('lists each income from the PJ on its own row, since one may be pró-labore and the other profits', () => {
    const { db } = fixture();
    for (const [id, cents] of [['pj-profit', 840000], ['pj-salary', 308000]] as const) {
      insertTestTx(db, makeTx({ id, accountId: 'c6-checking', date: '2026-10-01', amountCents: cents, description: 'PIX RECEBIDO FULANO SERVICOS LTDA' }));
      insertTestClassification(db, makeClassification({ transactionId: id, nature: 'income', reviewReason: 'pj_income' }));
    }
    const pj = getPendingItems(db, { today: FIXTURE_TODAY }).review.filter((g) => g.reason === 'pj_income');
    expect(pj.map((g) => [g.transactionIds, g.totalCents, g.lastDate])).toEqual([
      [['pj-profit'], 840000, '2026-10-01'],
      [['pj-salary'], 308000, '2026-10-01'],
    ]);
    expect(new Set(pj.map((g) => g.key)).size).toBe(2);
  });

  it('lists divergences, vanished transactions and connection problems', () => {
    const { db } = fixture();
    const pending = getPendingItems(db, { today: FIXTURE_TODAY });
    expect(pending.billDivergences).toEqual([
      {
        id: 'bill-2',
        accountId: 'c6-card',
        dueDate: '2026-11-15',
        totalCents: 99999,
        computedCents: 0,
        diffCents: 99999,
        account: 'C6 · Cartão',
        key: 'bill:bill-2',
        explanation: null,
      },
    ]);
    expect(pending.missingPosted).toEqual([
      {
        id: 'ghost',
        date: '2026-10-02',
        description: 'TARIFA FANTASMA',
        amountCents: -1000,
        account: 'C6 · Conta corrente',
        missingSince: '2026-10-13',
      },
    ]);
    expect(pending.connections.map((c) => c.id)).toEqual(['item-inter']);
    expect(pending.balanceDivergences).toEqual([]);
  });

  it('skips bills older than the imported history and filters bills by month', () => {
    const { db } = fixture();
    // Fatura que venceu antes de o histórico de transações começar: nada a conferir.
    db.insert(bills).values({ id: 'bill-old', accountId: 'c6-card', dueDate: '2026-08-15', totalCents: 12345, raw: '{}' }).run();
    expect(getPendingItems(db, { today: FIXTURE_TODAY }).billDivergences.map((d) => d.id)).toEqual(['bill-2']);
    expect(getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-10' }).billDivergences).toEqual([]);
    expect(getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-11' }).billDivergences.map((d) => d.id)).toEqual(['bill-2']);
  });

  it('reports a persistent balance gap on a checking account', () => {
    const { db } = fixture();
    // Deriva de −5000 já na primeira comparação (dia 14) é a linha de base; o gap novo de −5000 aparece em 15 e 16.
    db.insert(balanceSnapshots)
      .values([
        { accountId: 'c6-checking', date: '2026-10-15', takenAt: '2026-10-15T10:00:00.000Z', balanceCents: 410000 },
        { accountId: 'c6-checking', date: '2026-10-16', takenAt: '2026-10-16T10:00:00.000Z', balanceCents: 410000 },
      ])
      .run();
    expect(getPendingItems(db, { today: '2026-10-16' }).balanceDivergences).toEqual([
      {
        accountId: 'c6-checking',
        sinceDate: '2026-10-13',
        asOfDate: '2026-10-16',
        diffCents: -5000,
        account: 'C6 · Conta corrente',
        key: 'balance:c6-checking:2026-10-13:-5000',
        explanation: null,
      },
    ]);
  });
});

describe('runReadOnlySql', () => {
  it('runs a read query over the documented views', () => {
    const { sqlite } = fixture();
    const result = runReadOnlySql(
      sqlite,
      "SELECT parent_category_name AS categoria, SUM(-amount_cents) AS gasto FROM v_transactions WHERE month = '2026-10' AND nature = 'expense' GROUP BY 1 ORDER BY 2 DESC;",
    );
    expect(result.columns).toEqual(['categoria', 'gasto']);
    expect(result.rows[0]).toEqual({ categoria: 'Moradia', gasto: 250000 });
    expect(result.truncated).toBe(false);
  });

  it('refuses writes and multiple statements', () => {
    const { sqlite } = fixture();
    expect(() => runReadOnlySql(sqlite, "DELETE FROM transactions WHERE id = 'rent'")).toThrow(
      'Apenas consultas de leitura são permitidas.',
    );
    expect(() => runReadOnlySql(sqlite, 'PRAGMA user_version = 5')).toThrow('Apenas consultas de leitura são permitidas.');
    expect(() => runReadOnlySql(sqlite, 'SELECT 1; SELECT 2')).toThrow('Envie uma única consulta.');
  });

  it('caps the number of rows', () => {
    const { sqlite } = fixture();
    const result = runReadOnlySql(
      sqlite,
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000) SELECT i FROM n',
      10,
    );
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});
