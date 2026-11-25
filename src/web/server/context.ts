import { existsSync } from 'node:fs';
import { loadConfig } from '../../config';
import type { PipelineConfig } from '../../core/classify';
import { toSaoPauloDate } from '../../core/dates';
import { openDb, type Db } from '../../db/client';
import { createOpenRouterClassifier, type Classifier } from '../../integrations/openrouter/classifier';

export interface AppContext {
  db: Db;
  dataDir: string;
  pipeline: PipelineConfig;
  classifier: Classifier | null;
  today: () => string;
  now: () => Date;
}

const holder = globalThis as typeof globalThis & { __fyminanceApp?: AppContext };

/** Uma conexão gravável por processo; o banco é migrado pela CLI, nunca pelo app. */
export function getAppContext(): AppContext {
  if (holder.__fyminanceApp !== undefined) return holder.__fyminanceApp;
  const config = loadConfig(process.env);
  if (!existsSync(config.dbFile)) {
    throw new Error(`Banco não encontrado em ${config.dbFile}. Rode "pnpm fy migrate" primeiro.`);
  }
  const { db } = openDb(config.dbFile);
  holder.__fyminanceApp = {
    db,
    dataDir: config.dataDir,
    pipeline: config.pipeline,
    classifier: config.model === null ? null : createOpenRouterClassifier(config.model),
    today: () => toSaoPauloDate(new Date()),
    now: () => new Date(),
  };
  return holder.__fyminanceApp;
}
