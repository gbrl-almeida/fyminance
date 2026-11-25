import { eq } from 'drizzle-orm';
import type { PipelineConfig } from '../core/classify';
import type { Actor, Nature } from '../core/types';
import type { Db } from '../db/client';
import { categories } from '../db/schema';
import { reclassify } from '../jobs/reclassify';

export interface CurationContext {
  pipeline: PipelineConfig;
  now: () => Date;
  actor: Actor;
}

export function categoryNature(db: Db, categoryId: number): Nature {
  const category = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (category === undefined || category.archived) {
    throw new Error(`Categoria ${categoryId} não existe ou está arquivada.`);
  }
  return category.kind === 'income' ? 'income' : 'expense';
}

export async function refresh(db: Db, ctx: CurationContext): Promise<void> {
  await reclassify({ db, pipeline: ctx.pipeline, classifier: null, now: ctx.now });
}
