import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'fyminance-cli-'));
  homes.push(home);
  return home;
}

function cli(home: string, args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    input,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: home, FYMINANCE_DATA_DIR: join(home, 'dados') },
    encoding: 'utf8',
  });
}

describe('fy cli', () => {
  it('creates the database and reports an empty status', () => {
    const home = tempHome();
    const migrate = cli(home, ['migrate']);
    expect(migrate.status).toBe(0);
    expect(migrate.stdout).toContain(join(home, 'dados', 'fyminance.db'));
    expect(existsSync(join(home, 'dados', 'fyminance.db'))).toBe(true);

    const status = cli(home, ['status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('nenhuma ainda');
  }, 30_000);

  it('explains missing credentials and exits with an error', () => {
    const sync = cli(tempHome(), ['sync']);
    expect(sync.status).toBe(1);
    expect(sync.stderr).toContain('Faltam PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.');
  }, 30_000);

  it('asks for migrate before reading status', () => {
    const status = cli(tempHome(), ['status']);
    expect(status.status).toBe(1);
    expect(status.stderr).toContain('Rode "pnpm fy migrate" primeiro.');
  }, 30_000);

  it('sets a user password read from stdin', () => {
    const home = tempHome();
    expect(cli(home, ['migrate']).status).toBe(0);
    const mismatch = cli(home, ['user', 'set-password', 'pessoa2'], 'senha-bem-longa\noutra-senha-xx\n');
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('As senhas não conferem.');
    const ok = cli(home, ['user', 'set-password', 'pessoa2'], 'senha-bem-longa\nsenha-bem-longa\n');
    expect(ok.stderr).toBe('');
    expect(ok.stdout).toContain('Senha da pessoa 2 definida.');
  });

  it('import refuses a bank without parser', () => {
    const home = tempHome();
    expect(cli(home, ['migrate']).status).toBe(0);
    const result = cli(home, ['import', join(home, 'fatura.csv'), '--bank', 'xpto', '--account', 'file:x', '--name', 'X']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Ainda não há leitor para o banco "xpto".');
  });

  it('import finds the bank from the file', () => {
    const home = tempHome();
    expect(cli(home, ['migrate']).status).toBe(0);
    const file = join(home, 'Fatura_2026-10-20.csv');
    copyFileSync(fileURLToPath(new URL('./integrations/files/fixtures/c6-sintetico.csv', import.meta.url)), file);
    const result = cli(home, ['import', file, '--account', 'file:c6', '--name', 'C6 (arquivo)']);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Fatura do C6: 7 transações novas, 0 já existiam.');
  }, 30_000);

  it('creates a demo database and refuses to overwrite it', () => {
    const home = tempHome();
    const dir = join(home, 'demo');
    const first = cli(home, ['demo', '--dir', dir]);
    expect(first.stderr).toBe('');
    expect(existsSync(join(dir, 'fyminance.db'))).toBe(true);
    const second = cli(home, ['demo', '--dir', dir]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('Já existe um banco em');
  });
});
