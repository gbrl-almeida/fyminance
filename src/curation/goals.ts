import { eq } from 'drizzle-orm';
import { addMonths } from '../core/dates';
import type { Actor } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { categories, categoryGoals, monthChecks, monthPlans, planNoteLines, planNotes } from '../db/schema';
import { writeAudit } from './audit';

type Ctx = { now: () => Date; actor: Actor };

const TOP_LEVEL_ONLY = 'Metas só valem para categorias de gasto do primeiro nível.';

function requireGoalCategory(db: Db, categoryId: number): void {
  const category = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (category === undefined || category.kind !== 'expense' || category.parentId !== null || category.archived) {
    throw new Error(TOP_LEVEL_ONLY);
  }
}

function requireCents(cents: number, allowNegative = false): void {
  if (!Number.isInteger(cents) || (!allowNegative && cents < 0)) throw new Error('Valor inválido.');
}

function upsertPlan(db: Db, month: string, fields: { expectedIncomeCents?: number | null; investmentGoalCents?: number | null }, ctx: Ctx, nowIso: string): void {
  const set = { ...fields, updatedAt: nowIso, updatedBy: ctx.actor };
  db.insert(monthPlans).values({ month, ...set }).onConflictDoUpdate({ target: monthPlans.month, set }).run();
}

/** Substitui as metas do mês-alvo e marca o passo de metas do mês que fecha. */
export function saveGoals(
  db: Db,
  targetMonth: string,
  goals: ReadonlyArray<{ categoryId: number; cents: number; note: string | null }>,
  expectedIncomeCents: number | null,
  ctx: Ctx,
): void {
  for (const goal of goals) {
    requireGoalCategory(db, goal.categoryId);
    requireCents(goal.cents);
  }
  if (expectedIncomeCents !== null) requireCents(expectedIncomeCents);
  const nowIso = ctx.now().toISOString();
  const closingMonth = addMonths(targetMonth, -1);
  inTransaction(db, () => {
    db.delete(categoryGoals).where(eq(categoryGoals.month, targetMonth)).run();
    for (const goal of goals) {
      const note = goal.note?.trim() || null;
      db.insert(categoryGoals).values({ month: targetMonth, categoryId: goal.categoryId, cents: goal.cents, note }).run();
    }
    upsertPlan(db, targetMonth, { expectedIncomeCents }, ctx, nowIso);
    const check = { month: closingMonth, key: 'goals' as const, doneAt: nowIso, doneBy: ctx.actor, note: null };
    db.insert(monthChecks).values(check).onConflictDoUpdate({ target: [monthChecks.month, monthChecks.key], set: check }).run();
    writeAudit(db, 'save_goals', { targetMonth, goals, expectedIncomeCents }, nowIso, ctx.actor);
  });
}

export function savePlanNote(
  db: Db,
  input: { id?: number; month: string; title: string; lines: ReadonlyArray<{ categoryId: number; deltaCents: number }> },
  ctx: Ctx,
): { id: number } {
  const title = input.title.trim();
  if (title === '') throw new Error('Dê um título para a anotação.');
  if (input.lines.length === 0) throw new Error('A anotação precisa de ao menos uma categoria.');
  for (const line of input.lines) {
    requireGoalCategory(db, line.categoryId);
    requireCents(line.deltaCents, true);
  }
  const nowIso = ctx.now().toISOString();
  return inTransaction(db, () => {
    let id = input.id;
    if (id === undefined) {
      id = db.insert(planNotes).values({ month: input.month, title, createdBy: ctx.actor, createdAt: nowIso }).returning({ id: planNotes.id }).get().id;
    } else {
      const changed = db.update(planNotes).set({ month: input.month, title }).where(eq(planNotes.id, id)).run();
      if (changed.changes === 0) throw new Error('Anotação não encontrada.');
      db.delete(planNoteLines).where(eq(planNoteLines.noteId, id)).run();
    }
    for (const line of input.lines) db.insert(planNoteLines).values({ noteId: id, ...line }).run();
    writeAudit(db, 'save_plan_note', { id, ...input, title }, nowIso, ctx.actor);
    return { id };
  });
}

export function deletePlanNote(db: Db, id: number, ctx: Ctx): void {
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    db.delete(planNoteLines).where(eq(planNoteLines.noteId, id)).run();
    db.delete(planNotes).where(eq(planNotes.id, id)).run();
    writeAudit(db, 'delete_plan_note', { id }, nowIso, ctx.actor);
  });
}

export function saveInvestmentGoal(db: Db, targetMonth: string, cents: number | null, ctx: Ctx): void {
  if (cents !== null) requireCents(cents);
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    upsertPlan(db, targetMonth, { investmentGoalCents: cents }, ctx, nowIso);
    writeAudit(db, 'save_investment_goal', { targetMonth, cents }, nowIso, ctx.actor);
  });
}
