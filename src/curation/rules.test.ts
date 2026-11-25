import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeTx } from '../core/testing';
import { loadClassifications } from '../db/ledger';
import { auditLog, rules } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { deleteRule, listRules, saveRule } from './rules';

const pipeline: PipelineConfig = { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() };
const ctx = { pipeline, now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa1' as const };

function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'c6', kind: 'checking' });
  insertTestTx(db, makeTx({ id: 'shop', accountId: 'c6', amountCents: -9900, description: 'LOJA XPTO' }));
  insertTestTx(db, makeTx({ id: 'pj', accountId: 'c6', amountCents: 300000, description: 'TED FULANO SERVICOS LTDA' }));
  return db;
}

describe('saveRule', () => {
  it('creates a user rule, derives the nature from the category and reclassifies', async () => {
    const db = setup();
    const others = categoryIdByName(db, 'Outros');
    const { id } = await saveRule(db, { merchantKey: 'LOJA XPTO', setCategoryId: others }, ctx);
    expect(db.select().from(rules).get()).toMatchObject({ id, origin: 'user', setNature: 'expense', setCategoryId: others });
    expect(loadClassifications(db).get('shop')).toMatchObject({ categoryId: others, source: 'rule', ruleId: id });
  });

  it('splits PJ income with an exact amount rule', async () => {
    const db = setup();
    const prolabore = categoryIdByName(db, 'Pró-labore');
    await saveRule(
      db,
      { merchantKey: 'FULANO SERVICOS LTDA', minCents: 300000, maxCents: 300000, direction: 'in', setCategoryId: prolabore },
      ctx,
    );
    expect(loadClassifications(db).get('pj')).toMatchObject({ nature: 'income', categoryId: prolabore, reviewReason: null });
  });

  it('updates an existing rule and keeps its origin', async () => {
    const db = setup();
    const others = categoryIdByName(db, 'Outros');
    const home = categoryIdByName(db, 'Casa');
    const { id } = await saveRule(db, { merchantKey: 'LOJA XPTO', setCategoryId: others }, ctx);
    await saveRule(db, { id, merchantKey: 'LOJA XPTO', setCategoryId: home }, ctx);
    expect(db.select().from(rules).all()).toEqual([expect.objectContaining({ id, origin: 'user', setCategoryId: home })]);
    expect(loadClassifications(db).get('shop')?.categoryId).toBe(home);
  });

  it('validates conditions, effects and consistency', async () => {
    const db = setup();
    const others = categoryIdByName(db, 'Outros');
    const salary = categoryIdByName(db, 'Salário');
    await expect(saveRule(db, { setCategoryId: others }, ctx)).rejects.toThrow('Uma regra precisa de pelo menos uma condição.');
    await expect(saveRule(db, { merchantKey: 'X' }, ctx)).rejects.toThrow('Uma regra precisa definir natureza, categoria ou dono.');
    await expect(saveRule(db, { merchantKey: 'X', minCents: 10, maxCents: 5, setOwner: 'casal' }, ctx)).rejects.toThrow(
      'minCents maior que maxCents.',
    );
    await expect(saveRule(db, { merchantKey: 'X', setNature: 'transfer', setCategoryId: others }, ctx)).rejects.toThrow(
      'Transferência não leva categoria.',
    );
    await expect(saveRule(db, { merchantKey: 'X', setNature: 'expense', setCategoryId: salary }, ctx)).rejects.toThrow(
      'A natureza não combina com o tipo da categoria.',
    );
    await expect(saveRule(db, { id: 999, merchantKey: 'X', setOwner: 'casal' }, ctx)).rejects.toThrow('Regra 999 não existe.');
  });
});

describe('deleteRule and listRules', () => {
  it('lists rules with their category and matches, and deletes them', async () => {
    const db = setup();
    const others = categoryIdByName(db, 'Outros');
    const { id } = await saveRule(db, { merchantKey: 'LOJA XPTO', setCategoryId: others }, ctx);
    expect(listRules(db)).toEqual([expect.objectContaining({ id, origin: 'user', categoryPath: 'Outros', matches: 1 })]);

    await deleteRule(db, id, ctx);

    expect(listRules(db)).toEqual([]);
    expect(loadClassifications(db).get('shop')).toMatchObject({ categoryId: null, reviewReason: 'uncategorized' });
    expect(db.select().from(auditLog).all().map((e) => e.action)).toEqual(['save_rule', 'delete_rule']);
    await expect(deleteRule(db, id, ctx)).rejects.toThrow(`Regra ${id} não existe.`);
  });
});
