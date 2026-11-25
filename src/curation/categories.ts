import { eq } from 'drizzle-orm';
import type { Actor, Category, CategoryKind } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories } from '../db/ledger';
import { categories, rules } from '../db/schema';
import { writeAudit } from './audit';

export type CategoryEdit =
  | { action: 'create'; name: string; kind: CategoryKind; parentId?: number | null; description?: string }
  | { action: 'rename'; id: number; name: string }
  | { action: 'describe'; id: number; description: string }
  | { action: 'move'; id: number; parentId: number | null }
  | { action: 'archive'; id: number };

function find(list: readonly Category[], id: number): Category {
  const category = list.find((c) => c.id === id);
  if (category === undefined) throw new Error(`Categoria ${id} não existe.`);
  return category;
}

function checkParent(list: readonly Category[], parentId: number, kind: CategoryKind): void {
  const parent = find(list, parentId);
  if (parent.archived) throw new Error('A categoria-mãe está arquivada.');
  if (parent.parentId !== null) throw new Error('A categoria-mãe precisa ser de primeiro nível.');
  if (parent.kind !== kind) throw new Error('A categoria-mãe precisa ser do mesmo tipo.');
}

function checkName(list: readonly Category[], name: string, kind: CategoryKind, exceptId?: number): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('O nome não pode ser vazio.');
  const taken = list.some(
    (c) => c.id !== exceptId && !c.archived && c.kind === kind && c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (taken) throw new Error(`Já existe uma categoria ativa chamada "${trimmed}".`);
  return trimmed;
}

function hasActiveChildren(list: readonly Category[], id: number): boolean {
  return list.some((c) => c.parentId === id && !c.archived);
}

function apply(db: Db, list: readonly Category[], edit: CategoryEdit): number {
  switch (edit.action) {
    case 'create': {
      const name = checkName(list, edit.name, edit.kind);
      const parentId = edit.parentId ?? null;
      if (parentId !== null) checkParent(list, parentId, edit.kind);
      return db
        .insert(categories)
        .values({ name, kind: edit.kind, parentId, description: edit.description ?? '' })
        .returning({ id: categories.id })
        .get().id;
    }
    case 'rename': {
      const category = find(list, edit.id);
      const name = checkName(list, edit.name, category.kind, category.id);
      db.update(categories).set({ name }).where(eq(categories.id, edit.id)).run();
      return edit.id;
    }
    case 'describe': {
      find(list, edit.id);
      db.update(categories).set({ description: edit.description }).where(eq(categories.id, edit.id)).run();
      return edit.id;
    }
    case 'move': {
      const category = find(list, edit.id);
      if (edit.parentId !== null) {
        if (edit.parentId === category.id) throw new Error('Uma categoria não pode ser mãe de si mesma.');
        if (hasActiveChildren(list, category.id)) throw new Error('Uma categoria com subcategorias não pode virar subcategoria.');
        checkParent(list, edit.parentId, category.kind);
      }
      db.update(categories).set({ parentId: edit.parentId }).where(eq(categories.id, edit.id)).run();
      return edit.id;
    }
    case 'archive': {
      const category = find(list, edit.id);
      if (hasActiveChildren(list, category.id)) throw new Error('Arquive ou mova as subcategorias antes.');
      const used = db.select({ id: rules.id }).from(rules).where(eq(rules.setCategoryId, category.id)).all().length;
      if (used > 0) throw new Error(`Há ${used} regra(s) usando esta categoria. Remova ou altere antes de arquivar.`);
      db.update(categories).set({ archived: true }).where(eq(categories.id, edit.id)).run();
      return edit.id;
    }
  }
}

export function editCategory(db: Db, edit: CategoryEdit, ctx: { now: () => Date; actor: Actor }): Category {
  const id = apply(db, loadCategories(db), edit);
  writeAudit(db, 'edit_category', edit, ctx.now().toISOString(), ctx.actor);
  return find(loadCategories(db), id);
}

export function listCategories(db: Db): Array<Category & { path: string }> {
  const list = loadCategories(db);
  return list.filter((c) => !c.archived).map((c) => ({ ...c, path: categoryPath(list, c.id) }));
}
