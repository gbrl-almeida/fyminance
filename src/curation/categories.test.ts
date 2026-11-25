import { describe, expect, it } from 'vitest';
import { auditLog, rules } from '../db/schema';
import { categoryIdByName, createTestDb } from '../db/testing';
import { editCategory, listCategories } from './categories';

const ctx = { now: () => new Date('2026-10-14T10:00:00.000Z'), actor: 'pessoa1' as const };

describe('editCategory', () => {
  it('creates a subcategory and lists it with its path', () => {
    const { db } = createTestDb();
    const food = categoryIdByName(db, 'Alimentação');
    const created = editCategory(db, { action: 'create', name: 'Feira', kind: 'expense', parentId: food, description: 'Feiras livres' }, ctx);
    expect(created).toMatchObject({ name: 'Feira', parentId: food, kind: 'expense', description: 'Feiras livres', archived: false });
    expect(listCategories(db).find((c) => c.id === created.id)?.path).toBe('Alimentação > Feira');
    expect(db.select().from(auditLog).get()?.action).toBe('edit_category');
  });

  it('keeps the tree to two levels of the same kind with unique names', () => {
    const { db } = createTestDb();
    const food = categoryIdByName(db, 'Alimentação');
    expect(() => editCategory(db, { action: 'create', name: 'mercado', kind: 'expense', parentId: food }, ctx)).toThrow(
      'Já existe uma categoria ativa chamada "mercado".',
    );
    expect(() =>
      editCategory(db, { action: 'create', name: 'Hortifrúti', kind: 'expense', parentId: categoryIdByName(db, 'Mercado') }, ctx),
    ).toThrow('A categoria-mãe precisa ser de primeiro nível.');
    expect(() =>
      editCategory(db, { action: 'create', name: 'Bônus', kind: 'expense', parentId: categoryIdByName(db, 'Salário') }, ctx),
    ).toThrow('A categoria-mãe precisa ser do mesmo tipo.');
    expect(() => editCategory(db, { action: 'create', name: '  ', kind: 'expense' }, ctx)).toThrow('O nome não pode ser vazio.');
  });

  it('renames, describes and moves categories', () => {
    const { db } = createTestDb();
    const delivery = categoryIdByName(db, 'Delivery');
    expect(editCategory(db, { action: 'rename', id: delivery, name: 'Pedidos' }, ctx).name).toBe('Pedidos');
    expect(editCategory(db, { action: 'describe', id: delivery, description: 'Apps' }, ctx).description).toBe('Apps');
    expect(editCategory(db, { action: 'move', id: delivery, parentId: null }, ctx).parentId).toBeNull();
    const food = categoryIdByName(db, 'Alimentação');
    expect(() => editCategory(db, { action: 'move', id: food, parentId: categoryIdByName(db, 'Casa') }, ctx)).toThrow(
      'Uma categoria com subcategorias não pode virar subcategoria.',
    );
    expect(() => editCategory(db, { action: 'move', id: food, parentId: food }, ctx)).toThrow(
      'Uma categoria não pode ser mãe de si mesma.',
    );
  });

  it('archives only leaves that no rule uses', () => {
    const { db } = createTestDb();
    const bakery = categoryIdByName(db, 'Padaria e café');
    expect(editCategory(db, { action: 'archive', id: bakery }, ctx).archived).toBe(true);
    expect(listCategories(db).some((c) => c.id === bakery)).toBe(false);
    expect(() => editCategory(db, { action: 'archive', id: categoryIdByName(db, 'Alimentação') }, ctx)).toThrow(
      'Arquive ou mova as subcategorias antes.',
    );
    const others = categoryIdByName(db, 'Outros');
    db.insert(rules).values({ merchantKey: 'X', setCategoryId: others, origin: 'user', createdAt: '2026-10-01T00:00:00.000Z' }).run();
    expect(() => editCategory(db, { action: 'archive', id: others }, ctx)).toThrow(
      'Há 1 regra(s) usando esta categoria. Remova ou altere antes de arquivar.',
    );
    expect(() => editCategory(db, { action: 'rename', id: 9999, name: 'X' }, ctx)).toThrow('Categoria 9999 não existe.');
  });
});
