'use server';

import { revalidatePath } from 'next/cache';
import type { Owner } from '../../../core/types';
import { categorize, type CategorizeTarget } from '../../../curation/categorize';
import { curationContext, requireUser } from '../../../web/server/auth';
import { getAppContext } from '../../../web/server/context';

export type ActionResult = { ok: true; affected: number } | { ok: false; error: string };

export async function reclassifyTransactions(
  input: { target: CategorizeTarget; categoryId?: number; owner?: Owner; scope: 'rule' | 'only_these' },
  path: string,
): Promise<ActionResult> {
  const user = await requireUser(path);
  try {
    const result = await categorize(getAppContext().db, input, curationContext(user));
    revalidatePath('/', 'layout');
    return { ok: true, affected: result.affected };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
