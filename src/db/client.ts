import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface OpenDb {
  db: Db;
  sqlite: Database.Database;
}

// Caminho montado com `path` (e não `new URL(..., import.meta.url)`) para o bundler do Next não tentar empacotar a pasta.
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export function wrap(sqlite: Database.Database): Db {
  return drizzle(sqlite, { schema });
}

export function openDb(file: string, options: { readonly?: boolean } = {}): OpenDb {
  const readonly = options.readonly === true;
  const sqlite = readonly ? new Database(file, { readonly: true, fileMustExist: true }) : new Database(file);
  sqlite.pragma('busy_timeout = 5000');
  if (!readonly) sqlite.pragma('journal_mode = WAL');
  return { db: wrap(sqlite), sqlite };
}

export function migrateDb(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function inTransaction<T>(db: Db, work: () => T): T {
  return db.$client.transaction(work)();
}
