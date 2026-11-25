import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PipelineConfig } from './core/classify';
import { HOLDERS, type Holder } from './core/types';

export interface ConnectionConfig {
  itemId: string;
  owner: Holder;
  institution: string;
}

export interface ModelConfig {
  apiKey: string;
  model: string;
  maxCostUsdPerRun: number;
  maxItemsPerRun: number;
}

export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  dataDir: string;
  dbFile: string;
  pluggy: PluggyCredentials | null;
  /** Credenciais do Meu Pluggy de cada titular (PLUGGY_CLIENT_ID_PESSOA2...); sem elas, vale `pluggy`. */
  pluggyByHolder: Partial<Record<Holder, PluggyCredentials>>;
  connections: ConnectionConfig[];
  model: ModelConfig | null;
  pipeline: PipelineConfig;
  voucherMonthlyCents: number | null;
  backup: { dir: string; ageRecipient: string } | null;
}

type Env = Record<string, string | undefined>;

export function parseConfigFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) throw new Error(`Linha inválida no arquivo de configuração: "${trimmed}"`);
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export function parseConnections(raw: string | null): ConnectionConfig[] {
  if (raw === null) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [owner, institution, itemId, ...rest] = entry.split(':');
      if (!owner || !institution || !itemId || rest.length > 0) {
        throw new Error(`Conexão inválida em FYMINANCE_CONNECTIONS: "${entry}". Use titular:instituição:itemId.`);
      }
      if (!(HOLDERS as readonly string[]).includes(owner)) {
        throw new Error(`Titular inválido em FYMINANCE_CONNECTIONS: "${owner}". Use pessoa1 ou pessoa2.`);
      }
      return { owner: owner as Holder, institution, itemId };
    });
}

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

export function loadConfig(env: Env, options: { home?: string } = {}): AppConfig {
  const home = options.home ?? homedir();
  const configFile = env.FYMINANCE_CONFIG_FILE?.trim() || join(home, '.config', 'fyminance', 'config.env');
  const fileValues = existsSync(configFile) ? parseConfigFile(readFileSync(configFile, 'utf8')) : {};

  const value = (name: string): string | null => {
    const fromEnv = env[name]?.trim();
    if (fromEnv) return fromEnv;
    const fromFile = fileValues[name]?.trim();
    return fromFile ? fromFile : null;
  };
  const number = (name: string): number | null => {
    const raw = value(name);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`${name} precisa ser um número, veio "${raw}".`);
    return parsed;
  };
  const pair = (a: string, b: string): [string, string] | null => {
    const first = value(a);
    const second = value(b);
    if (first === null && second === null) return null;
    if (first === null || second === null) throw new Error(`Defina ${a} e ${b} juntos.`);
    return [first, second];
  };

  const dataDir = value('FYMINANCE_DATA_DIR') ?? join(home, '.local', 'share', 'fyminance');
  const pluggy = pair('PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET');
  const pluggyByHolder: AppConfig['pluggyByHolder'] = {};
  for (const holder of HOLDERS) {
    const own = pair(`PLUGGY_CLIENT_ID_${holder.toUpperCase()}`, `PLUGGY_CLIENT_SECRET_${holder.toUpperCase()}`);
    if (own !== null) pluggyByHolder[holder] = { clientId: own[0], clientSecret: own[1] };
  }
  const model = pair('OPENROUTER_API_KEY', 'FYMINANCE_MODEL');
  const backup = pair('FYMINANCE_BACKUP_DIR', 'FYMINANCE_AGE_RECIPIENT');
  const pjCnpj = value('FYMINANCE_PJ_CNPJ');
  const pjName = value('FYMINANCE_PJ_NAME');

  return {
    dataDir,
    dbFile: join(dataDir, 'fyminance.db'),
    pluggy: pluggy === null ? null : { clientId: pluggy[0], clientSecret: pluggy[1] },
    pluggyByHolder,
    connections: parseConnections(value('FYMINANCE_CONNECTIONS')),
    model:
      model === null
        ? null
        : {
            apiKey: model[0],
            model: model[1],
            maxCostUsdPerRun: number('FYMINANCE_MODEL_MAX_COST_USD') ?? 0.5,
            maxItemsPerRun: number('FYMINANCE_MODEL_MAX_ITEMS') ?? 2000,
          },
    pipeline: {
      pjDocument: pjCnpj === null ? null : digits(pjCnpj),
      pjNamePattern: pjName === null ? null : new RegExp(pjName, 'i'),
      transferWindowDays: number('FYMINANCE_TRANSFER_WINDOW_DAYS') ?? 3,
      householdDocuments: new Set(
        (value('FYMINANCE_HOUSEHOLD_DOCUMENTS') ?? '')
          .split(',')
          .map(digits)
          .filter((doc) => doc.length > 0),
      ),
    },
    voucherMonthlyCents: number('FYMINANCE_VOUCHER_MONTHLY_CENTS'),
    backup: backup === null ? null : { dir: backup[0], ageRecipient: backup[1] },
  };
}

export function pluggyFor(config: AppConfig, connection: ConnectionConfig): PluggyCredentials | null {
  return config.pluggyByHolder[connection.owner] ?? config.pluggy;
}

/** Confere que há conexões e credencial da Pluggy para cada uma. */
export function requirePluggy(config: AppConfig): void {
  if (config.pluggy === null && Object.keys(config.pluggyByHolder).length === 0) {
    throw new Error('Faltam PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.');
  }
  if (config.connections.length === 0) {
    throw new Error('FYMINANCE_CONNECTIONS está vazio: nenhuma conexão para sincronizar.');
  }
  for (const connection of config.connections) {
    if (pluggyFor(config, connection) !== null) continue;
    const suffix = connection.owner.toUpperCase();
    throw new Error(
      `Faltam PLUGGY_CLIENT_ID_${suffix} e PLUGGY_CLIENT_SECRET_${suffix} (ou PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET) para ${connection.owner}:${connection.institution}.`,
    );
  }
}
