import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseConfigFile, parseConnections, pluggyFor, requirePluggy } from './config';

const homes: string[] = [];
function fakeHome(configFile?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'fyminance-home-'));
  homes.push(home);
  if (configFile !== undefined) {
    mkdirSync(join(home, '.config', 'fyminance'), { recursive: true });
    writeFileSync(join(home, '.config', 'fyminance', 'config.env'), configFile);
  }
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    const home = fakeHome();
    const config = loadConfig({}, { home });
    expect(config.dataDir).toBe(join(home, '.local', 'share', 'fyminance'));
    expect(config.dbFile).toBe(join(home, '.local', 'share', 'fyminance', 'fyminance.db'));
    expect(config).toMatchObject({ pluggy: null, connections: [], model: null, voucherMonthlyCents: null, backup: null });
    expect(config.pipeline).toMatchObject({ pjDocument: null, pjNamePattern: null, transferWindowDays: 3 });
    expect([...config.pipeline.householdDocuments]).toEqual([]);
  });

  it('reads the config file and lets the environment win', () => {
    const home = fakeHome('# comentário\nFYMINANCE_TRANSFER_WINDOW_DAYS=5\nFYMINANCE_VOUCHER_MONTHLY_CENTS="80000"\n');
    const config = loadConfig({ FYMINANCE_TRANSFER_WINDOW_DAYS: '4', FYMINANCE_DATA_DIR: '' }, { home });
    expect(config.pipeline.transferWindowDays).toBe(4);
    expect(config.voucherMonthlyCents).toBe(80000);
    expect(config.dataDir).toBe(join(home, '.local', 'share', 'fyminance'));
  });

  it('normalizes documents and compiles the PJ name pattern', () => {
    const config = loadConfig(
      {
        FYMINANCE_PJ_CNPJ: '12.345.678/0001-99',
        FYMINANCE_PJ_NAME: 'fulano servicos ltda',
        FYMINANCE_HOUSEHOLD_DOCUMENTS: '111.111.111-11, 222.222.222-22',
      },
      { home: fakeHome() },
    );
    expect(config.pipeline.pjDocument).toBe('12345678000199');
    expect(config.pipeline.pjNamePattern?.test('TED FULANO SERVICOS LTDA')).toBe(true);
    expect([...config.pipeline.householdDocuments]).toEqual(['11111111111', '22222222222']);
  });

  it('reads the model settings with defaults for the limits', () => {
    const home = fakeHome();
    expect(loadConfig({ OPENROUTER_API_KEY: 'k', FYMINANCE_MODEL: 'm' }, { home }).model).toEqual({
      apiKey: 'k',
      model: 'm',
      maxCostUsdPerRun: 0.5,
      maxItemsPerRun: 2000,
    });
    expect(
      loadConfig({ OPENROUTER_API_KEY: 'k', FYMINANCE_MODEL: 'm', FYMINANCE_MODEL_MAX_COST_USD: '1.25' }, { home }).model
        ?.maxCostUsdPerRun,
    ).toBe(1.25);
  });

  it('requires paired settings to come together', () => {
    const home = fakeHome();
    expect(() => loadConfig({ PLUGGY_CLIENT_ID: 'x' }, { home })).toThrow('Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET juntos.');
    expect(() => loadConfig({ FYMINANCE_BACKUP_DIR: '/x' }, { home })).toThrow(/FYMINANCE_AGE_RECIPIENT/);
  });

  it('rejects numbers that are not numbers', () => {
    expect(() => loadConfig({ FYMINANCE_TRANSFER_WINDOW_DAYS: 'abc' }, { home: fakeHome() })).toThrow(
      'FYMINANCE_TRANSFER_WINDOW_DAYS precisa ser um número, veio "abc".',
    );
  });
});

describe('parseConnections', () => {
  it('parses owner, institution and item id', () => {
    expect(parseConnections('pessoa1:C6:item-1, pessoa2:Inter:item-3')).toEqual([
      { owner: 'pessoa1', institution: 'C6', itemId: 'item-1' },
      { owner: 'pessoa2', institution: 'Inter', itemId: 'item-3' },
    ]);
    expect(parseConnections(null)).toEqual([]);
  });

  it('rejects malformed entries and unknown owners', () => {
    expect(() => parseConnections('pessoa1:C6')).toThrow(/titular:instituição:itemId/);
    expect(() => parseConnections('joao:C6:item')).toThrow(/Titular inválido/);
  });
});

describe('parseConfigFile', () => {
  it('reads key=value lines, skipping comments and stripping quotes', () => {
    expect(parseConfigFile("A=1\n\n# x\nB='dois'\nC = \"três\"\n")).toEqual({ A: '1', B: 'dois', C: 'três' });
  });

  it('rejects lines without a key', () => {
    expect(() => parseConfigFile('=1')).toThrow(/Linha inválida/);
  });
});

describe('requirePluggy', () => {
  it('explains what is missing', () => {
    const home = fakeHome();
    expect(() => requirePluggy(loadConfig({}, { home }))).toThrow('Faltam PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.');
    expect(() => requirePluggy(loadConfig({ PLUGGY_CLIENT_ID: 'a', PLUGGY_CLIENT_SECRET: 'b' }, { home }))).toThrow(
      /FYMINANCE_CONNECTIONS/,
    );
  });
});

describe('pluggyFor', () => {
  const creds = { PLUGGY_CLIENT_ID: 'a', PLUGGY_CLIENT_SECRET: 'b', PLUGGY_CLIENT_ID_PESSOA2: 'c', PLUGGY_CLIENT_SECRET_PESSOA2: 'd' };

  it('uses the credentials of the account holder, and the default ones otherwise', () => {
    const config = loadConfig({ ...creds, FYMINANCE_CONNECTIONS: 'pessoa1:C6:1,pessoa2:Inter:2' }, { home: fakeHome() });
    const [c6, inter] = config.connections;
    expect(pluggyFor(config, c6!)).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(pluggyFor(config, inter!)).toEqual({ clientId: 'c', clientSecret: 'd' });
    expect(requirePluggy(config)).toBeUndefined();
  });

  it('requires credentials for every connection', () => {
    const config = loadConfig(
      { PLUGGY_CLIENT_ID_PESSOA2: 'c', PLUGGY_CLIENT_SECRET_PESSOA2: 'd', FYMINANCE_CONNECTIONS: 'pessoa1:C6:1,pessoa2:Inter:2' },
      { home: fakeHome() },
    );
    expect(() => requirePluggy(config)).toThrow('Faltam PLUGGY_CLIENT_ID_PESSOA1 e PLUGGY_CLIENT_SECRET_PESSOA1 (ou PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET) para pessoa1:C6.');
  });
});
