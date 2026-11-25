import type { Actor } from '../core/types';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export function writeAudit(db: Db, action: string, payload: object, nowIso: string, actor: Actor): void {
  db.insert(auditLog).values({ at: nowIso, action, payload: JSON.stringify({ actor, ...payload }) }).run();
}
