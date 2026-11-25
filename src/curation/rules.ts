import { eq } from 'drizzle-orm';
import { ruleMatches } from '../core/rules';
import type { Direction, Nature, Owner, Rule } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories, loadRules, loadTxs } from '../db/ledger';
import { rules } from '../db/schema';
import { writeAudit } from './audit';
import { categoryNature, refresh, type CurationContext } from './context';

export interface RuleInput {
  id?: number;
  merchantKey?: string | null;
  cardLast4?: string | null;
  accountId?: string | null;
  minCents?: number | null;
  maxCents?: number | null;
  direction?: Direction | null;
  setNature?: Nature | null;
  setCategoryId?: number | null;
  setOwner?: Owner | null;
}

export interface RuleView extends Rule {
  origin: 'user' | 'learned';
  categoryPath: string | null;
  matches: number;
}

export async function saveRule(db: Db, input: RuleInput, ctx: CurationContext): Promise<{ id: number }> {
  const conditions = {
    merchantKey: input.merchantKey ?? null,
    cardLast4: input.cardLast4 ?? null,
    accountId: input.accountId ?? null,
    minCents: input.minCents ?? null,
    maxCents: input.maxCents ?? null,
    direction: input.direction ?? null,
  };
  if (Object.values(conditions).every((value) => value === null)) {
    throw new Error('Uma regra precisa de pelo menos uma condição.');
  }
  if (conditions.minCents !== null && conditions.maxCents !== null && conditions.minCents > conditions.maxCents) {
    throw new Error('minCents maior que maxCents.');
  }
  const setCategoryId = input.setCategoryId ?? null;
  const setOwner = input.setOwner ?? null;
  let setNature = input.setNature ?? null;
  if (setNature === null && setCategoryId === null && setOwner === null) {
    throw new Error('Uma regra precisa definir natureza, categoria ou dono.');
  }
  if (setCategoryId !== null) {
    if (setNature === 'transfer') throw new Error('Transferência não leva categoria.');
    const categoryKindNature = categoryNature(db, setCategoryId);
    if (setNature !== null && setNature !== categoryKindNature) {
      throw new Error('A natureza não combina com o tipo da categoria.');
    }
    setNature = categoryKindNature;
  }

  const values = { ...conditions, setNature, setCategoryId, setOwner };
  const nowIso = ctx.now().toISOString();
  let id: number;
  if (input.id === undefined) {
    id = db.insert(rules).values({ ...values, origin: 'user', createdAt: nowIso }).returning({ id: rules.id }).get().id;
  } else {
    if (db.select({ id: rules.id }).from(rules).where(eq(rules.id, input.id)).get() === undefined) {
      throw new Error(`Regra ${input.id} não existe.`);
    }
    db.update(rules).set(values).where(eq(rules.id, input.id)).run();
    id = input.id;
  }
  writeAudit(db, 'save_rule', { id, ...values }, nowIso, ctx.actor);
  await refresh(db, ctx);
  return { id };
}

export async function deleteRule(db: Db, id: number, ctx: CurationContext): Promise<void> {
  const existing = db.select().from(rules).where(eq(rules.id, id)).get();
  if (existing === undefined) throw new Error(`Regra ${id} não existe.`);
  db.delete(rules).where(eq(rules.id, id)).run();
  writeAudit(db, 'delete_rule', existing, ctx.now().toISOString(), ctx.actor);
  await refresh(db, ctx);
}

export function listRules(db: Db): RuleView[] {
  const list = loadCategories(db);
  const txs = loadTxs(db).filter((tx) => tx.status !== 'removed');
  const origins = new Map(db.select({ id: rules.id, origin: rules.origin }).from(rules).all().map((r) => [r.id, r.origin]));
  return loadRules(db).map((rule) => ({
    ...rule,
    origin: origins.get(rule.id) ?? 'user',
    categoryPath: rule.setCategoryId === null ? null : categoryPath(list, rule.setCategoryId),
    matches: txs.filter((tx) => ruleMatches(rule, tx)).length,
  }));
}
