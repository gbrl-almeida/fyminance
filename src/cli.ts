import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { Command } from 'commander';
import { setUserPassword } from './auth/passwords';
import { setCountsAsInvestment, setLedgerWindow } from './curation/accounts';
import { backfillLegacyClosings } from './curation/closing';
import { getInvestments } from './queries/investments';
import { getBalances } from './queries/balances';
import { parseBRL } from './core/money';
import { detectBank, PARSERS, UNKNOWN_FILE } from './integrations/files/statement';
import { importStatement } from './jobs/import-statement';
import { seedDemo } from './jobs/demo';
import { basename, join } from 'node:path';
import { loadConfig, pluggyFor, requirePluggy, type AppConfig } from './config';
import { toSaoPauloDate } from './core/dates';
import { HOLDERS, type Holder } from './core/types';
import { migrateDb, openDb, type OpenDb } from './db/client';
import { seedCategories } from './db/seed';
import { createOpenRouterClassifier } from './integrations/openrouter/classifier';
import { createPluggySource } from './integrations/pluggy/source';
import { remapPluggyTransactions } from './jobs/remap';
import { reclassify } from './jobs/reclassify';
import { formatStatus } from './jobs/status';
import { runSync } from './jobs/sync';
import { ageDecrypt, ageEncrypt, restoreBackup, runBackup } from './jobs/backup';
import { evaluateModels, formatEvaluation } from './jobs/eval-models';

function openWritable(config: AppConfig): OpenDb {
  mkdirSync(config.dataDir, { recursive: true });
  const handle = openDb(config.dbFile);
  migrateDb(handle.db);
  seedCategories(handle.db);
  return handle;
}

function openExisting(config: AppConfig): OpenDb {
  if (!existsSync(config.dbFile)) {
    throw new Error(`Banco não encontrado em ${config.dbFile}. Rode "pnpm fy migrate" primeiro.`);
  }
  return openDb(config.dbFile, { readonly: true });
}

const HOLDER_NAMES: Record<Holder, string> = { pessoa1: 'da pessoa 1', pessoa2: 'da pessoa 2' };

/** Lê duas linhas da entrada padrão, sem eco quando há terminal. */
async function readPasswordTwice(): Promise<[string, string]> {
  const tty = process.stdin.isTTY === true;
  const mute = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: tty ? mute : undefined, terminal: tty });
  const lines: string[] = [];
  if (tty) process.stdout.write('Senha: ');
  for await (const line of rl) {
    lines.push(line);
    if (lines.length === 1 && tty) process.stdout.write('\nRepita a senha: ');
    if (lines.length === 2) break;
  }
  rl.close();
  if (tty) process.stdout.write('\n');
  return [lines[0] ?? '', lines[1] ?? ''];
}

const program = new Command();
program.name('fy').description('Fyminance: finanças do casal');

program
  .command('migrate')
  .description('Cria ou atualiza o banco e as categorias iniciais')
  .action(() => {
    const config = loadConfig(process.env);
    const { db, sqlite } = openWritable(config);
    try {
      const months = backfillLegacyClosings(db, config.dataDir, new Date().toISOString());
      if (months.length > 0) console.log(`Meses com relatório antigo registrados como fechados: ${months.join(', ')}`);
    } finally {
      sqlite.close();
    }
    console.log(`Banco pronto em ${config.dbFile}`);
  });

program
  .command('sync')
  .description('Sincroniza com a Pluggy, classifica e registra a execução')
  .action(async () => {
    const config = loadConfig(process.env);
    requirePluggy(config);
    const { db, sqlite } = openWritable(config);
    try {
      const report = await runSync({
        db,
        source: (connection) => createPluggySource(pluggyFor(config, connection) as NonNullable<AppConfig['pluggy']>),
        config,
        classifier: config.model === null ? null : createOpenRouterClassifier(config.model),
        now: () => new Date(),
      });
      for (const c of report.connections) {
        console.log(c.ok ? `ok     ${c.institution}: ${c.transactions} transações` : `falha  ${c.institution}: ${c.error}`);
      }
      const r = report.reclassify;
      const modelError = r.modelError === null ? '' : `; erro do modelo: ${r.modelError}`;
      console.log(
        `Classificação: ${r.classified} transações; modelo classificou ${r.modelClassified} de ${r.modelQueued} (US$ ${r.modelCostUsd.toFixed(4)})${modelError}`,
      );
      console.log(`Execução #${report.runId}: ${report.status}`);
      if (report.status === 'failed') process.exitCode = 1;
    } finally {
      sqlite.close();
    }
  });

