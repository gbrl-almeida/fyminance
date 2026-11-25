import { desc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { syncRuns } from '../db/schema';
import { getBalances } from '../queries/balances';
import { getPendingItems } from '../queries/pending';

export function formatStatus(db: Db, today: string): string {
  const runs = db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(5).all();
  const pending = getPendingItems(db, { today });
  const { connections } = getBalances(db, today);

  const lines = ['Últimas sincronizações:'];
  if (runs.length === 0) lines.push('  nenhuma ainda');
  for (const run of runs) {
    const when = new Date(run.startedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    lines.push(`  #${run.id} ${when} ${run.status}`);
  }

  lines.push('', 'Conexões:');
  if (connections.length === 0) lines.push('  nenhuma ainda');
  for (const c of connections) {
    lines.push(`  ${c.institution} (${c.owner}): ${c.problems.length === 0 ? 'ok' : c.problems.join(' ')}`);
  }

  const reviewCount = pending.review.reduce((sum, group) => sum + group.count, 0);
  lines.push(
    '',
    'Pendências:',
    `  revisão: ${reviewCount} transações em ${pending.review.length} grupos`,
    `  divergências de saldo: ${pending.balanceDivergences.length}`,
    `  divergências de fatura: ${pending.billDivergences.length}`,
    `  lançamentos que sumiram do banco: ${pending.missingPosted.length}`,
  );
  return lines.join('\n');
}
