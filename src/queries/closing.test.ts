import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { makeClassification, makeTx } from '../core/testing';
import { backfillLegacyClosings, closeMonth, confirmCheck, undoCheck } from '../curation/closing';
import { saveGoals } from '../curation/goals';
import { categoryGoals, classifications, monthClosings } from '../db/schema';
import { categoryIdByName, createTestDb, insertTestClassification, insertTestTx } from '../db/testing';
import { closedMonthDrift, getClosingStatus, pendingClosingMonth } from './closing';
import { getGoalsBoard } from './goals';
import { getPendingItems } from './pending';
import { buildLedgerFixture, FIXTURE_TODAY } from './test-fixture';

const ctx = { now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa2' as const };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const { db } = createTestDb();
  buildLedgerFixture(db);
  const dataDir = mkdtempSync(join(tmpdir(), 'fyminance-closing-'));
  dirs.push(dataDir);
  return { db, dataDir };
}

describe('closing status', () => {
  it('reconciliation incomplete while review queue has items', () => {
    const { db, dataDir } = setup();
    const status = getClosingStatus(db, '2026-10', FIXTURE_TODAY, dataDir);
    expect(status.reconciliation).toMatchObject({ reviewGroups: 2, reviewCents: 8300, complete: false, cashConfirmed: false, flashConfirmed: true });
    expect(status.steps).toEqual({ data: 'attention', reconciliation: 'attention', goals: 'pending', investments: 'pending' });
    expect(status.remaining).toBe(3);
    expect(status.closed).toBeNull();
  });

  it('complete after review, explanations and checks', () => {
    const { db, dataDir } = setup();
    // Revisão resolvida à mão (categorize reprocessaria a fixture, que não tem as regras reais).
    db.update(classifications)
      .set({ reviewReason: null, source: 'manual', categoryId: categoryIdByName(db, 'Casa') })
      .where(inArray(classifications.transactionId, ['unknown', 'friend']))
      .run();
    confirmCheck(db, '2026-10', 'cash', ctx);
    const status = getClosingStatus(db, '2026-10', FIXTURE_TODAY, dataDir);
    expect(status.reconciliation.complete).toBe(true);
    expect(status.steps.reconciliation).toBe('done');
    expect(status.remaining).toBe(2);
    undoCheck(db, '2026-10', 'cash', ctx);
    expect(getClosingStatus(db, '2026-10', FIXTURE_TODAY, dataDir).reconciliation.complete).toBe(false);
  });

  it('pending closing month is the previous month until it is closed', () => {
    const { db, dataDir } = setup();
    expect(pendingClosingMonth(db, FIXTURE_TODAY, dataDir)).toBe('2026-09');
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    expect(pendingClosingMonth(db, FIXTURE_TODAY, dataDir)).toBeNull();
  });
});

