'use server';

import { revalidatePath } from 'next/cache';
import { addMonths } from '../../../core/dates';
import { parseBRL } from '../../../core/money';
import type { CheckKey, Owner } from '../../../core/types';
import { categorize } from '../../../curation/categorize';
import { setCountsAsInvestment } from '../../../curation/accounts';
import { closeMonth, confirmCheck, undoCheck } from '../../../curation/closing';
import { explainDivergence } from '../../../curation/divergences';
import { deletePlanNote, saveGoals, saveInvestmentGoal, savePlanNote } from '../../../curation/goals';
import { createManualEntry, deleteManualEntry, setVoucherSpend } from '../../../curation/manual';
import { curationContext, requireUser } from '../../../web/server/auth';
import { getAppContext } from '../../../web/server/context';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function run(path: string, work: (ctx: ReturnType<typeof curationContext>) => Promise<string | void> | string | void): Promise<ActionResult> {
  const user = await requireUser(path);
  try {
    const message = await work(curationContext(user));
    revalidatePath('/', 'layout');
    return message === undefined ? { ok: true } : { ok: true, message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const db = () => getAppContext().db;

/** Salva a decisão de uma linha da revisão; `replaces` desfaz a que a mesma linha salvou antes. */
export async function saveReviewDecision(
  path: string,
  input: { transactionIds: string[]; categoryId: number; owner: Owner; scope: 'rule' | 'only_these'; replaces?: { ruleId: number | null } },
): Promise<ActionResult & { ruleId?: number | null }> {
  let ruleId: number | null = null;
  const result = await run(path, async (ctx) => {
    ({ ruleId } = await categorize(
      db(),
      { target: { transactionIds: input.transactionIds }, categoryId: input.categoryId, owner: input.owner, scope: input.scope, replaces: input.replaces },
      ctx,
    ));
  });
  return result.ok ? { ...result, ruleId } : result;
}

export async function confirmSuggestions(
  path: string,
  groups: Array<{ transactionIds: string[]; categoryId: number; owner: Owner; scope: 'rule' | 'only_these' }>,
): Promise<ActionResult> {
  return run(path, async (ctx) => {
    for (const group of groups) {
      await categorize(db(), { target: { transactionIds: group.transactionIds }, categoryId: group.categoryId, owner: group.owner, scope: group.scope }, ctx);
    }
    return `${groups.length} ${groups.length === 1 ? 'sugestão confirmada' : 'sugestões confirmadas'}.`;
  });
}

export async function explain(path: string, key: string, note: string): Promise<ActionResult> {
  return run(path, (ctx) => explainDivergence(db(), key, note, ctx));
}

export async function addManualEntry(
  path: string,
  input: { accountId?: string; billId?: string; date: string; value: string; description: string; nature: 'expense' | 'income'; categoryId: number; owner: Owner },
): Promise<ActionResult> {
  return run(path, async (ctx) => {
    const { value, ...rest } = input;
    await createManualEntry(db(), { ...rest, amountCents: parseBRL(value) }, ctx);
    return 'Lançado.';
  });
}

export async function removeManualEntry(path: string, id: string): Promise<ActionResult> {
  return run(path, (ctx) => deleteManualEntry(db(), id, ctx));
}

export async function setFlash(path: string, month: string, value: string): Promise<ActionResult> {
  return run(path, (ctx) => setVoucherSpend(db(), month, parseBRL(value), ctx));
}

export async function setCheck(path: string, month: string, key: CheckKey, done: boolean): Promise<ActionResult> {
  return run(path, (ctx) => (done ? confirmCheck(db(), month, key, ctx) : undoCheck(db(), month, key, ctx)));
}

export async function saveGoalsAction(
  path: string,
  targetMonth: string,
  goals: Array<{ categoryId: number; value: string; note: string }>,
  expectedIncome: string | null,
): Promise<ActionResult> {
  return run(path, (ctx) => {
    saveGoals(
      db(),
      targetMonth,
      goals.map((g) => ({ categoryId: g.categoryId, cents: parseBRL(g.value), note: g.note.trim() || null })),
      expectedIncome === null || expectedIncome.trim() === '' ? null : parseBRL(expectedIncome),
      ctx,
    );
    return 'Metas salvas.';
  });
}

export async function upsertNote(
  path: string,
  input: { id?: number; month: string; title: string; lines: Array<{ categoryId: number; sign: 1 | -1; value: string }> },
): Promise<ActionResult> {
  return run(path, (ctx) => {
    savePlanNote(
      db(),
      {
        ...(input.id === undefined ? {} : { id: input.id }),
        month: input.month,
        title: input.title,
        lines: input.lines.map((l) => ({ categoryId: l.categoryId, deltaCents: l.sign * parseBRL(l.value) })),
      },
      ctx,
    );
    return 'Anotação salva.';
  });
}

export async function removeNote(path: string, id: number): Promise<ActionResult> {
  return run(path, (ctx) => deletePlanNote(db(), id, ctx));
}

export async function setInvestmentFlag(path: string, accountId: string, counts: boolean): Promise<ActionResult> {
  return run(path, (ctx) => setCountsAsInvestment(db(), accountId, counts, ctx));
}

/** Fecha o mês: grava a meta de aporte digitada, fecha (relatório e metas do mês seguinte) e marca o passo. */
export async function finishMonth(path: string, month: string, nextInvestmentGoal: string): Promise<ActionResult> {
  return run(path, (ctx) => {
    const app = getAppContext();
    if (nextInvestmentGoal.trim() !== '') saveInvestmentGoal(app.db, addMonths(month, 1), parseBRL(nextInvestmentGoal), ctx);
    const result = closeMonth(app.db, month, app.dataDir, app.today(), ctx);
    confirmCheck(app.db, month, 'investments', ctx);
    return result.alreadyClosed ? 'Este mês já estava fechado.' : 'Mês fechado.';
  });
}
