import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config';
import type { PipelineConfig } from '../core/classify';
import { monthName, toSaoPauloDate } from '../core/dates';
import { CATEGORY_KINDS, CHECK_KEYS, DIRECTIONS, NATURES, OWNERS, type CategoryKind } from '../core/types';
import { writeAudit } from '../curation/audit';
import { editCategory, listCategories, type CategoryEdit } from '../curation/categories';
import { annotate, offsetCredit, splitTransaction } from '../curation/entries';
import { categorize } from '../curation/categorize';
import { closeMonth, confirmCheck } from '../curation/closing';
import { explainDivergence } from '../curation/divergences';
import { listDocuments, readDocument, saveNote, saveReportOrObservations } from '../curation/documents';
import { deleteRule, listRules, saveRule } from '../curation/rules';
import { openDb, type Db } from '../db/client';
import { getBalances } from '../queries/balances';
import { closingRecord, getClosingStatus } from '../queries/closing';
import { getGoalsBoard } from '../queries/goals';
import { getInvestments } from '../queries/investments';
import { getUpcomingInstallments } from '../queries/installments';
import { getMonthSummary } from '../queries/month-summary';
import { getPendingItems } from '../queries/pending';
import { getSpending } from '../queries/spending';
import { runReadOnlySql } from '../queries/sql';
import { listTransactions } from '../queries/transactions';

export interface ServerDeps {
  readDb: Db;
  readSqlite: Database.Database;
  writeDb: Db;
  dataDir: string;
  pipeline: PipelineConfig;
  now: () => Date;
}

export const QUERY_TOOLS = [
  'month_summary',
  'spending',
  'transactions',
  'upcoming_installments',
  'balances',
  'pending_items',
  'sql',
  'categories',
  'rules',
  'list_documents',
  'read_document',
  'closing_status',
  'goals',
  'investments',
] as const;

export const CURATION_TOOLS = [
  'categorize',
  'annotate',
  'split',
  'offset',
  'save_rule',
  'delete_rule',
  'edit_category',
  'save_report',
  'save_note',
  'explain_divergence',
  'confirm_check',
  'close_month',
] as const;

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

async function respond(work: () => unknown): Promise<ToolResult> {
  try {
    const data = await work();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
  }
}

const CENTS =
  'Valores em centavos (inteiros). Em transações, positivo entra e negativo sai; nos totais de gasto, o gasto aparece como valor positivo.';
const month = z.string().regex(/^\d{4}-\d{2}$/).describe('Mês no formato AAAA-MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data no formato AAAA-MM-DD');
const readOnly = { readOnlyHint: true };

const SQL_HELP = [
  'Consulta SQL de leitura (SQLite) para perguntas abertas. Uma única instrução SELECT ou WITH; no máximo 500 linhas.',
  'Visões:',
  '- v_transactions: id, date (AAAA-MM-DD), month (AAAA-MM), amount_cents (positivo entra, negativo sai), description, merchant_key, status, origin (pluggy, manual, file), installment_number, installment_total, account_id, account_name, account_kind (checking, credit_card, investment, voucher), account_holder (pessoa1, pessoa2), nature (expense, income, transfer), transfer_kind (internal, bill_payment, investment), owner (casal, pessoa1, pessoa2), source, confidence, review_reason, purchase_group, category_id, category_name, parent_category_name, category_path, note (anotação do casal). Valores do banco, sem divisões nem abatimentos. Não inclui transações removidas.',
  '- v_splits: transaction_id, position, amount_cents, owner, category_id, category_path (partes de uma compra dividida; numa compra parcelada, valem para todas as parcelas).',
  '- v_offsets: credit_id, purchase_id, amount_cents, created_by, created_at (créditos que abatem compras; contam no mês da compra).',
  '- v_balances: account_id, account_name, account_kind, account_holder, as_of, balance_cents (último saldo registrado).',
  "Exemplo de gasto por categoria no mês: SELECT parent_category_name, SUM(-amount_cents) AS gasto FROM v_transactions WHERE nature = 'expense' AND month = '2026-10' GROUP BY 1 ORDER BY 2 DESC.",
  "Transferências (nature = 'transfer') não são gasto nem renda.",
].join('\n');

