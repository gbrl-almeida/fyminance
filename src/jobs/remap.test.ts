import { describe, expect, it } from 'vitest';
import { makeTx } from '../core/testing';
import { transactions } from '../db/schema';
import { createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { remapPluggyTransactions } from './remap';

const billByBoleto = {
  id: 'boleto',
  accountId: 'inter',
  date: '2026-09-15T12:00:00.000Z',
  description: 'Pagamento efetuado - Pagamento Fatura - FULANA DE TAL',
  type: 'DEBIT',
  amount: 512.4,
  status: 'POSTED',
  paymentData: { paymentMethod: 'BOLETO', receiver: { name: 'BANCO EXEMPLO S.A' } },
};

describe('remapPluggyTransactions', () => {
  it('rereads what the Pluggy sent with the current reading, leaving other origins alone', () => {
    const { db } = createTestDb();
    insertTestAccount(db, { id: 'inter', kind: 'checking' });
    insertTestTx(db, makeTx({ id: 'boleto', accountId: 'inter', date: '2026-09-15', amountCents: -51240, description: 'Boleto BANCO EXEMPLO S.A' }), { raw: billByBoleto });
    insertTestTx(db, makeTx({ id: 'cash', accountId: 'inter', date: '2026-09-22', amountCents: -1000, description: 'Feira' }), { origin: 'manual', raw: null });

    expect(remapPluggyTransactions(db)).toBe(1);

    const rows = new Map(db.select().from(transactions).all().map((t) => [t.id, t]));
    expect(rows.get('boleto')).toMatchObject({ description: 'Pagamento efetuado - Pagamento Fatura - FULANA DE TAL', merchantKey: expect.stringContaining('FATURA') });
    expect(rows.get('cash')?.description).toBe('Feira');
    expect(remapPluggyTransactions(db)).toBe(0);
  });
});
