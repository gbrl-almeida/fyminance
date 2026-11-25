import { asc, eq } from 'drizzle-orm';
import { addMonths, lastDayOfMonth, monthOf } from '../core/dates';
import { averageOverMonths, installmentsDueIn, suggestGoal } from '../core/goals';
import { buildPurchaseGroups } from '../core/installments';
import type { Holder } from '../core/types';
import type { Db } from '../db/client';
import { loadCategories, loadTxs } from '../db/ledger';
import { categoryGoals, monthPlans, planNoteLines, planNotes } from '../db/schema';
import { loadLedgerRows } from './rows';

export interface GoalRow {
  categoryId: number;
  name: string;
  averageCents: number;
  closingMonthCents: number;
  suggestionCents: number;
  goalCents: number | null;
  note: string | null;
  noteFromPlan: string | null;
}

export interface PlanNoteView {
  id: number;
  title: string;
  createdBy: Holder | null;
  lines: Array<{ categoryId: number; name: string; deltaCents: number }>;
}

export interface GoalsBoard {
  closingMonth: string;
  targetMonth: string;
  rows: GoalRow[];
  notes: PlanNoteView[];
  expectedIncomeCents: number;
  expectedIncomeIsDefault: boolean;
  goalsTotalCents: number;
  shouldRemainCents: number;
  committed: { installmentsCents: number; fixedCents: number; subscriptionsCents: number; totalCents: number };
}

/** Primeiro mês com algum lançamento no livro; base do divisor das médias. */
export function firstDataMonth(db: Db): string | null {
  const first = loadTxs(db).find((tx) => tx.status !== 'removed');
  return first === undefined ? null : monthOf(first.date);
}

/** Os 3 meses que terminam em `lastMonth`, do mais antigo ao mais novo. */
export function threeMonthsEndingAt(lastMonth: string): string[] {
  return [addMonths(lastMonth, -2), addMonths(lastMonth, -1), lastMonth];
}

export function getGoalsBoard(db: Db, closingMonth: string, today: string): GoalsBoard {
  const targetMonth = addMonths(closingMonth, 1);
  const months = threeMonthsEndingAt(closingMonth);
  const list = loadCategories(db);
  const byId = new Map(list.map((c) => [c.id, c]));
  const parentOf = (id: number) => byId.get(id)?.parentId ?? id;
  const first = firstDataMonth(db);

  const expenseByParent = new Map<number, Map<string, number>>();
  const incomeByMonth = new Map<string, number>();
  for (const { tx, cls } of loadLedgerRows(db, { from: `${months[0]}-01`, to: lastDayOfMonth(closingMonth) })) {
    if (cls === null) continue;
    const month = monthOf(tx.date);
    if (cls.nature === 'income') incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + tx.amountCents);
    if (cls.nature !== 'expense' || cls.categoryId === null) continue;
    const parent = parentOf(cls.categoryId);
    const totals = expenseByParent.get(parent) ?? new Map<string, number>();
    totals.set(month, (totals.get(month) ?? 0) - tx.amountCents);
    expenseByParent.set(parent, totals);
  }

  const notes: PlanNoteView[] = db
    .select()
    .from(planNotes)
    .where(eq(planNotes.month, targetMonth))
    .orderBy(asc(planNotes.id))
    .all()
    .map((note) => ({
      id: note.id,
      title: note.title,
      createdBy: note.createdBy === 'claude' ? null : (note.createdBy as Holder),
      lines: db
        .select()
        .from(planNoteLines)
        .where(eq(planNoteLines.noteId, note.id))
        .orderBy(asc(planNoteLines.id))
        .all()
        .map((line) => ({ categoryId: line.categoryId, name: byId.get(line.categoryId)?.name ?? `#${line.categoryId}`, deltaCents: line.deltaCents })),
    }));
  const saved = new Map(db.select().from(categoryGoals).where(eq(categoryGoals.month, targetMonth)).all().map((g) => [g.categoryId, g]));

  const rows: GoalRow[] = list
    .filter((c) => c.kind === 'expense' && c.parentId === null && !c.archived)
    .filter((c) => expenseByParent.has(c.id) || saved.has(c.id) || notes.some((n) => n.lines.some((l) => l.categoryId === c.id)))
    .map((c) => {
      const totals = expenseByParent.get(c.id) ?? new Map<string, number>();
      const averageCents = averageOverMonths(totals, months, first);
      const related = notes.filter((n) => n.lines.some((l) => l.categoryId === c.id));
      const deltas = related.flatMap((n) => n.lines.filter((l) => l.categoryId === c.id).map((l) => l.deltaCents));
      const goal = saved.get(c.id);
      return {
        categoryId: c.id,
        name: c.name,
        averageCents,
        closingMonthCents: totals.get(closingMonth) ?? 0,
        suggestionCents: suggestGoal(averageCents, deltas),
        goalCents: goal?.cents ?? null,
        note: goal?.note ?? null,
        noteFromPlan: related.length === 0 ? null : related.map((n) => n.title).join('; '),
      };
    })
    .sort((a, b) => b.suggestionCents - a.suggestionCents);

  const plan = db.select().from(monthPlans).where(eq(monthPlans.month, targetMonth)).get();
  const savedIncome = plan?.expectedIncomeCents ?? null;
  const expectedIncomeCents = savedIncome ?? averageOverMonths(incomeByMonth, months, first);
  const goalsTotalCents = rows.reduce((sum, r) => sum + (r.goalCents ?? r.suggestionCents), 0);

  const spentIn = (name: string) => {
    const category = list.find((c) => c.name === name && c.kind === 'expense' && c.parentId === null);
    return category === undefined ? 0 : (expenseByParent.get(category.id)?.get(closingMonth) ?? 0);
  };
  const installmentsCents = installmentsDueIn(buildPurchaseGroups(loadTxs(db), today), targetMonth);
  const fixedCents = spentIn('Moradia');
  const subscriptionsCents = spentIn('Assinaturas');

  return {
    closingMonth,
    targetMonth,
    rows,
    notes,
    expectedIncomeCents,
    expectedIncomeIsDefault: savedIncome === null,
    goalsTotalCents,
    shouldRemainCents: expectedIncomeCents - goalsTotalCents,
    committed: { installmentsCents, fixedCents, subscriptionsCents, totalCents: installmentsCents + fixedCents + subscriptionsCents },
  };
}
