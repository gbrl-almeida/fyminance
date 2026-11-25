import { and, eq, inArray } from 'drizzle-orm';
import { purchaseCapacityCents, purchaseUnitKey } from '../core/adjustments';
import { formatBRL } from '../core/money';
import type { Classification, Owner, Tx } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { loadClassifications, loadTxs } from '../db/ledger';
import { classifications, offsets, transactionNotes, transactionSplits } from '../db/schema';
import { writeAudit } from './audit';
import { categoryNature, type CurationContext } from './context';

const NOTE_LIMIT = 500;

function findTx(txs: readonly Tx[], id: string): Tx {
  const tx = txs.find((t) => t.id === id && t.status !== 'removed');
  if (tx === undefined) throw new Error(`A transação ${id} não existe ou foi removida.`);
  return tx;
}

function saveManual(db: Db, current: Classification | undefined, tx: Tx, patch: Pick<Classification, 'categoryId' | 'owner'>, nowIso: string): void {
  const values = {
    transactionId: tx.id,
    nature: 'expense' as const,
    transferKind: null,
    transferPairId: null,
    categoryId: patch.categoryId,
    owner: patch.owner,
    source: 'manual' as const,
    ruleId: null,
    model: null,
    confidence: null,
    purchaseGroup: current?.purchaseGroup ?? null,
    reviewReason: null,
    updatedAt: nowIso,
  };
  db.insert(classifications).values(values).onConflictDoUpdate({ target: classifications.transactionId, set: values }).run();
}

/** Anota do que se trata a transação. Texto vazio apaga a anotação. */
export async function annotate(db: Db, input: { transactionId: string; note: string }, ctx: CurationContext): Promise<void> {
  findTx(loadTxs(db), input.transactionId);
  const note = input.note.trim();
  if (note.length > NOTE_LIMIT) throw new Error(`A anotação pode ter até ${NOTE_LIMIT} caracteres.`);
  const nowIso = ctx.now().toISOString();
  if (note === '') {
    db.delete(transactionNotes).where(eq(transactionNotes.transactionId, input.transactionId)).run();
  } else {
    const values = { transactionId: input.transactionId, note, updatedBy: ctx.actor, updatedAt: nowIso };
    db.insert(transactionNotes).values(values).onConflictDoUpdate({ target: transactionNotes.transactionId, set: values }).run();
  }
  writeAudit(db, 'annotate', { transactionId: input.transactionId, note }, nowIso, ctx.actor);
}

export interface SplitInput {
  transactionId: string;
  /** Lista vazia desfaz a divisão. */
  parts: Array<{ amountCents: number; categoryId: number; owner: Owner }>;
}

/**
 * Divide uma saída em partes com categoria e dono. Numa compra parcelada, a divisão vale para todas as
 * parcelas; a compra (e as parcelas já lançadas) fica com a categoria e o dono da maior parte.
 */
export async function splitTransaction(db: Db, input: SplitInput, ctx: CurationContext): Promise<void> {
  const txs = loadTxs(db);
  const tx = findTx(txs, input.transactionId);
  const existing = loadClassifications(db);
  if (tx.amountCents >= 0) throw new Error('Só saídas podem ser divididas.');
  if (existing.get(tx.id)?.nature === 'transfer') throw new Error('Uma transferência não pode ser dividida.');
  const unit = purchaseUnitKey(tx);
  const members = txs.filter((t) => t.status !== 'removed' && t.amountCents < 0 && purchaseUnitKey(t) === unit);
  const total = -tx.amountCents;
  if (input.parts.length > 0) {
    if (input.parts.length < 2) throw new Error('Uma divisão precisa de pelo menos duas partes.');
    for (const part of input.parts) {
      if (!Number.isInteger(part.amountCents) || part.amountCents <= 0) throw new Error('Cada parte precisa de um valor maior que zero.');
      if (categoryNature(db, part.categoryId) !== 'expense') throw new Error('Cada parte precisa de uma categoria de gasto.');
    }
    const sum = input.parts.reduce((s, p) => s + p.amountCents, 0);
    if (sum !== total) throw new Error(`As partes precisam somar ${formatBRL(total)}; somam ${formatBRL(sum)}.`);
  }
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    db.delete(transactionSplits).where(inArray(transactionSplits.transactionId, members.map((m) => m.id))).run();
    if (input.parts.length === 0) return;
    db.insert(transactionSplits)
      .values(input.parts.map((part, position) => ({ transactionId: tx.id, position, ...part })))
      .run();
    const biggest = [...input.parts].sort((a, b) => b.amountCents - a.amountCents)[0] as SplitInput['parts'][number];
    for (const member of members) saveManual(db, existing.get(member.id), member, { categoryId: biggest.categoryId, owner: biggest.owner }, nowIso);
  });
  writeAudit(db, 'split', { ...input }, nowIso, ctx.actor);
}

