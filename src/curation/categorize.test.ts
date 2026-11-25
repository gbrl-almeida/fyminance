import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../core/classify';
import { makeTx } from '../core/testing';
import { loadClassifications } from '../db/ledger';
import { auditLog, categories, rules } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { reclassify } from '../jobs/reclassify';
import { getPendingItems } from '../queries/pending';
import { categorize } from './categorize';

const pipeline: PipelineConfig = {
  pjDocument: null,
  pjNamePattern: null,
  transferWindowDays: 3,
  householdDocuments: new Set(),
};
const ctx = { pipeline, now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa1' as const };

async function setup() {
  const { db } = createTestDb();
  insertTestAccount(db, { id: 'c6', kind: 'checking' });
  const maria = { counterpartDocType: 'cpf' as const, counterpartDoc: '33333333333' };
  insertTestTx(db, makeTx({ id: 'out-1', accountId: 'c6', date: '2026-10-01', amountCents: -5000, description: 'PIX ENVIADO MARIA', ...maria }));
  insertTestTx(db, makeTx({ id: 'out-2', accountId: 'c6', date: '2026-10-08', amountCents: -7000, description: 'PIX ENVIADO MARIA', ...maria }));
  insertTestTx(db, makeTx({ id: 'in-1', accountId: 'c6', date: '2026-10-09', amountCents: 2500, description: 'PIX RECEBIDO MARIA', ...maria }));
  insertTestTx(db, makeTx({ id: 'shop', accountId: 'c6', date: '2026-10-02', amountCents: -9900, description: 'LOJA XPTO' }));
  await reclassify({ db, pipeline, classifier: null, now: ctx.now });
  return db;
}

describe('categorize', () => {
  it('records who decided', async () => {
    const db = await setup();
    await categorize(db, { target: { transactionIds: ['shop'] }, owner: 'pessoa1', scope: 'only_these' }, { ...ctx, actor: 'pessoa2' });
    const entry = db.select().from(auditLog).all().at(-1);
    expect(JSON.parse(entry?.payload ?? '{}')).toMatchObject({ actor: 'pessoa2' });
  });

  it('learns a rule from transactions going the same way, leaving the other direction alone', async () => {
    const db = await setup();
    const home = categoryIdByName(db, 'Casa');

    const result = await categorize(db, { target: { transactionIds: ['out-1', 'out-2'] }, categoryId: home, scope: 'rule' }, ctx);

    expect(result).toEqual({ ruleId: 1, affected: 2 });
    expect(db.select().from(rules).all()).toEqual([
      expect.objectContaining({
        merchantKey: 'MARIA',
        direction: 'out',
        setCategoryId: home,
        setNature: 'expense',
        setOwner: null,
        origin: 'learned',
      }),
    ]);
    const saved = loadClassifications(db);
    expect(saved.get('out-1')).toMatchObject({ categoryId: home, source: 'rule', reviewReason: null });
    expect(saved.get('out-2')).toMatchObject({ categoryId: home, source: 'rule', reviewReason: null });
    expect(saved.get('in-1')).toMatchObject({ categoryId: null, reviewReason: 'pix_person' });
  });

  it('records a one-off decision that survives reprocessing', async () => {
    const db = await setup();
    const restaurant = categoryIdByName(db, 'Restaurante');

    await categorize(db, { target: { transactionIds: ['in-1'] }, categoryId: restaurant, scope: 'only_these' }, ctx);
    await reclassify({ db, pipeline, classifier: null, now: ctx.now });

    expect(loadClassifications(db).get('in-1')).toMatchObject({
      nature: 'expense',
      categoryId: restaurant,
      source: 'manual',
      reviewReason: null,
    });
    expect(db.select().from(rules).all()).toEqual([]);
  });

  it('creates a rule for a whole merchant, with owner', async () => {
    const db = await setup();
    const others = categoryIdByName(db, 'Outros');

    await categorize(db, { target: { merchantKey: 'LOJA XPTO' }, categoryId: others, owner: 'pessoa2', scope: 'rule' }, ctx);

    expect(db.select().from(rules).get()).toMatchObject({ merchantKey: 'LOJA XPTO', direction: 'out', setOwner: 'pessoa2' });
    expect(loadClassifications(db).get('shop')).toMatchObject({ categoryId: others, owner: 'pessoa2', source: 'rule' });
  });

  it('changes only the owner when no category is given', async () => {
    const db = await setup();
    await categorize(db, { target: { transactionIds: ['shop'] }, owner: 'pessoa1', scope: 'only_these' }, ctx);
    expect(loadClassifications(db).get('shop')).toMatchObject({
      owner: 'pessoa1',
      nature: 'expense',
      categoryId: null,
      source: 'manual',
      reviewReason: null,
    });
  });

  it('validates before writing anything', async () => {
    const db = await setup();
    await expect(categorize(db, { target: { transactionIds: ['shop'] }, scope: 'rule' }, ctx)).rejects.toThrow(
      'Informe categoryId, owner ou ambos.',
    );
    await expect(categorize(db, { target: { transactionIds: ['nope'] }, owner: 'casal', scope: 'only_these' }, ctx)).rejects.toThrow(
      'Alguma transação informada não existe ou foi removida.',
    );
    await expect(
      categorize(db, { target: { transactionIds: ['shop', 'out-1'] }, owner: 'casal', scope: 'rule' }, ctx),
    ).rejects.toThrow('Para criar regra, as transações precisam ser do mesmo estabelecimento.');
    await expect(categorize(db, { target: { merchantKey: 'LOJA XPTO' }, owner: 'casal', scope: 'only_these' }, ctx)).rejects.toThrow(
      '"only_these" exige transactionIds.',
    );
    await expect(categorize(db, { target: { merchantKey: 'NADA' }, owner: 'casal', scope: 'rule' }, ctx)).rejects.toThrow(
      'Nenhuma transação com o estabelecimento "NADA".',
    );
    const bakery = categoryIdByName(db, 'Padaria e café');
    db.update(categories).set({ archived: true }).where(eq(categories.id, bakery)).run();
    await expect(
      categorize(db, { target: { transactionIds: ['shop'] }, categoryId: bakery, scope: 'only_these' }, ctx),
    ).rejects.toThrow(`Categoria ${bakery} não existe ou está arquivada.`);
    expect(db.select().from(rules).all()).toEqual([]);
    expect(db.select().from(auditLog).all()).toEqual([]);
  });

  it('writes every decision to the audit log', async () => {
    const db = await setup();
    await categorize(db, { target: { transactionIds: ['shop'] }, owner: 'pessoa1', scope: 'only_these' }, ctx);
    const entries = db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'categorize', at: '2026-10-14T10:00:00.000Z' });
    expect(JSON.parse(entries[0]?.payload ?? '{}')).toMatchObject({ target: { transactionIds: ['shop'] }, owner: 'pessoa1' });
  });

  it('refuses one rule for Pix sent to and received from the same person', async () => {
    const db = await setup();
    const home = categoryIdByName(db, 'Casa');
    await expect(
      categorize(db, { target: { transactionIds: ['out-1', 'in-1'] }, categoryId: home, scope: 'rule' }, ctx),
    ).rejects.toThrow(/dois sentidos/);
    await expect(categorize(db, { target: { merchantKey: 'MARIA' }, categoryId: home, scope: 'rule' }, ctx)).rejects.toThrow(
      /dois sentidos/,
    );
    expect(db.select().from(rules).all()).toEqual([]);
  });

  it('reviews Pix sent to and received from the same person in separate groups', async () => {
    const db = await setup();
    const maria = getPendingItems(db, { today: '2026-10-14' }).review.filter((g) => g.merchantKey === 'MARIA');
    expect(maria.map((g) => [g.direction, g.transactionIds])).toEqual([
      ['out', ['out-1', 'out-2']],
      ['in', ['in-1']],
    ]);
  });

  describe('when the decision replaces an earlier one on the same transactions', () => {
    it('drops the rule it had created when it becomes a one-off', async () => {
      const db = await setup();
      const first = await categorize(db, { target: { transactionIds: ['shop'] }, categoryId: categoryIdByName(db, 'Casa'), scope: 'rule' }, ctx);
      const leisure = categoryIdByName(db, 'Lazer');

      const second = await categorize(db, { target: { transactionIds: ['shop'] }, categoryId: leisure, scope: 'only_these', replaces: { ruleId: first.ruleId } }, ctx);

      expect(second.ruleId).toBeNull();
      expect(db.select().from(rules).all()).toEqual([]);
      expect(loadClassifications(db).get('shop')).toMatchObject({ categoryId: leisure, source: 'manual' });
    });

    it('lets the new rule apply where the one-off had been written', async () => {
      const db = await setup();
      await categorize(db, { target: { transactionIds: ['out-1', 'out-2'] }, categoryId: categoryIdByName(db, 'Casa'), scope: 'only_these' }, ctx);
      const leisure = categoryIdByName(db, 'Lazer');

      await categorize(db, { target: { transactionIds: ['out-1', 'out-2'] }, categoryId: leisure, scope: 'rule', replaces: { ruleId: null } }, ctx);

      expect(db.select().from(rules).all()).toHaveLength(1);
      expect(loadClassifications(db).get('out-1')).toMatchObject({ categoryId: leisure, source: 'rule' });
      expect(loadClassifications(db).get('out-2')).toMatchObject({ categoryId: leisure, source: 'rule' });
    });

    it('keeps a single rule when only the owner changes', async () => {
      const db = await setup();
      const home = categoryIdByName(db, 'Casa');
      const first = await categorize(db, { target: { transactionIds: ['shop'] }, categoryId: home, scope: 'rule' }, ctx);

      await categorize(db, { target: { transactionIds: ['shop'] }, categoryId: home, owner: 'pessoa2', scope: 'rule', replaces: { ruleId: first.ruleId } }, ctx);

      expect(db.select().from(rules).all()).toEqual([expect.objectContaining({ merchantKey: 'LOJA XPTO', setOwner: 'pessoa2' })]);
      expect(loadClassifications(db).get('shop')).toMatchObject({ owner: 'pessoa2', source: 'rule' });
    });
  });
});