program
  .command('reprocess')
  .description('Relê o que a Pluggy mandou e refaz a classificação a partir dos dados guardados')
  .option('--with-model', 'envia ao modelo o que ficar sem categoria')
  .option('--retry-unsure', 'com --with-model, pergunta de novo o que o modelo classificou sem certeza')
  .action(async (options: { withModel?: boolean; retryUnsure?: boolean }) => {
    const config = loadConfig(process.env);
    const { db, sqlite } = openWritable(config);
    try {
      const remapped = remapPluggyTransactions(db);
      if (remapped > 0) console.log(`Releitura da Pluggy: ${remapped} transações mudaram de descrição ou contraparte.`);
      const classifier = options.withModel === true && config.model !== null ? createOpenRouterClassifier(config.model) : null;
      const r = await reclassify({
        db,
        pipeline: config.pipeline,
        classifier,
        limits: config.model ?? undefined,
        now: () => new Date(),
        retryUnsure: options.retryUnsure === true,
      });
      console.log(
        `Classificação: ${r.classified} transações; ${r.modelQueued} para o modelo; modelo classificou ${r.modelClassified} (US$ ${r.modelCostUsd.toFixed(4)})${r.modelError === null ? '' : `; erro: ${r.modelError}`}.`,
      );
    } finally {
      sqlite.close();
    }
  });

program
  .command('status')
  .description('Últimas sincronizações, conexões e pendências')
  .action(() => {
    const config = loadConfig(process.env);
    const { db, sqlite } = openExisting(config);
    try {
      console.log(formatStatus(db, toSaoPauloDate(new Date())));
    } finally {
      sqlite.close();
    }
  });

const backup = program.command('backup').description('Backups criptografados do banco');

backup
  .command('run')
  .description('Gera o backup do dia e aplica a retenção')
  .action(async () => {
    const config = loadConfig(process.env);
    if (config.backup === null) throw new Error('Defina FYMINANCE_BACKUP_DIR e FYMINANCE_AGE_RECIPIENT.');
    const { sqlite } = openExisting(config);
    try {
      const result = await runBackup({
        sqlite,
        dataDir: config.dataDir,
        backupDir: config.backup.dir,
        today: toSaoPauloDate(new Date()),
        encrypt: ageEncrypt(config.backup.ageRecipient),
      });
      console.log(`Backup salvo em ${result.file}`);
      if (result.deleted.length > 0) console.log(`Removidos pela retenção: ${result.deleted.length}`);
    } finally {
      sqlite.close();
    }
  });

backup
  .command('restore')
  .description('Restaura um backup num diretório separado e confere a integridade')
  .requiredOption('--file <caminho>', 'arquivo .db.gz.age')
  .requiredOption('--identity <caminho>', 'chave privada do age')
  .requiredOption('--to <diretorio>', 'diretório de destino')
  .action(async (options: { file: string; identity: string; to: string }) => {
    const result = await restoreBackup({ file: options.file, targetDir: options.to, decrypt: ageDecrypt(options.identity) });
    console.log(`Restaurado em ${result.dbFile}: integridade ${result.integrity}, ${result.transactions} transações`);
    if (result.integrity !== 'ok') process.exitCode = 1;
  });

program
  .command('eval-models')
  .description('Compara modelos do OpenRouter sobre as transações já confirmadas')
  .requiredOption('--models <lista>', 'ids de modelos separados por vírgula')
  .option('--sample <n>', 'quantas transações usar', '200')
  .action(async (options: { models: string; sample: string }) => {
    const config = loadConfig(process.env);
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('Defina OPENROUTER_API_KEY.');
    const sample = Number(options.sample);
    if (!Number.isInteger(sample) || sample < 1) throw new Error('--sample precisa ser um inteiro positivo.');
    const { db, sqlite } = openExisting(config);
    try {
      const classifiers = options.models
        .split(',')
        .map((model) => model.trim())
        .filter((model) => model.length > 0)
        .map((model) => createOpenRouterClassifier({ apiKey, model }));
      console.log(formatEvaluation(await evaluateModels(db, classifiers, { sample })));
    } finally {
      sqlite.close();
    }
  });

// Os comandos da CLI ficam registrados como da pessoa 1, que é quem costuma usar o terminal.
const cliCtx = { now: () => new Date(), actor: 'pessoa1' as const };

const accountsCmd = program.command('accounts').description('Contas do livro');

accountsCmd
  .command('list')
  .description('Lista as contas, com saldo e se contam como investimento')
  .action(() => {
    const config = loadConfig(process.env);
    const { db, sqlite } = openExisting(config);
    try {
      const today = toSaoPauloDate(new Date());
      const investing = new Map(getInvestments(db, today.slice(0, 7), today).accounts.map((a) => [a.id, a.counts]));
      for (const a of getBalances(db, today).accounts) {
        const flag = investing.has(a.id) ? (investing.get(a.id) ? ' · conta como investimento' : ' · caixa') : '';
        console.log(`${a.id}  ${a.name} (${a.kind})${flag}`);
      }
    } finally {
      sqlite.close();
    }
  });

