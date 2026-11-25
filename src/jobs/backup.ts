import { execFile } from 'node:child_process';
import { copyFileSync, createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip, createGzip } from 'node:zlib';
import Database from 'better-sqlite3';

const run = promisify(execFile);
const BACKUP_NAME = /^fyminance-(\d{4}-\d{2}-\d{2})\.db\.gz\.age$/;
const KEEP_DAILY = 7;
const KEEP_MONTHLY = 12;

export type FileTransform = (input: string, output: string) => Promise<void>;

export function ageEncrypt(recipient: string): FileTransform {
  return async (input, output) => {
    await run('age', ['-r', recipient, '-o', output, input]);
  };
}

export function ageDecrypt(identityFile: string): FileTransform {
  return async (input, output) => {
    await run('age', ['-d', '-i', identityFile, '-o', output, input]);
  };
}

export function backupsToDelete(names: readonly string[]): string[] {
  const dated = names
    .flatMap((name) => {
      const match = BACKUP_NAME.exec(name);
      return match === null ? [] : [{ name, date: match[1] as string }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const keep = new Set(dated.slice(0, KEEP_DAILY).map((b) => b.name));
  const months = new Set<string>();
  for (const backup of dated) {
    const month = backup.date.slice(0, 7);
    if (months.has(month)) continue;
    if (months.size === KEEP_MONTHLY) break;
    months.add(month);
    keep.add(backup.name);
  }
  return dated.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

function prune(dir: string): string[] {
  const doomed = backupsToDelete(readdirSync(dir));
  for (const name of doomed) rmSync(join(dir, name));
  return doomed.map((name) => join(dir, name));
}

export async function runBackup(deps: {
  sqlite: Database.Database;
  dataDir: string;
  backupDir: string;
  today: string;
  encrypt: FileTransform;
}): Promise<{ file: string; deleted: string[] }> {
  const localDir = join(deps.dataDir, 'backups');
  mkdirSync(localDir, { recursive: true });
  mkdirSync(deps.backupDir, { recursive: true });
  const snapshot = join(localDir, `snapshot-${deps.today}.db`);
  const zipped = `${snapshot}.gz`;
  const name = `fyminance-${deps.today}.db.gz.age`;
  const encrypted = join(localDir, name);
  try {
    await deps.sqlite.backup(snapshot);
    await pipeline(createReadStream(snapshot), createGzip(), createWriteStream(zipped));
    await deps.encrypt(zipped, encrypted);
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(zipped, { force: true });
  }
  const file = join(deps.backupDir, name);
  copyFileSync(encrypted, file);
  return { file, deleted: [...prune(localDir), ...prune(deps.backupDir)] };
}

export async function restoreBackup(deps: {
  file: string;
  targetDir: string;
  decrypt: FileTransform;
}): Promise<{ dbFile: string; integrity: string; transactions: number }> {
  mkdirSync(deps.targetDir, { recursive: true });
  const zipped = join(deps.targetDir, 'restore.db.gz');
  const dbFile = join(deps.targetDir, 'fyminance.db');
  try {
    await deps.decrypt(deps.file, zipped);
    await pipeline(createReadStream(zipped), createGunzip(), createWriteStream(dbFile));
  } finally {
    rmSync(zipped, { force: true });
  }
  const sqlite = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(sqlite.pragma('integrity_check', { simple: true }));
    const { count } = sqlite.prepare('SELECT count(*) AS count FROM transactions').get() as { count: number };
    return { dbFile, integrity, transactions: count };
  } finally {
    sqlite.close();
  }
}
