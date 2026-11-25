import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDb, openDb } from './client';
import { categories } from './schema';
import { seedCategories } from './seed';
import { createTestDb } from './testing';

describe('database', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('migrations create the 1b tables', () => {
    const { sqlite } = createTestDb();
    const names = (sqlite.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'month_checks',
        'month_closings',
        'divergence_notes',
        'category_goals',
        'month_plans',
        'plan_notes',
        'plan_note_lines',
      ]),
    );
  });

  it('creates every table and view', () => {
    const { sqlite } = createTestDb();
    const names = (
      sqlite.prepare("select name from sqlite_master where type in ('table', 'view')").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'connections',
        'accounts',
        'balance_snapshots',
        'transactions',
        'bills',
        'categories',
        'rules',
        'classifications',
        'audit_log',
        'sync_runs',
        'transaction_notes',
        'transaction_splits',
        'offsets',
        'v_transactions',
        'v_balances',
        'v_splits',
        'v_offsets',
      ]),
    );
  });

  it('seeds the initial categories once', () => {
    const { db } = createTestDb();
    expect(seedCategories(db)).toBe(0);
    const rows = db.select().from(categories).all();
    expect(rows).toHaveLength(22);
    const food = rows.find((c) => c.name === 'Alimentação');
    expect(rows.filter((c) => c.parentId === food?.id).map((c) => c.name)).toEqual([
      'Mercado',
      'Restaurante',
      'Delivery',
      'Padaria e café',
    ]);
    expect(rows.filter((c) => c.kind === 'income').map((c) => c.name)).toEqual([
      'Salário',
      'Pró-labore',
      'Lucros do PJ',
      'Voucher',
      'Outras rendas',
    ]);
  });

  it('opens a read-only connection that cannot write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fyminance-'));
    dirs.push(dir);
    const file = join(dir, 'test.db');
    const writer = openDb(file);
    migrateDb(writer.db);
    writer.sqlite.close();
    const reader = openDb(file, { readonly: true });
    expect(() =>
      reader.sqlite.prepare("insert into categories (name, kind, description, archived) values ('x', 'expense', '', 0)").run(),
    ).toThrow(/readonly/i);
    reader.sqlite.close();
  });
});