accountsCmd
  .command('investment')
  .description('Define se uma conta de investimento conta como investimento')
  .argument('<id>', 'id da conta')
  .argument('<sim|nao>', 'sim ou nao')
  .action((id: string, answer: string) => {
    if (answer !== 'sim' && answer !== 'nao') throw new Error('Responda sim ou nao.');
    const { db, sqlite } = openWritable(loadConfig(process.env));
    try {
      setCountsAsInvestment(db, id, answer === 'sim', cliCtx);
    } finally {
      sqlite.close();
    }
    console.log('Conta atualizada.');
  });

accountsCmd
  .command('window')
  .description('Define de quando até quando a conta vale no livro (troca de fonte entre arquivo e Pluggy)')
  .argument('<id>', 'id da conta')
  .option('--from <data>', 'primeiro dia que vale (AAAA-MM-DD)')
  .option('--until <data>', 'primeiro dia que não vale mais (AAAA-MM-DD)')
  .action((id: string, options: { from?: string; until?: string }) => {
    const { db, sqlite } = openWritable(loadConfig(process.env));
    try {
      setLedgerWindow(db, id, { from: options.from ?? null, until: options.until ?? null }, cliCtx);
    } finally {
      sqlite.close();
    }
    console.log('Janela da conta atualizada.');
  });

program
  .command('import')
  .description('Importa o CSV da fatura de um cartão')
  .argument('<arquivo>', 'CSV exportado pelo banco')
  .option('--bank <banco>', 'c6 ou nubank; sem a opção, descoberto pelo arquivo')
  .requiredOption('--account <id>', 'id da conta de cartão (criada se não existir)')
  .requiredOption('--name <nome>', 'nome da conta, se for criada')
  .option('--owner <titular>', 'pessoa1 ou pessoa2', 'pessoa1')
  .option('--total <valor>', 'total da fatura, se o arquivo não trouxer (1.234,56)')
  .action(async (file: string, options: { bank?: string; account: string; name: string; owner: string; total?: string }) => {
    if (options.bank !== undefined && PARSERS[options.bank] === undefined) throw new Error(`Ainda não há leitor para o banco "${options.bank}".`);
    if (!(HOLDERS as readonly string[]).includes(options.owner)) throw new Error('Use pessoa1 ou pessoa2 em --owner.');
    const config = loadConfig(process.env);
    const text = readFileSync(file, 'utf8');
    const bank = options.bank ?? detectBank(text);
    const reader = bank === null ? undefined : PARSERS[bank];
    if (reader === undefined) throw new Error(UNKNOWN_FILE);
    const statement = reader.parse(text, basename(file));
    const { db, sqlite } = openWritable(config);
    try {
      const classifier = config.model === null ? null : createOpenRouterClassifier(config.model);
      const result = await importStatement(
        { db, pipeline: config.pipeline, classifier, now: () => new Date() },
        {
          accountId: options.account,
          accountName: options.name,
          owner: options.owner as Holder,
          statement,
          ...(options.total === undefined ? {} : { totalCents: parseBRL(options.total) }),
        },
      );
      console.log(`Fatura do ${reader.label}: ${result.inserted} transações novas, ${result.skipped} já existiam.`);
    } finally {
      sqlite.close();
    }
  });

program
  .command('demo')
  .description('Cria um banco com dados inventados, para testar o app sem dados reais')
  .requiredOption('--dir <pasta>', 'pasta onde o banco de demonstração será criado')
  .action((options: { dir: string }) => {
    const file = join(options.dir, 'fyminance.db');
    if (existsSync(file)) throw new Error(`Já existe um banco em ${file}. Use outra pasta.`);
    mkdirSync(options.dir, { recursive: true });
    const { db, sqlite } = openDb(file);
    try {
      migrateDb(db);
      seedCategories(db);
      seedDemo(db, toSaoPauloDate(new Date()));
    } finally {
      sqlite.close();
    }
    console.log(`Banco de demonstração criado em ${file}. Usuários pessoa1 e pessoa2, senha demo-senha-123.`);
  });

const user = program.command('user').description('Usuários do app');

user
  .command('set-password')
  .description('Define ou troca a senha de pessoa1 ou pessoa2 (lida da entrada, sem eco)')
  .argument('<nome>', 'pessoa1 ou pessoa2')
  .action(async (name: string) => {
    if (!(HOLDERS as readonly string[]).includes(name)) throw new Error('Use pessoa1 ou pessoa2.');
    const [first, second] = await readPasswordTwice();
    if (first !== second) throw new Error('As senhas não conferem.');
    const config = loadConfig(process.env);
    const { db, sqlite } = openWritable(config);
    try {
      setUserPassword(db, name as Holder, first, new Date().toISOString());
    } finally {
      sqlite.close();
    }
    console.log(`Senha ${HOLDER_NAMES[name as Holder]} definida.`);
  });


program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
