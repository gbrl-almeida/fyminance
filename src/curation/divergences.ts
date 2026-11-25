import type { Actor } from '../core/types';
import type { Db } from '../db/client';
import { divergenceNotes } from '../db/schema';
import { writeAudit } from './audit';

/** Marca uma divergência das conferências como explicada; explicar de novo substitui a nota. */
export function explainDivergence(db: Db, key: string, note: string, ctx: { now: () => Date; actor: Actor }): void {
  if (!/^(bill|balance):.+/.test(key)) throw new Error(`Divergência desconhecida: ${key}`);
  const nowIso = ctx.now().toISOString();
  const values = { key, note: note.trim(), explainedAt: nowIso, explainedBy: ctx.actor };
  db.insert(divergenceNotes).values(values).onConflictDoUpdate({ target: divergenceNotes.key, set: values }).run();
  writeAudit(db, 'explain_divergence', { key, note: values.note }, nowIso, ctx.actor);
}
