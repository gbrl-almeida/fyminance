import { describe, expect, it } from 'vitest';
import { makeTx } from '../core/testing';
import type { Classification } from '../core/types';
import { monthChecks } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestClassification, insertTestTx } from '../db/testing';
import { deletePlanNote, saveGoals, savePlanNote } from '../curation/goals';
import { makeClassification } from '../core/testing';
import { getGoalsBoard } from './goals';

const ctx = { now: () => new Date('2026-11-02T10:00:00.000Z'), actor: 'pessoa2' as const };
const TODAY = '2026-11-02';

function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'card', kind: 'credit_card' });
  insertTestAccount(db, { id: 'chk', kind: 'checking' });
  let n = 0;
  const add = (date: string, cents: number, category: string, extra: Partial<Classification> = {}, tx: Parameters<typeof makeTx>[0] | object = {}) => {
    n += 1;
    const id = `t${n}`;
    const account = cents > 0 ? 'chk' : 'card';
    insertTestTx(db, makeTx({ id, accountId: account, accountKind: account === 'card' ? 'credit_card' : 'checking', date, amountCents: cents, ...tx }));
    insertTestClassification(
      db,
      makeClassification({ transactionId: id, nature: cents > 0 ? 'income' : 'expense', categoryId: categoryIdByName(db, category), source: 'manual', ...extra }),
    );
  };
  add('2026-08-05', -90000, 'Mercado');
  add('2026-09-05', -120000, 'Mercado');
  add('2026-10-05', -90000, 'Mercado');
  add('2026-10-20', -30000, 'Viagem');
  for (const m of ['08', '09', '10']) add(`2026-${m}-10`, -250000, 'Moradia');
  add('2026-10-12', -5000, 'Assinaturas');
  add('2026-08-01', 600000, 'Salário');
  add('2026-09-01', 600000, 'Salário');
  add('2026-10-01', 900000, 'Salário');
  add('2026-10-15', -5000, 'Casa', {}, { description: 'LOJA 03/10', installmentNumber: 3, installmentTotal: 10, purchaseDate: '2026-08-15' });
  return db;
}

const row = (board: ReturnType<typeof getGoalsBoard>, name: string) => board.rows.find((r) => r.name === name);

describe('goals board', () => {
  it('board suggests average plus notes', async () => {
    const db = setup();
    savePlanNote(db, { month: '2026-11', title: 'Viagem para Floripa', lines: [{ categoryId: categoryIdByName(db, 'Viagem'), deltaCents: 225000 }] }, ctx);
    const board = getGoalsBoard(db, '2026-10', TODAY);
    expect(board.targetMonth).toBe('2026-11');
    expect(row(board, 'Viagem')).toMatchObject({ averageCents: 10000, closingMonthCents: 30000, suggestionCents: 235000, goalCents: null, noteFromPlan: 'Viagem para Floripa' });
    expect(row(board, 'Alimentação')).toMatchObject({ averageCents: 100000, closingMonthCents: 90000, suggestionCents: 100000 });
    expect(board.notes).toEqual([
      { id: expect.any(Number), title: 'Viagem para Floripa', createdBy: 'pessoa2', lines: [{ categoryId: categoryIdByName(db, 'Viagem'), name: 'Viagem', deltaCents: 225000 }] },
    ]);
  });

  it('saved goals override suggestions in the total', () => {
    const db = setup();
    saveGoals(db, '2026-11', [{ categoryId: categoryIdByName(db, 'Alimentação'), cents: 95000, note: 'menos delivery' }], null, ctx);
    const board = getGoalsBoard(db, '2026-10', TODAY);
    expect(row(board, 'Alimentação')).toMatchObject({ goalCents: 95000, note: 'menos delivery' });
    // 95000 (meta) + Viagem 10000 + Moradia 250000 + Assinaturas floor(5000 / 3) + Casa floor(5000 / 3)
    expect(board.goalsTotalCents).toBe(95000 + 10000 + 250000 + 1666 + 1666);
    expect(board.shouldRemainCents).toBe(700000 - board.goalsTotalCents);
  });

  it('expected income defaults to the average and keeps a saved value', () => {
    const db = setup();
    expect(getGoalsBoard(db, '2026-10', TODAY)).toMatchObject({ expectedIncomeCents: 700000, expectedIncomeIsDefault: true });
    saveGoals(db, '2026-11', [], 800000, ctx);
    expect(getGoalsBoard(db, '2026-10', TODAY)).toMatchObject({ expectedIncomeCents: 800000, expectedIncomeIsDefault: false });
  });

  it('committed shows installments, housing and subscriptions', () => {
    const db = setup();
    expect(getGoalsBoard(db, '2026-10', TODAY).committed).toEqual({ installmentsCents: 5000, fixedCents: 250000, subscriptionsCents: 5000, totalCents: 260000 });
  });

  it('goal on a subcategory is refused', () => {
    const db = setup();
    expect(() => saveGoals(db, '2026-11', [{ categoryId: categoryIdByName(db, 'Mercado'), cents: 1, note: null }], null, ctx)).toThrow(
      'Metas só valem para categorias de gasto do primeiro nível.',
    );
    expect(() => savePlanNote(db, { month: '2026-11', title: 'x', lines: [{ categoryId: categoryIdByName(db, 'Salário'), deltaCents: 1 }] }, ctx)).toThrow(
      'Metas só valem para categorias de gasto do primeiro nível.',
    );
  });

  it('saveGoals marks the goals check of the closing month', () => {
    const db = setup();
    saveGoals(db, '2026-11', [], null, ctx);
    expect(db.select().from(monthChecks).all()).toEqual([expect.objectContaining({ month: '2026-10', key: 'goals', doneBy: 'pessoa2' })]);
  });

  it('a note can be edited and deleted', () => {
    const db = setup();
    const viagem = categoryIdByName(db, 'Viagem');
    const { id } = savePlanNote(db, { month: '2026-11', title: 'Viagem', lines: [{ categoryId: viagem, deltaCents: 100 }] }, ctx);
    savePlanNote(db, { id, month: '2026-11', title: 'Viagem longa', lines: [{ categoryId: viagem, deltaCents: 200 }] }, ctx);
    expect(getGoalsBoard(db, '2026-10', TODAY).notes).toMatchObject([{ title: 'Viagem longa', lines: [{ deltaCents: 200 }] }]);
    deletePlanNote(db, id, ctx);
    expect(getGoalsBoard(db, '2026-10', TODAY).notes).toEqual([]);
  });
});