describe('closeMonth', () => {
  it('closeMonth refuses incomplete reconciliation', () => {
    const { db, dataDir } = setup();
    expect(() => closeMonth(db, '2026-10', dataDir, FIXTURE_TODAY, ctx)).toThrow('A conciliação de outubro de 2026 ainda não terminou.');
  });

  it('closeMonth writes report and closing row', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    const result = closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    expect(result).toEqual({ reportPath: 'relatorios/2026-09.md', alreadyClosed: false });
    const report = readFileSync(join(dataDir, result.reportPath), 'utf8');
    expect(report).toContain('# Relatório de setembro de 2026');
    expect(report).toContain('Taxa de poupança');
    expect(db.select().from(monthClosings).all()).toEqual([
      expect.objectContaining({ month: '2026-09', closedBy: 'pessoa2', reportPath: 'relatorios/2026-09.md', expenseCents: 56000 }),
    ]);
    expect(getClosingStatus(db, '2026-09', FIXTURE_TODAY, dataDir).closed).toEqual({ at: '2026-10-14T10:00:00.000Z', by: 'pessoa2' });
  });

  it('closing twice does not rewrite', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    const file = join(dataDir, 'relatorios/2026-09.md');
    writeFileSync(file, 'marcado\n');
    const before = statSync(file).mtimeMs;
    expect(closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx)).toEqual({ reportPath: 'relatorios/2026-09.md', alreadyClosed: true });
    expect(readFileSync(file, 'utf8')).toBe('marcado\n');
    expect(statSync(file).mtimeMs).toBe(before);
    expect(db.select().from(monthClosings).all()).toHaveLength(1);
  });

  it('a report file alone does not close a month', () => {
    const { db, dataDir } = setup();
    mkdirSync(join(dataDir, 'relatorios'), { recursive: true });
    writeFileSync(join(dataDir, 'relatorios/2026-10.md'), '# escrito à mão\n');
    expect(getClosingStatus(db, '2026-10', FIXTURE_TODAY, dataDir).closed).toBeNull();
    expect(() => closeMonth(db, '2026-10', dataDir, FIXTURE_TODAY, ctx)).toThrow('A conciliação de outubro de 2026 ainda não terminou.');
  });

  it('backfill turns old reports into closed months', () => {
    const { db, dataDir } = setup();
    mkdirSync(join(dataDir, 'relatorios'), { recursive: true });
    writeFileSync(join(dataDir, 'relatorios/2026-08.md'), '# antigo\n');
    expect(backfillLegacyClosings(db, dataDir, '2026-10-14T10:00:00.000Z')).toEqual(['2026-08']);
    expect(backfillLegacyClosings(db, dataDir, '2026-10-14T10:00:00.000Z')).toEqual([]);
    expect(getClosingStatus(db, '2026-08', FIXTURE_TODAY, dataDir).closed?.by).toBe('anterior');
    expect(closeMonth(db, '2026-08', dataDir, FIXTURE_TODAY, ctx).alreadyClosed).toBe(true);
    expect(readFileSync(join(dataDir, 'relatorios/2026-08.md'), 'utf8')).toBe('# antigo\n');
  });

  it('the closing row decides, even without the report file', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    rmSync(join(dataDir, 'relatorios/2026-09.md'));
    expect(closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx).alreadyClosed).toBe(true);
    expect(existsSync(join(dataDir, 'relatorios/2026-09.md'))).toBe(false);
  });

  it('a report that cannot be written leaves the month open', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    writeFileSync(join(dataDir, 'relatorios'), 'arquivo no lugar da pasta');
    expect(() => closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx)).toThrow();
    expect(getClosingStatus(db, '2026-09', FIXTURE_TODAY, dataDir).closed).toBeNull();
  });

  it('late transaction shows as drift', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    expect(closedMonthDrift(db, '2026-09', FIXTURE_TODAY, dataDir)).toBeNull();
    insertTestTx(db, makeTx({ id: 'late', accountId: 'c6-card', accountKind: 'credit_card', date: '2026-09-28', amountCents: -12000, description: 'PADARIA' }));
    insertTestClassification(db, makeClassification({ transactionId: 'late', categoryId: categoryIdByName(db, 'Padaria e café'), source: 'rule' }));
    expect(closedMonthDrift(db, '2026-09', FIXTURE_TODAY, dataDir)).toEqual({ incomeCents: 0, expenseCents: 12000 });
  });

  it('late review item goes to the next closing', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    insertTestTx(db, makeTx({ id: 'late', accountId: 'c6-card', accountKind: 'credit_card', date: '2026-09-29', amountCents: -7000, description: 'LOJA NOVA' }));
    insertTestClassification(db, makeClassification({ transactionId: 'late', reviewReason: 'uncategorized' }));
    const late = getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-10' }).review.find((g) => g.transactionIds.includes('late'));
    expect(late).toMatchObject({ lateFromMonth: '2026-09', merchantKey: 'LOJA NOVA' });
    expect(getPendingItems(db, { today: FIXTURE_TODAY, month: '2026-09' }).review).toEqual([]);
    expect(getClosingStatus(db, '2026-10', FIXTURE_TODAY, dataDir).reconciliation.reviewGroups).toBe(3);
  });

  it('report lists goals against actual', () => {
    const { db, dataDir } = setup();
    saveGoals(db, '2026-09', [{ categoryId: categoryIdByName(db, 'Alimentação'), cents: 5000, note: null }], null, ctx);
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    const report = readFileSync(join(dataDir, 'relatorios/2026-09.md'), 'utf8');
    expect(report).toMatch(/\| Alimentação \| R\$ 60,00 \| .* \| R\$ 50,00 \|/);
    expect(existsSync(join(dataDir, 'relatorios/2026-09.md'))).toBe(true);
  });

  it('closing stores the suggested goals of the next month when none were saved', () => {
    const { db, dataDir } = setup();
    confirmCheck(db, '2026-09', 'cash', ctx);
    const suggested = getGoalsBoard(db, '2026-09', FIXTURE_TODAY).rows.map((r) => ({ categoryId: r.categoryId, cents: r.suggestionCents }));
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    const saved = db.select().from(categoryGoals).all().map((g) => ({ month: g.month, categoryId: g.categoryId, cents: g.cents }));
    expect(saved).toEqual(suggested.map((g) => ({ month: '2026-10', ...g })));
    expect(saved.length).toBeGreaterThan(0);
  });

  it('closing keeps goals that were already saved', () => {
    const { db, dataDir } = setup();
    saveGoals(db, '2026-10', [{ categoryId: categoryIdByName(db, 'Casa'), cents: 1234, note: null }], null, ctx);
    confirmCheck(db, '2026-09', 'cash', ctx);
    closeMonth(db, '2026-09', dataDir, FIXTURE_TODAY, ctx);
    expect(db.select().from(categoryGoals).all().map((g) => g.cents)).toEqual([1234]);
  });
});
