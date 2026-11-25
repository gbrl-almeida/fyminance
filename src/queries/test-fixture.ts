import { makeClassification, makeTx } from '../core/testing';
import type { Classification, Tx } from '../core/types';
import type { Db } from '../db/client';
import { balanceSnapshots, bills, connections } from '../db/schema';
import { categoryIdByName, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';

export const FIXTURE_TODAY = '2026-10-14';

type FixtureTx = Partial<Tx> & Pick<Tx, 'id' | 'accountId' | 'date' | 'amountCents' | 'description'>;

export function buildLedgerFixture(db: Db): void {
  insertTestAccount(db, { id: 'c6-checking', kind: 'checking', name: 'C6 · Conta corrente', connectionId: 'item-c6' });
  insertTestAccount(db, { id: 'c6-card', kind: 'credit_card', name: 'C6 · Cartão', connectionId: 'item-c6' });
  insertTestAccount(db, { id: 'inter-checking', kind: 'checking', owner: 'pessoa2', name: 'Inter · Conta', connectionId: 'item-inter' });
  insertTestAccount(db, { id: 'cdb', kind: 'investment', name: 'C6 · CDB', connectionId: 'item-c6' });

  const cat = (name: string) => categoryIdByName(db, name);
  const add = (tx: FixtureTx, cls: Partial<Classification> | null, missingSince: string | null = null) => {
    insertTestTx(db, makeTx({ accountKind: tx.accountId === 'c6-card' ? 'credit_card' : 'checking', ...tx }), { missingSince });
    if (cls !== null) insertTestClassification(db, makeClassification({ transactionId: tx.id, ...cls }));
  };
  const tvGroup = 'c6-card|LOJA TV|2026-09|10';

  add(
    { id: 'salary', accountId: 'inter-checking', date: '2026-10-05', amountCents: 600000, description: 'SALARIO EMPRESA X' },
    { nature: 'income', categoryId: cat('Salário'), source: 'rule' },
  );
  add(
    { id: 'prolabore', accountId: 'c6-checking', date: '2026-10-06', amountCents: 300000, description: 'PIX RECEBIDO FULANO SERVICOS LTDA' },
    { nature: 'income', categoryId: cat('Pró-labore'), source: 'rule' },
  );
  add(
    { id: 'ifood-oct', accountId: 'c6-card', date: '2026-10-07', amountCents: -4590, description: 'IFOOD *IFOOD' },
    { categoryId: cat('Delivery'), source: 'model', model: 'fake/model', confidence: 'high' },
  );
  add(
    { id: 'ifood-sep', accountId: 'c6-card', date: '2026-09-20', amountCents: -6000, description: 'IFOOD *IFOOD', billId: 'bill-1' },
    { categoryId: cat('Delivery'), source: 'model', model: 'fake/model', confidence: 'high' },
  );
  add(
    { id: 'market', accountId: 'c6-card', date: '2026-10-08', amountCents: -25000, description: 'SUPERMERCADO BOM PRECO' },
    { categoryId: cat('Mercado'), source: 'rule' },
  );
  add(
    {
      id: 'rent',
      accountId: 'c6-checking',
      date: '2026-10-10',
      amountCents: -250000,
      description: 'PIX ENVIADO JOAO PROPRIETARIO',
      counterpartDocType: 'cpf',
      counterpartDoc: '44444444444',
    },
    { categoryId: cat('Moradia'), source: 'manual' },
  );
  add(
    { id: 'game', accountId: 'c6-card', date: '2026-10-09', amountCents: -19990, description: 'STEAM GAMES' },
    { categoryId: cat('Lazer'), owner: 'pessoa1', source: 'manual' },
  );
  add(
    { id: 'unknown', accountId: 'c6-card', date: '2026-10-11', amountCents: -3300, description: 'LOJA XPTO' },
    { reviewReason: 'uncategorized' },
  );
  add(
    {
      id: 'friend',
      accountId: 'c6-checking',
      date: '2026-10-12',
      amountCents: -5000,
      description: 'PIX ENVIADO MARIA',
      counterpartDocType: 'cpf',
      counterpartDoc: '33333333333',
    },
    { reviewReason: 'pix_person' },
  );
  add(
    { id: 'bill-pay', accountId: 'c6-checking', date: '2026-10-05', amountCents: -100000, description: 'PAGAMENTO DE FATURA' },
    { nature: 'transfer', transferKind: 'bill_payment', transferPairId: 'bill-recv' },
  );
  add(
    { id: 'bill-recv', accountId: 'c6-card', date: '2026-10-05', amountCents: 100000, description: 'PAGAMENTO RECEBIDO' },
    { nature: 'transfer', transferKind: 'bill_payment', transferPairId: 'bill-pay' },
  );
  add(
    { id: 'apply', accountId: 'c6-checking', date: '2026-09-15', amountCents: -50000, description: 'APLICACAO CDB' },
    { nature: 'transfer', transferKind: 'investment' },
  );
  add(
    {
      id: 'tv-1',
      accountId: 'c6-card',
      date: '2026-09-10',
      amountCents: -50000,
      description: 'LOJA TV 01/10',
      installmentNumber: 1,
      installmentTotal: 10,
      billId: 'bill-1',
    },
    { categoryId: cat('Casa'), source: 'manual', purchaseGroup: tvGroup },
  );
  add(
    {
      id: 'tv-2',
      accountId: 'c6-card',
      date: '2026-10-10',
      amountCents: -50000,
      description: 'LOJA TV 02/10',
      installmentNumber: 2,
      installmentTotal: 10,
    },
    { categoryId: cat('Casa'), source: 'manual', purchaseGroup: tvGroup },
  );
  add({ id: 'ghost', accountId: 'c6-checking', date: '2026-10-02', amountCents: -1000, description: 'TARIFA FANTASMA' }, null, '2026-10-13');

  db.insert(balanceSnapshots)
    .values([
      { accountId: 'cdb', date: '2026-09-01', takenAt: '2026-09-01T10:00:00.000Z', balanceCents: 100000 },
      { accountId: 'cdb', date: '2026-10-01', takenAt: '2026-10-01T10:00:00.000Z', balanceCents: 150500 },
      { accountId: 'c6-checking', date: '2026-10-13', takenAt: '2026-10-13T10:00:00.000Z', balanceCents: 420000 },
      { accountId: 'c6-checking', date: '2026-10-14', takenAt: '2026-10-14T10:00:00.000Z', balanceCents: 415000 },
    ])
    .run();
  db.insert(bills)
    .values([
      { id: 'bill-1', accountId: 'c6-card', dueDate: '2026-10-15', totalCents: 56000, raw: '{}' },
      { id: 'bill-2', accountId: 'c6-card', dueDate: '2026-11-15', totalCents: 99999, raw: '{}' },
    ])
    .run();
  db.insert(connections)
    .values([
      { id: 'item-c6', owner: 'pessoa1', institution: 'C6', status: 'UPDATED', lastSuccessAt: '2026-10-14T10:00:00.000Z' },
      {
        id: 'item-inter',
        owner: 'pessoa2',
        institution: 'Inter',
        status: 'LOGIN_ERROR',
        lastSuccessAt: '2026-10-01T10:00:00.000Z',
        consentExpiresAt: '2026-11-01T00:00:00.000Z',
      },
    ])
    .run();
}