export interface OffsetInput {
  creditId: string;
  purchaseId: string;
  /** Sem valor, abate o quanto der: o menor entre o que sobra do crédito e o que falta na compra. Zero desfaz. */
  amountCents?: number;
}

/** Liga um crédito (estorno ou reembolso) a uma compra, abatendo o valor dela. */
export async function offsetCredit(db: Db, input: OffsetInput, ctx: CurationContext): Promise<{ amountCents: number }> {
  const txs = loadTxs(db);
  const credit = findTx(txs, input.creditId);
  const purchase = findTx(txs, input.purchaseId);
  const existing = loadClassifications(db);
  const nowIso = ctx.now().toISOString();
  const pair = and(eq(offsets.creditId, credit.id), eq(offsets.purchaseId, purchase.id));
  if (input.amountCents === 0) {
    db.delete(offsets).where(pair).run();
    writeAudit(db, 'offset', { ...input }, nowIso, ctx.actor);
    return { amountCents: 0 };
  }
  if (credit.amountCents <= 0) throw new Error('O que abate precisa ser um crédito (uma entrada).');
  if (purchase.amountCents >= 0) throw new Error('O que é abatido precisa ser uma compra (uma saída).');
  if (existing.get(credit.id)?.nature === 'transfer' || existing.get(purchase.id)?.nature === 'transfer') {
    throw new Error('Uma transferência não abate nem é abatida.');
  }

  const others = db.select().from(offsets).all().filter((o) => !(o.creditId === credit.id && o.purchaseId === purchase.id));
  const byId = new Map(txs.map((t) => [t.id, t]));
  const unit = purchaseUnitKey(purchase);
  const creditLeft = credit.amountCents - others.filter((o) => o.creditId === credit.id).reduce((s, o) => s + o.amountCents, 0);
  const purchaseLeft =
    purchaseCapacityCents(purchase, txs) -
    others.filter((o) => byId.get(o.purchaseId) !== undefined && purchaseUnitKey(byId.get(o.purchaseId) as Tx) === unit).reduce((s, o) => s + o.amountCents, 0);
  if (purchaseLeft <= 0) throw new Error('Essa compra já foi abatida por inteiro.');
  if (creditLeft <= 0) throw new Error('Esse crédito já foi usado por inteiro.');
  const amount = input.amountCents ?? Math.min(creditLeft, purchaseLeft);
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Valor inválido.');
  if (amount > creditLeft) throw new Error(`O crédito só tem ${formatBRL(creditLeft)} para abater.`);
  if (amount > purchaseLeft) throw new Error(`Falta abater só ${formatBRL(purchaseLeft)} nessa compra.`);

  inTransaction(db, () => {
    const values = { creditId: credit.id, purchaseId: purchase.id, amountCents: amount, createdBy: ctx.actor, createdAt: nowIso };
    db.insert(offsets).values(values).onConflictDoUpdate({ target: [offsets.creditId, offsets.purchaseId], set: values }).run();
    // Crédito usado por inteiro sai da fila, com a categoria da compra.
    if (amount === creditLeft) {
      const bought = existing.get(purchase.id);
      saveManual(db, existing.get(credit.id), credit, { categoryId: bought?.categoryId ?? null, owner: bought?.owner ?? 'casal' }, nowIso);
    }
  });
  writeAudit(db, 'offset', { ...input, amountCents: amount }, nowIso, ctx.actor);
  return { amountCents: amount };
}
