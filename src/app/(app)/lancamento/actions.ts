'use server';

import { revalidatePath } from 'next/cache';
import { formatBRL, parseBRL } from '../../../core/money';
import type { Owner } from '../../../core/types';
import { annotate, offsetCredit, splitTransaction } from '../../../curation/entries';
import { curationContext, requireUser } from '../../../web/server/auth';
import { getAppContext } from '../../../web/server/context';

export type EntryResult = { ok: true; message?: string } | { ok: false; error: string };

async function run(path: string, work: (ctx: ReturnType<typeof curationContext>) => Promise<string>): Promise<EntryResult> {
  const user = await requireUser(path);
  try {
    const message = await work(curationContext(user));
    revalidatePath('/', 'layout');
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const db = () => getAppContext().db;

export async function saveNote(path: string, transactionId: string, note: string): Promise<EntryResult> {
  return run(path, async (ctx) => {
    await annotate(db(), { transactionId, note }, ctx);
    return note.trim() === '' ? 'Anotação apagada.' : 'Anotação salva.';
  });
}

/** Partes com o valor digitado ("70,00"); lista vazia desfaz a divisão. */
export async function saveSplit(path: string, transactionId: string, parts: Array<{ value: string; categoryId: number; owner: Owner }>): Promise<EntryResult> {
  return run(path, async (ctx) => {
    const parsed = parts.map(({ value, ...rest }) => ({ ...rest, amountCents: parseBRL(value) }));
    await splitTransaction(db(), { transactionId, parts: parsed }, ctx);
    return parts.length === 0 ? 'Divisão desfeita.' : 'Compra dividida.';
  });
}

/** Abate o crédito na compra; sem valor, o quanto der. */
export async function linkOffset(path: string, creditId: string, purchaseId: string, value?: string): Promise<EntryResult> {
  return run(path, async (ctx) => {
    const amountCents = value === undefined || value.trim() === '' ? undefined : parseBRL(value);
    const result = await offsetCredit(db(), { creditId, purchaseId, amountCents }, ctx);
    return `Abatido ${formatBRL(result.amountCents)}.`;
  });
}

export async function unlinkOffset(path: string, creditId: string, purchaseId: string): Promise<EntryResult> {
  return run(path, async (ctx) => {
    await offsetCredit(db(), { creditId, purchaseId, amountCents: 0 }, ctx);
    return 'Abatimento desfeito.';
  });
}
