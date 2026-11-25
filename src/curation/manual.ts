import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { normalizeMerchantKey } from '../core/merchant';
import type { Actor, Owner } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { accounts, classifications, monthChecks, transactions } from '../db/schema';
import { VOUCHER_ACCOUNT_ID } from '../jobs/voucher';
import { writeAudit } from './audit';
import { categoryNature, type CurationContext } from './context';

export const MANUAL_ACCOUNT_ID = 'manual:avulso';

export interface ManualEntryInput {
  accountId?: string;
  /** Fatura a que o lançamento pertence (diferença de fatura); entra na conferência dela. */
  billId?: string;
  date: string;
  /** Sempre positivo; o sinal vem de `nature`. */
  amountCents: number;
  description: string;
  nature: 'expense' | 'income';
  categoryId: number;
  owner: Owner;
}

const NOT_MANUAL = 'Só lançamentos manuais podem ser alterados.';

const holderOf = (actor: Actor) => (actor === 'claude' ? null : actor);

function validate(db: Db, input: ManualEntryInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Data inválida; use AAAA-MM-DD.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error('O valor precisa ser maior que zero.');
  if (input.description.trim() === '') throw new Error('Informe uma descrição.');
  if (categoryNature(db, input.categoryId) !== input.nature) {
    throw new Error(input.nature === 'income' ? 'Escolha uma categoria de renda.' : 'Escolha uma categoria de gasto.');
  }
}

function ensureManualAccount(db: Db): void {
  db.insert(accounts)
    .values({ id: MANUAL_ACCOUNT_ID, connectionId: null, kind: 'cash', name: 'Lançamentos manuais', owner: 'pessoa1', raw: null })
    .onConflictDoNothing()
    .run();
}

function requireManual(db: Db, id: string): void {
  const row = db.select({ origin: transactions.origin }).from(transactions).where(eq(transactions.id, id)).get();
  if (row === undefined || row.origin !== 'manual') throw new Error(NOT_MANUAL);
}

function writeEntry(db: Db, id: string, input: ManualEntryInput, ctx: CurationContext, nowIso: string): void {
  const description = input.description.trim();
  const values = {
    accountId: input.accountId ?? MANUAL_ACCOUNT_ID,
    date: input.date,
    amountCents: input.nature === 'income' ? input.amountCents : -input.amountCents,
    description,
    merchantKey: normalizeMerchantKey(description),
    status: 'posted' as const,
    billId: input.billId ?? null,
    updatedAt: nowIso,
  };
  db.insert(transactions)
    .values({ id, ...values, raw: '{}', firstSeenAt: nowIso, origin: 'manual', createdBy: holderOf(ctx.actor) })
    .onConflictDoUpdate({ target: transactions.id, set: values })
    .run();
  const cls = {
    transactionId: id,
    nature: input.nature,
    transferKind: null,
    transferPairId: null,
    categoryId: input.categoryId,
    owner: input.owner,
    source: 'manual' as const,
    ruleId: null,
    model: null,
    confidence: null,
    purchaseGroup: null,
    reviewReason: null,
    updatedAt: nowIso,
  };
  db.insert(classifications).values(cls).onConflictDoUpdate({ target: classifications.transactionId, set: cls }).run();
}

export async function createManualEntry(db: Db, input: ManualEntryInput, ctx: CurationContext): Promise<{ id: string }> {
  validate(db, input);
  const id = `manual:${randomUUID()}`;
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    if (input.accountId === undefined) ensureManualAccount(db);
    writeEntry(db, id, input, ctx, nowIso);
    writeAudit(db, 'manual_create', { id, ...input }, nowIso, ctx.actor);
  });
  return { id };
}

export async function updateManualEntry(db: Db, id: string, input: ManualEntryInput, ctx: CurationContext): Promise<void> {
  requireManual(db, id);
  validate(db, input);
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    if (input.accountId === undefined) ensureManualAccount(db);
    writeEntry(db, id, input, ctx, nowIso);
    writeAudit(db, 'manual_update', { id, ...input }, nowIso, ctx.actor);
  });
}

export async function deleteManualEntry(db: Db, id: string, ctx: CurationContext): Promise<void> {
  requireManual(db, id);
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    db.delete(classifications).where(eq(classifications.transactionId, id)).run();
    db.delete(transactions).where(eq(transactions.id, id)).run();
    writeAudit(db, 'manual_delete', { id }, nowIso, ctx.actor);
  });
}

/** Corrige o gasto estimado do vale-alimentação no mês e marca o vale-alimentação como conferido. */
export function setVoucherSpend(db: Db, month: string, cents: number, ctx: Pick<CurationContext, 'now' | 'actor'>): void {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('O valor do vale-alimentação não pode ser negativo.');
  const id = `voucher:${month}:out`;
  const nowIso = ctx.now().toISOString();
  inTransaction(db, () => {
    const result = db
      .update(transactions)
      .set({ amountCents: -cents, updatedAt: nowIso })
      .where(eq(transactions.id, id))
      .run();
    if (result.changes === 0) throw new Error(`O vale-alimentação não tem lançamento em ${month}.`);
    const check = { month, key: 'flash' as const, doneAt: nowIso, doneBy: ctx.actor, note: null };
    db.insert(monthChecks).values(check).onConflictDoUpdate({ target: [monthChecks.month, monthChecks.key], set: check }).run();
    writeAudit(db, 'voucher_spend', { month, cents, accountId: VOUCHER_ACCOUNT_ID }, nowIso, ctx.actor);
  });
}
