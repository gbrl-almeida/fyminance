import { and, eq, inArray } from 'drizzle-orm';
import { isPixBetweenPersons } from '../core/nature';
import type { Classification, Direction, Owner, Tx } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { loadClassifications, loadTxs } from '../db/ledger';
import { classifications, rules } from '../db/schema';
import { writeAudit } from './audit';
import { categoryNature, refresh, type CurationContext } from './context';

export type CategorizeTarget = { transactionIds: string[] } | { merchantKey: string };

export interface CategorizeInput {
  target: CategorizeTarget;
  categoryId?: number;
  owner?: Owner;
  scope: 'rule' | 'only_these';
  /**
   * A decisão refaz outra tomada há pouco nas mesmas transações (a revisão salva a cada mudança):
   * a regra que a anterior criou sai, e as transações deixam de ter a decisão manual dela.
   */
  replaces?: { ruleId: number | null };
}

export interface CategorizeResult {
  ruleId: number | null;
  affected: number;
}

const MISSING = 'Alguma transação informada não existe ou foi removida.';

const MIXED_PIX =
  'As transações vão nos dois sentidos (enviadas e recebidas) com uma pessoa. Crie uma regra para cada sentido ou use "only_these".';

const directionOf = (tx: Tx): Direction => (tx.amountCents >= 0 ? 'in' : 'out');

// Compra e estorno no mesmo estabelecimento podem dividir uma regra sem sentido; Pix com uma pessoa não,
// porque o Pix recebido dela significa outra coisa.
function directionFor(matched: readonly Tx[]): Direction | null {
  const directions = new Set(matched.map(directionOf));
  if (directions.size === 1) return [...directions][0] as Direction;
  if (matched.some(isPixBetweenPersons)) throw new Error(MIXED_PIX);
  return null;
}

function selectByIds(txs: readonly Tx[], ids: readonly string[]): Tx[] {
  const wanted = new Set(ids);
  const selected = txs.filter((tx) => wanted.has(tx.id));
  if (selected.length !== wanted.size) throw new Error(MISSING);
  return selected;
}

function ruleTarget(txs: readonly Tx[], target: CategorizeTarget): { merchantKey: string; direction: Direction | null; affected: number } {
  if ('merchantKey' in target) {
    const matched = txs.filter((tx) => tx.merchantKey === target.merchantKey);
    if (matched.length === 0) throw new Error(`Nenhuma transação com o estabelecimento "${target.merchantKey}".`);
    return { merchantKey: target.merchantKey, direction: directionFor(matched), affected: matched.length };
  }
  const selected = selectByIds(txs, target.transactionIds);
  const keys = new Set(selected.map((tx) => tx.merchantKey));
  if (keys.size !== 1) throw new Error('Para criar regra, as transações precisam ser do mesmo estabelecimento.');
  const merchantKey = [...keys][0] as string;
  const direction = directionFor(selected);
  const affected = txs.filter((tx) => tx.merchantKey === merchantKey && (direction === null || directionOf(tx) === direction)).length;
  return { merchantKey, direction, affected };
}

export async function categorize(db: Db, input: CategorizeInput, ctx: CurationContext): Promise<CategorizeResult> {
  if (input.categoryId === undefined && input.owner === undefined) throw new Error('Informe categoryId, owner ou ambos.');
  const nature = input.categoryId === undefined ? null : categoryNature(db, input.categoryId);
  const txs = loadTxs(db).filter((tx) => tx.status !== 'removed');
  const nowIso = ctx.now().toISOString();
  let ruleId: number | null = null;
  let affected: number;

  // Valida antes de desfazer a decisão anterior, para um erro não deixar as transações sem nenhuma.
  if (input.scope === 'only_these' && !('transactionIds' in input.target)) throw new Error('"only_these" exige transactionIds.');
  const target = input.scope === 'rule' ? ruleTarget(txs, input.target) : null;
  const selected = 'transactionIds' in input.target && input.scope === 'only_these' ? selectByIds(txs, input.target.transactionIds) : [];

  const { replaces } = input;
  if (replaces !== undefined) {
    const ids = 'transactionIds' in input.target ? input.target.transactionIds : [];
    inTransaction(db, () => {
      if (replaces.ruleId !== null) db.delete(rules).where(and(eq(rules.id, replaces.ruleId), eq(rules.origin, 'learned'))).run();
      if (ids.length > 0) db.delete(classifications).where(and(inArray(classifications.transactionId, ids), eq(classifications.source, 'manual'))).run();
    });
  }

  if (target !== null) {
    ruleId = db
      .insert(rules)
      .values({
        merchantKey: target.merchantKey,
        direction: target.direction,
        setNature: nature,
        setCategoryId: input.categoryId ?? null,
        setOwner: input.owner ?? null,
        origin: 'learned',
        createdAt: nowIso,
      })
      .returning({ id: rules.id })
      .get().id;
    affected = target.affected;
  } else {
    const existing = loadClassifications(db);
    inTransaction(db, () => {
      for (const tx of selected) {
        const current = existing.get(tx.id);
        const keepNature = nature === null;
        const next: Classification = {
          transactionId: tx.id,
          nature: nature ?? current?.nature ?? (tx.amountCents > 0 ? 'income' : 'expense'),
          transferKind: keepNature ? (current?.transferKind ?? null) : null,
          transferPairId: keepNature ? (current?.transferPairId ?? null) : null,
          categoryId: input.categoryId ?? current?.categoryId ?? null,
          owner: input.owner ?? current?.owner ?? 'casal',
          source: 'manual',
          ruleId: null,
          model: null,
          confidence: null,
          purchaseGroup: current?.purchaseGroup ?? null,
          reviewReason: null,
        };
        const values = { ...next, updatedAt: nowIso };
        db.insert(classifications).values(values).onConflictDoUpdate({ target: classifications.transactionId, set: values }).run();
      }
    });
    affected = selected.length;
  }

  writeAudit(db, 'categorize', { ...input, ruleId }, nowIso, ctx.actor);
  await refresh(db, ctx);
  return { ruleId, affected };
}
