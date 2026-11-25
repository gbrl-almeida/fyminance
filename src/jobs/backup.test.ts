import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '../core/dates';
import { makeTx } from '../core/testing';
import { createTestDb, insertTestAccount, insertTestTx } from '../db/testing';
import { ageDecrypt, ageEncrypt, backupsToDelete, restoreBackup, runBackup } from './backup';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fyminance-backup-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const copy = async (input: string, output: string) => copyFileSync(input, output);
const hasAge = spawnSync('age', ['--version']).status === 0;

function ledger() {
  const handle = createTestDb();
  insertTestAccount(handle.db, { id: 'c6', kind: 'checking' });
  insertTestTx(handle.db, makeTx({ id: 't1', accountId: 'c6' }));
  return handle;
}

describe('backupsToDelete', () => {
  it('keeps the last 7 backups and the latest of each of the last 12 months', () => {
    const names = Array.from({ length: 400 }, (_, i) => `fyminance-${addDays('2026-10-14', -i)}.db.gz.age`);
    names.push('outro-arquivo.txt');
    const doomed = new Set(backupsToDelete(names));
    const kept = names.filter((n) => n.startsWith('fyminance-') && !doomed.has(n));

    expect(doomed.has('outro-arquivo.txt')).toBe(false);
    expect(kept).toHaveLength(18);
    expect(kept).toContain('fyminance-2026-10-14.db.gz.age');
    expect(kept).toContain('fyminance-2026-10-08.db.gz.age');
    expect(kept).not.toContain('fyminance-2026-10-07.db.gz.age');
    expect(kept).toContain('fyminance-2026-09-30.db.gz.age');
    expect(kept).toContain('fyminance-2025-11-30.db.gz.age');
    expect(kept).not.toContain('fyminance-2025-10-31.db.gz.age');
  });
});

describe('runBackup and restoreBackup', () => {
  it('writes the backup to both folders, prunes old ones and restores it', async () => {
    const { sqlite } = ledger();
    const dataDir = tempDir();
    const backupDir = tempDir();
    for (let day = 1; day <= 10; day++) {
      writeFileSync(join(backupDir, `fyminance-2024-01-${String(day).padStart(2, '0')}.db.gz.age`), 'velho');
    }

    const result = await runBackup({ sqlite, dataDir, backupDir, today: '2026-10-14', encrypt: copy });

    expect(result.file).toBe(join(backupDir, 'fyminance-2026-10-14.db.gz.age'));
    expect(readdirSync(join(dataDir, 'backups'))).toEqual(['fyminance-2026-10-14.db.gz.age']);
    expect(result.deleted.sort()).toEqual(
      ['01', '02', '03', '04'].map((d) => join(backupDir, `fyminance-2024-01-${d}.db.gz.age`)),
    );

    const restored = await restoreBackup({ file: result.file, targetDir: tempDir(), decrypt: copy });
    expect(restored).toMatchObject({ integrity: 'ok', transactions: 1 });
    expect(existsSync(restored.dbFile)).toBe(true);
  });

  it.skipIf(!hasAge)('round-trips through the real age binary', async () => {
    const keys = tempDir();
    const identity = join(keys, 'key.txt');
    execFileSync('age-keygen', ['-o', identity]);
    const recipient = readFileSync(identity, 'utf8').match(/public key: (age1\w+)/)?.[1] as string;
    const { sqlite } = ledger();
    const result = await runBackup({
      sqlite,
      dataDir: tempDir(),
      backupDir: tempDir(),
      today: '2026-10-14',
      encrypt: ageEncrypt(recipient),
    });
    const restored = await restoreBackup({ file: result.file, targetDir: tempDir(), decrypt: ageDecrypt(identity) });
    expect(restored).toMatchObject({ integrity: 'ok', transactions: 1 });
  });
});
