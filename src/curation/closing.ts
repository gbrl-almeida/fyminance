import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { addMonths, monthName } from '../core/dates';
import { summarizeMonth } from '../core/summary';
import type { Actor, CheckKey } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { categoryGoals, monthChecks, monthClosings } from '../db/schema';
import { closingRecord, getClosingStatus, monthRows } from '../queries/closing';
import { getGoalsBoard } from '../queries/goals';
import { buildMonthReport } from '../queries/report';
import { writeAudit } from './audit';
import { saveReport } from './documents';

type Ctx = { now: () => Date; actor: Actor };

export function confirmCheck(db: Db, month: string, key: CheckKey, ctx: Ctx, note?: string): void {
  const nowIso = ctx.now().toISOString();
  const values = { month, key, doneAt: nowIso, doneBy: ctx.actor, note: note?.trim() || null };
  db.insert(monthChecks).values(values).onConflictDoUpdate({ target: [monthChecks.month, monthChecks.key], set: values }).run();
  writeAudit(db, 'confirm_check', { month, key, note: values.note }, nowIso, ctx.actor);
}

export function undoCheck(db: Db, month: string, key: CheckKey, ctx: Ctx): void {
  db.delete(monthChecks).where(and(eq(monthChecks.month, month), eq(monthChecks.key, key))).run();
  writeAudit(db, 'undo_check', { month, key }, ctx.now().toISOString(), ctx.actor);
}

/**
 * Fecha o mês: confere a conciliação, grava o registro e o relatório numa transação só. Fechar de novo,
 * ou ao mesmo tempo pelo app e pelo Claude, não regrava nada.
 */
export function closeMonth(db: Db, month: string, dataDir: string, today: string, ctx: Ctx): { reportPath: string; alreadyClosed: boolean } {
  return db.$client
    .transaction(() => {
      if (closingRecord(db, month) !== null) return { reportPath: `relatorios/${month}.md`, alreadyClosed: true };
      if (!getClosingStatus(db, month, today, dataDir).reconciliation.complete) {
        throw new Error(`A conciliação de ${monthName(month)} ainda não terminou.`);
      }
      const nowIso = ctx.now().toISOString();
      const summary = summarizeMonth(monthRows(db, month), loadCategories(db), month);
      const reportPath = `relatorios/${month}.md`;
      db.insert(monthClosings)
        .values({ month, closedAt: nowIso, closedBy: ctx.actor, reportPath, incomeCents: summary.incomeCents, expenseCents: summary.expenseCents })
        .run();
      writeAudit(db, 'close_month', { month, reportPath }, nowIso, ctx.actor);
      // Sem metas salvas para o mês seguinte, as sugestões viram as metas (spec 7.5).
      const targetMonth = addMonths(month, 1);
      if (db.select().from(categoryGoals).where(eq(categoryGoals.month, targetMonth)).all().length === 0) {
        for (const row of getGoalsBoard(db, month, today).rows) {
          db.insert(categoryGoals).values({ month: targetMonth, categoryId: row.categoryId, cents: row.suggestionCents, note: row.noteFromPlan }).run();
        }
      }
      // O arquivo é gravado por último: se falhar, a transação desfaz o registro e o mês continua aberto.
      saveReport(dataDir, month, buildMonthReport(db, month, today));
      return { reportPath, alreadyClosed: false };
    })
    .immediate();
}

/** Relatórios salvos antes da 1b (pelo /fechar-mes) viram meses fechados. Devolve os meses registrados agora. */
export function backfillLegacyClosings(db: Db, dataDir: string, nowIso: string): string[] {
  const dir = join(dataDir, 'relatorios');
  if (!existsSync(dir)) return [];
  const added: string[] = [];
  inTransaction(db, () => {
    for (const name of readdirSync(dir).sort()) {
      const match = /^(\d{4}-\d{2})\.md$/.exec(name);
      if (match === null) continue;
      const month = match[1] as string;
      if (closingRecord(db, month) !== null) continue;
      db.insert(monthClosings)
        .values({ month, closedAt: statSync(join(dir, name)).mtime.toISOString(), closedBy: 'anterior', reportPath: `relatorios/${name}` })
        .run();
      added.push(month);
    }
    if (added.length > 0) writeAudit(db, 'backfill_closings', { months: added }, nowIso, 'pessoa1');
  });
  return added;
}
