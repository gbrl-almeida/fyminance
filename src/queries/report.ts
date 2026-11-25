import { eq } from 'drizzle-orm';
import { addMonths, monthName } from '../core/dates';
import { averageOverMonths } from '../core/goals';
import { formatBRL } from '../core/money';
import { savingsRate, summarizeMonth } from '../core/summary';
import type { Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { categoryGoals, planNoteLines, planNotes } from '../db/schema';
import { firstDataMonth } from './goals';
import { getUpcomingInstallments } from './installments';
import { getInvestments } from './investments';
import { getMonthSummary } from './month-summary';
import { getPendingItems } from './pending';
import { loadLedgerRows } from './rows';
import { OWNER_LABEL } from '../owner-labels';



export function formatPct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1).replace('.', ',')}%`;
}

/** Relatório do mês em markdown, gerado só dos dados (as observações do Claude entram depois). */
export function buildMonthReport(db: Db, month: string, today: string): string {
  const categories = loadCategories(db);
  const report = getMonthSummary(db, month, today);
  const previous = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const history = loadLedgerRows(db, { from: `${previous[0]}-01`, to: `${month}-01` });
  const first = firstDataMonth(db);
  const pastByParent = new Map<string, Map<string, number>>();
  for (const m of previous) {
    for (const total of summarizeMonth(history, categories, m).expenseByCategory) {
      const totals = pastByParent.get(total.name) ?? new Map<string, number>();
      totals.set(m, total.cents);
      pastByParent.set(total.name, totals);
    }
  }
  const goals = new Map(db.select().from(categoryGoals).where(eq(categoryGoals.month, month)).all().map((g) => [g.categoryId, g.cents]));
  const hasGoals = goals.size > 0;
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);

  push(`# Relatório de ${monthName(month)}`, '');
  push('## Resultado', '');
  push(`- Renda: ${formatBRL(report.incomeCents)}`);
  push(`- Gastos: ${formatBRL(report.expenseCents)}`);
  push(`- Sobra: ${formatBRL(report.surplusCents)}`);
  push(`- Taxa de poupança: ${formatPct(savingsRate(report.incomeCents, report.surplusCents))}`, '');

  push('## Gastos por categoria', '');
  push(hasGoals ? '| Categoria | Mês | Média dos 3 meses anteriores | Variação | Meta |' : '| Categoria | Mês | Média dos 3 meses anteriores | Variação |');
  push(hasGoals ? '|---|---|---|---|---|' : '|---|---|---|---|');
  for (const total of report.expenseByCategory) {
    const average = averageOverMonths(pastByParent.get(total.name) ?? new Map(), previous, first);
    const variation = total.cents - average;
    const goal = total.categoryId === null ? undefined : goals.get(total.categoryId);
    const cells = [total.name, formatBRL(total.cents), formatBRL(average), `${variation > 0 ? '+' : ''}${formatBRL(variation)}`];
    if (hasGoals) cells.push(goal === undefined ? '—' : formatBRL(goal));
    push(`| ${cells.join(' | ')} |`);
  }
  push('');

  push('## Gastos por dono', '');
  for (const [owner, cents] of Object.entries(report.expenseByOwner)) push(`- ${OWNER_LABEL[owner as keyof typeof OWNER_LABEL]}: ${formatBRL(cents)}`);
  push('');

  push('## Compras parceladas novas', '');
  if (report.newInstallmentPurchases.length === 0) push('Nenhuma.');
  for (const p of report.newInstallmentPurchases) {
    push(`- ${p.description}: ${p.installmentTotal} × ${formatBRL(p.installmentCents)} = ${formatBRL(p.totalCents)}`);
  }
  push('');

  const upcoming = getUpcomingInstallments(db, today);
  push('## Parcelas a vencer', '');
  push(`Total: ${formatBRL(upcoming.totalCents)}`, '');
  for (const m of upcoming.months.filter((x) => x.cents > 0)) push(`- ${monthName(m.month)}: ${formatBRL(m.cents)}`);
  push('');

  const investments = getInvestments(db, month, today);
  push('## Investimentos', '');
  push(`- Total investido: ${formatBRL(investments.totalCents)}`);
  push(`- Rendimento: ${investments.yieldCents === null ? 'indisponível' : `${formatBRL(investments.yieldCents)} (${formatPct(investments.yieldPct)})`}`);
  const redeemed = investments.redemptions.month;
  if (redeemed.count > 0) {
    const taxes = redeemed.unsplit > 0 ? `imposto ${formatBRL(redeemed.taxCents)}` : `IOF ${formatBRL(redeemed.iofCents)} e IR ${formatBRL(redeemed.irCents)}`;
    push(
      `- Rendimento dos resgates: ${formatBRL(redeemed.netCents)} líquido (bruto ${formatBRL(redeemed.grossCents)}; ${taxes}, ${formatPct(redeemed.taxPct)} de imposto)`,
    );
  }
  push(
    `- Aportes: ${formatBRL(investments.contributedCents)}${investments.goalCents === null ? ' (sem meta)' : ` de ${formatBRL(investments.goalCents)} da meta`}`,
    '',
  );

  const notes = db.select().from(planNotes).where(eq(planNotes.month, month)).all();
  if (notes.length > 0) {
    push('## Anotações do mês', '');
    const name = new Map(categories.map((c) => [c.id, c.name]));
    for (const note of notes) {
      const deltas = db
        .select()
        .from(planNoteLines)
        .where(eq(planNoteLines.noteId, note.id))
        .all()
        .map((l) => `${name.get(l.categoryId) ?? `#${l.categoryId}`} ${l.deltaCents > 0 ? '+' : ''}${formatBRL(l.deltaCents)}`);
      push(`- ${note.title}: ${deltas.join(', ')}`);
    }
    push('');
  }

  const pending = getPendingItems(db, { today, month });
  const explained = [...pending.billDivergences, ...pending.balanceDivergences].filter((d) => d.explanation !== null);
  push('## Divergências explicadas', '');
  if (explained.length === 0) push('Nenhuma.');
  for (const d of explained) push(`- ${d.account}: diferença de ${formatBRL(d.diffCents)}. ${d.explanation?.note || 'Conferida, sem nota.'}`);
  push('');

  return `${lines.join('\n').trimEnd()}\n`;
}