interface CategoryEditArgs {
  action: CategoryEdit['action'];
  id?: number;
  name?: string;
  kind?: CategoryKind;
  parentId?: number | null;
  description?: string;
}

function toCategoryEdit(args: CategoryEditArgs): CategoryEdit {
  const need = <T>(value: T | undefined, field: string): T => {
    if (value === undefined) throw new Error(`"${field}" é obrigatório para ${args.action}.`);
    return value;
  };
  switch (args.action) {
    case 'create':
      return { action: 'create', name: need(args.name, 'name'), kind: need(args.kind, 'kind'), parentId: args.parentId ?? null, description: args.description };
    case 'rename':
      return { action: 'rename', id: need(args.id, 'id'), name: need(args.name, 'name') };
    case 'describe':
      return { action: 'describe', id: need(args.id, 'id'), description: need(args.description, 'description') };
    case 'move':
      return { action: 'move', id: need(args.id, 'id'), parentId: need(args.parentId, 'parentId') };
    case 'archive':
      return { action: 'archive', id: need(args.id, 'id') };
  }
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'fyminance', version: '0.1.0' });
  const today = () => toSaoPauloDate(deps.now());
  const ctx = { pipeline: deps.pipeline, now: deps.now, actor: 'claude' as const };

  server.registerTool(
    'month_summary',
    {
      description: `Resumo de um mês: renda, gastos por categoria (com subcategorias) e por dono (casal, pessoa1, pessoa2), sobra (renda menos gastos), rendimento dos investimentos (null quando indisponível), compras parceladas novas pelo valor cheio e número de pendências de revisão. ${CENTS}`,
      inputSchema: { month },
      annotations: readOnly,
    },
    ({ month: m }) => respond(() => getMonthSummary(deps.readDb, m, today())),
  );

  server.registerTool(
    'spending',
    {
      description: `Totais de gasto num período, agrupados por mês, categoria, categoria-mãe, estabelecimento, dono ou conta. Filtrar por uma categoria-mãe inclui as subcategorias. ${CENTS}`,
      inputSchema: {
        from: date,
        to: date,
        groupBy: z.enum(['month', 'category', 'parent_category', 'merchant', 'owner', 'account']),
        categoryId: z.number().int().optional(),
        owner: z.enum(OWNERS).optional(),
        merchantKey: z.string().optional(),
        accountId: z.string().optional(),
      },
      annotations: readOnly,
    },
    (args) => respond(() => getSpending(deps.readDb, args)),
  );

  server.registerTool(
    'transactions',
    {
      description: `Lista transações (mais recentes primeiro) com filtros por período, categoria, dono, estabelecimento, conta, natureza, busca (palavras da descrição, estabelecimento, categoria ou conta; ou um valor, como "512" ou "512,40") ou só as que esperam revisão. Devolve o total e uma página (padrão 50, máximo 500). ${CENTS}`,
      inputSchema: {
        from: date.optional(),
        to: date.optional(),
        categoryId: z.number().int().optional(),
        owner: z.enum(OWNERS).optional(),
        merchantKey: z.string().optional(),
        accountId: z.string().optional(),
        nature: z.enum(NATURES).optional(),
        reviewOnly: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    (args) => respond(() => listTransactions(deps.readDb, args)),
  );

  server.registerTool(
    'upcoming_installments',
    {
      description: `Parcelas a vencer: valor já comprometido com compras parceladas em cada um dos próximos 12 meses, a partir do mês atual, e as compras ainda em andamento. ${CENTS}`,
      annotations: readOnly,
    },
    () => respond(() => getUpcomingInstallments(deps.readDb, today())),
  );

  server.registerTool(
    'balances',
    {
      description: `Saldo mais recente de cada conta e a saúde de cada conexão com o Meu Pluggy, com os problemas a resolver. ${CENTS}`,
      annotations: readOnly,
    },
    () => respond(() => getBalances(deps.readDb, today())),
  );

  server.registerTool(
    'pending_items',
    {
      description: `O que precisa de atenção: fila de revisão agrupada por estabelecimento (maior valor primeiro, com os ids das transações), divergências de saldo e de fatura, lançamentos que sumiram do banco e conexões com problema. O mês, se informado, filtra só a fila de revisão. ${CENTS}`,
      inputSchema: { month: month.optional() },
      annotations: readOnly,
    },
    ({ month: m }) => respond(() => getPendingItems(deps.readDb, { today: today(), month: m })),
  );

  server.registerTool(
    'sql',
    { description: SQL_HELP, inputSchema: { query: z.string().min(1) }, annotations: readOnly },
    ({ query }) => respond(() => runReadOnlySql(deps.readSqlite, query)),
  );

  server.registerTool(
    'categories',
    {
      description: 'Lista as categorias ativas com id, tipo (expense ou income), categoria-mãe, caminho e descrição.',
      annotations: readOnly,
    },
    () => respond(() => listCategories(deps.readDb)),
  );

  server.registerTool(
    'rules',
    {
      description:
        'Lista as regras de classificação com condições, efeitos, origem (user ou learned), caminho da categoria e quantas transações casam com cada uma.',
      annotations: readOnly,
    },
    () => respond(() => listRules(deps.readDb)),
  );

  server.registerTool(
    'list_documents',
    { description: 'Lista os relatórios mensais e as notas de decisão salvos.', annotations: readOnly },
    () => respond(() => listDocuments(deps.dataDir)),
  );

  server.registerTool(
    'read_document',
    {
      description: 'Lê um relatório (relatorios/AAAA-MM.md) ou uma nota de decisão (notas/<arquivo>.md).',
      inputSchema: { path: z.string() },
      annotations: readOnly,
    },
    ({ path }) => respond(() => readDocument(deps.dataDir, path)),
  );

  server.registerTool(
    'categorize',
    {
      description:
        'Grava uma decisão de classificação. Informe transactionIds ou merchantKey, e categoryId, owner ou ambos. scope "rule" cria uma regra para o estabelecimento (com o sentido das transações quando todas forem entradas ou todas saídas) e reclassifica o histórico; scope "only_these" decide só as transações informadas. Categoria de gasto numa entrada significa devolução e reduz aquele gasto. Nunca altera dados vindos do banco.',
      inputSchema: {
        transactionIds: z.array(z.string()).min(1).optional(),
        merchantKey: z.string().optional(),
        categoryId: z.number().int().optional(),
        owner: z.enum(OWNERS).optional(),
        scope: z.enum(['rule', 'only_these']),
      },
    },
    (args) =>
      respond(() => {
        const target =
          args.transactionIds !== undefined
            ? { transactionIds: args.transactionIds }
            : args.merchantKey !== undefined
              ? { merchantKey: args.merchantKey }
              : null;
        if (target === null) throw new Error('Informe transactionIds ou merchantKey.');
        return categorize(deps.writeDb, { target, categoryId: args.categoryId, owner: args.owner, scope: args.scope }, ctx);
      }),
  );

  server.registerTool(
    'annotate',
    {
      description:
        'Anota do que se trata uma transação ("creatina e pré-treino", "pneus do carro"). Texto vazio apaga. A anotação aparece no app, entra na busca e é lida pelo modelo ao sugerir categoria.',
      inputSchema: { transactionId: z.string(), note: z.string() },
    },
    (args) => respond(async () => (await annotate(deps.writeDb, args, ctx), { ok: true })),
  );

  server.registerTool(
    'split',
    {
      description: `Divide uma saída em partes com categoria e dono (compra da Shopee com itens de casa e de saúde). As partes precisam somar o valor da transação; lista vazia desfaz. Numa compra parcelada, a divisão vale para todas as parcelas, na mesma proporção. ${CENTS}`,
      inputSchema: {
        transactionId: z.string(),
        parts: z.array(z.object({ amountCents: z.number().int().positive(), categoryId: z.number().int(), owner: z.enum(OWNERS) })),
      },
    },
    (args) => respond(async () => (await splitTransaction(deps.writeDb, args, ctx), { ok: true })),
  );

  server.registerTool(
    'offset',
    {
      description: `Abate um crédito (estorno, ou o Pix de quem pagou de volta) numa compra. Sem amountCents, abate o quanto der; zero desfaz. O abatimento conta no mês da compra: ela passa a custar o que não voltou. Numa compra parcelada, a compra é qualquer parcela dela. ${CENTS}`,
      inputSchema: { creditId: z.string(), purchaseId: z.string(), amountCents: z.number().int().min(0).optional() },
    },
    (args) => respond(() => offsetCredit(deps.writeDb, args, ctx)),
  );

  server.registerTool(
    'save_rule',
    {
      description:
        'Cria (sem id) ou altera (com id) uma regra. Precisa de pelo menos uma condição (merchantKey, cardLast4, accountId, minCents, maxCents, direction) e um efeito (setNature, setCategoryId, setOwner). Faixas de valor usam o valor absoluto em centavos. A regra mais específica vence; no empate, a mais recente. Reclassifica o histórico.',
      inputSchema: {
        id: z.number().int().optional(),
        merchantKey: z.string().nullable().optional(),
        cardLast4: z.string().nullable().optional(),
        accountId: z.string().nullable().optional(),
        minCents: z.number().int().nullable().optional(),
        maxCents: z.number().int().nullable().optional(),
        direction: z.enum(DIRECTIONS).nullable().optional(),
        setNature: z.enum(NATURES).nullable().optional(),
        setCategoryId: z.number().int().nullable().optional(),
        setOwner: z.enum(OWNERS).nullable().optional(),
      },
    },
    (args) => respond(() => saveRule(deps.writeDb, args, ctx)),
  );

  server.registerTool(
    'delete_rule',
    { description: 'Remove uma regra e reclassifica o histórico.', inputSchema: { id: z.number().int() } },
    ({ id }) =>
      respond(async () => {
        await deleteRule(deps.writeDb, id, ctx);
        return { deleted: id };
      }),
  );

  server.registerTool(
    'edit_category',
    {
      description:
        'Cria, renomeia, descreve, move ou arquiva categorias. São só dois níveis; a categoria-mãe precisa ser de primeiro nível e do mesmo tipo. create exige name e kind; rename exige id e name; describe exige id e description; move exige id e parentId (null para virar primeiro nível); archive exige id.',
      inputSchema: {
        action: z.enum(['create', 'rename', 'describe', 'move', 'archive']),
        id: z.number().int().optional(),
        name: z.string().optional(),
        kind: z.enum(CATEGORY_KINDS).optional(),
        parentId: z.number().int().nullable().optional(),
        description: z.string().optional(),
      },
    },
    (args) => respond(() => editCategory(deps.writeDb, toCategoryEdit(args), ctx)),
  );

  server.registerTool(
    'save_report',
    {
      description:
        'Salva as observações do Claude no relatório de um mês já fechado (relatorios/AAAA-MM.md): o texto vira a seção "Observações do Claude", substituindo observações anteriores. Mês ainda aberto é recusado: feche antes com close_month.',
      inputSchema: { month, markdown: z.string().min(1) },
    },
    ({ month: m, markdown }) =>
      respond(() => {
        if (closingRecord(deps.readDb, m) === null) {
          const name = monthName(m);
          throw new Error(`${name.charAt(0).toUpperCase()}${name.slice(1)} ainda não foi fechado. Feche com close_month antes de salvar observações.`);
        }
        const path = saveReportOrObservations(deps.dataDir, m, markdown);
        writeAudit(deps.writeDb, 'save_report', { path }, deps.now().toISOString(), 'claude');
        return { path };
      }),
  );

  server.registerTool(
    'save_note',
    {
      description: 'Salva uma nota de decisão em markdown (por exemplo, um estudo de comprar ou alugar) em notas/AAAA-MM-DD-<título>.md.',
      inputSchema: { title: z.string().min(1), markdown: z.string().min(1) },
    },
    ({ title, markdown }) =>
      respond(() => {
        const path = saveNote(deps.dataDir, title, markdown, today());
        writeAudit(deps.writeDb, 'save_note', { path }, deps.now().toISOString(), 'claude');
        return { path };
      }),
  );

  server.registerTool(
    'closing_status',
    {
      description:
        'Estado do fechamento de um mês: passos (data, reconciliation, goals, investments: done, pending ou attention), fila de revisão, divergências sem explicação, vale-alimentação e dinheiro conferidos, se a conciliação está completa e se o mês já foi fechado.',
      inputSchema: { month },
      annotations: readOnly,
    },
    ({ month: m }) => respond(() => getClosingStatus(deps.readDb, m, today(), deps.dataDir)),
  );

  server.registerTool(
    'goals',
    {
      description: `Metas do mês seguinte ao que fecha: por categoria, média dos 3 últimos meses (incluindo o que fecha), gasto do mês, sugestão (média mais anotações), meta salva e nota; anotações do mês seguinte; renda esperada, soma das metas, quanto deve sobrar e o que já está comprometido. Metas e anotações são definidas no app. ${CENTS}`,
      inputSchema: { closingMonth: month },
      annotations: readOnly,
    },
    ({ closingMonth }) => respond(() => getGoalsBoard(deps.readDb, closingMonth, today())),
  );

  server.registerTool(
    'investments',
    {
      description: `Investimentos de um mês: total investido, rendimento (R$ e fração), aportes e resgates, meta de aporte, sobra do mês, as contas de investimento (com "counts": se contam como investimento) e "redemptions": rendimento dos resgates de todas as contas de investimento, inclusive as que são caixa (bruto, IOF, IR, imposto e líquido no mês e no ano; resgates do mês e aplicações abertas com nome e taxa). ${CENTS}`,
      inputSchema: { month },
      annotations: readOnly,
    },
    ({ month: m }) => respond(() => getInvestments(deps.readDb, m, today())),
  );

  server.registerTool(
    'explain_divergence',
    {
      description: 'Marca uma divergência das conferências como explicada, com uma nota. Use a "key" que pending_items devolve (bill:… ou balance:…).',
      inputSchema: { key: z.string().min(1), note: z.string() },
    },
    ({ key, note }) =>
      respond(() => {
        explainDivergence(deps.writeDb, key, note, ctx);
        return { ok: true };
      }),
  );

  server.registerTool(
    'confirm_check',
    {
      description: 'Confirma um item do fechamento do mês: flash (valor do vale-alimentação conferido), cash (dinheiro vivo conferido ou nada no mês), goals ou investments.',
      inputSchema: { month, key: z.enum(CHECK_KEYS), note: z.string().optional() },
    },
    ({ month: m, key, note }) =>
      respond(() => {
        confirmCheck(deps.writeDb, m, key, ctx, note);
        return { ok: true };
      }),
  );

  server.registerTool(
    'close_month',
    {
      description:
        'Fecha o mês como o app: exige a conciliação completa, gera e salva o relatório e guarda o retrato dos números. Fechar um mês já fechado não regrava nada. Depois, use save_report para acrescentar as observações.',
      inputSchema: { month },
    },
    ({ month: m }) => respond(() => closeMonth(deps.writeDb, m, deps.dataDir, today(), ctx)),
  );

  return server;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (!existsSync(config.dbFile)) {
    console.error(`Banco não encontrado em ${config.dbFile}. Rode "pnpm fy migrate" ou "pnpm fy sync" primeiro.`);
    process.exit(1);
  }
  const reader = openDb(config.dbFile, { readonly: true });
  const writer = openDb(config.dbFile);
  const server = createServer({
    readDb: reader.db,
    readSqlite: reader.sqlite,
    writeDb: writer.db,
    dataDir: config.dataDir,
    pipeline: config.pipeline,
    now: () => new Date(),
  });
  await server.connect(new StdioServerTransport());
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
