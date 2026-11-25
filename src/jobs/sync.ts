import { and, desc, eq, gte } from 'drizzle-orm';
import type { AppConfig, ConnectionConfig } from '../config';
import { addDays, toSaoPauloDate } from '../core/dates';
import { inTransaction, type Db } from '../db/client';
import {
  accounts,
  balanceSnapshots,
  bills,
  classifications,
  connections,
  investmentMovements,
  offsets,
  syncRuns,
  transactionNotes,
  transactionSplits,
  transactions,
} from '../db/schema';
import type { Classifier } from '../integrations/openrouter/classifier';
import {
  mapAccount,
  mapBill,
  mapInvestment,
  mapInvestmentMovement,
  mapItem,
  mapTransaction,
  type AccountRow,
  type BillRow,
  type MappedAccount,
  type MovementRow,
  type TransactionInput,
} from '../integrations/pluggy/map';
import type { PluggySource } from '../integrations/pluggy/source';
import { reclassify, type ReclassifyReport } from './reclassify';
import { ensureVoucher } from './voucher';

export interface SyncDeps {
  db: Db;
  /** Uma fonte para todas as conexões, ou uma por conexão (cada titular tem o seu Meu Pluggy). */
  source: PluggySource | ((connection: ConnectionConfig) => PluggySource);
  config: AppConfig;
  classifier: Classifier | null;
  now: () => Date;
}

export interface ConnectionOutcome {
  itemId: string;
  institution: string;
  ok: boolean;
  error: string | null;
  transactions: number;
}

export interface SyncReport {
  runId: number;
  status: 'ok' | 'partial' | 'failed';
  connections: ConnectionOutcome[];
  reclassify: ReclassifyReport;
}

interface FetchedAccount {
  mapped: MappedAccount;
  transactions: TransactionInput[];
  bills: BillRow[];
}

interface FetchedInvestment {
  mapped: MappedAccount;
  movements: MovementRow[];
}

interface FetchedConnection {
  status: string;
  consentExpiresAt: string | null;
  accounts: FetchedAccount[];
  investments: FetchedInvestment[];
}

const HISTORY_DAYS = 365;
const OVERLAP_DAYS = 10;
const STALE_RUN_MS = 30 * 60 * 1000;
const CARD_SIGN_MIN_TXS = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function claimRun(db: Db, now: Date): number {
  return inTransaction(db, () => {
    for (const run of db.select().from(syncRuns).where(eq(syncRuns.status, 'running')).all()) {
      if (now.getTime() - Date.parse(run.startedAt) < STALE_RUN_MS) {
        throw new Error(`Já existe uma sincronização em andamento (#${run.id}, iniciada em ${run.startedAt}).`);
      }
      db.update(syncRuns)
        .set({ status: 'failed', finishedAt: now.toISOString(), errors: JSON.stringify([{ error: 'Execução interrompida' }]) })
        .where(eq(syncRuns.id, run.id))
        .run();
    }
    return Number(db.insert(syncRuns).values({ startedAt: now.toISOString(), status: 'running' }).run().lastInsertRowid);
  });
}

function windowStart(db: Db, itemId: string, today: string): string {
  const row = db.select({ lastSuccessAt: connections.lastSuccessAt }).from(connections).where(eq(connections.id, itemId)).get();
  if (row?.lastSuccessAt == null) return addDays(today, -HISTORY_DAYS);
  return addDays(toSaoPauloDate(new Date(row.lastSuccessAt)), -OVERLAP_DAYS);
}

// No cartão, compras são a maioria dos lançamentos. Se a maioria chega como entrada, a convenção de sinal
// da Pluggy não é a que o mapeamento supõe: melhor recusar a conexão do que somar gasto como renda.
function assertCardSign(accountName: string, txs: readonly TransactionInput[]): void {
  const inflows = txs.filter((tx) => tx.amountCents > 0).length;
  if (txs.length >= CARD_SIGN_MIN_TXS && inflows * 2 > txs.length) {
    throw new Error(
      `Sinal suspeito no cartão ${accountName}: ${inflows} de ${txs.length} lançamentos chegaram como entrada. ` +
        'Confira a convenção de sinal da Pluggy antes de importar.',
    );
  }
}

async function fetchConnection(source: PluggySource, connection: ConnectionConfig, since: string): Promise<FetchedConnection> {
  const item = mapItem(await source.fetchItem(connection.itemId));
  const fetched: FetchedAccount[] = [];
  for (const raw of await source.fetchAccounts(connection.itemId)) {
    const mapped = mapAccount(raw, connection);
    const txs = (await source.fetchTransactions(mapped.account.id, since)).map(mapTransaction);
    if (mapped.account.kind === 'credit_card') assertCardSign(mapped.account.name, txs);
    const accountBills =
      mapped.account.kind === 'credit_card'
        ? (await source.fetchBills(mapped.account.id)).map((bill) => mapBill(bill, mapped.account.id))
        : [];
    fetched.push({ mapped, transactions: txs, bills: accountBills });
  }
  const investments: FetchedInvestment[] = [];
  for (const raw of await source.fetchInvestments(connection.itemId)) {
    const mapped = mapInvestment(raw, connection);
    const movements = (await source.fetchInvestmentMovements(mapped.account.id)).map((m) => mapInvestmentMovement(m, mapped.account.id));
    investments.push({ mapped, movements });
  }
  return { ...item, accounts: fetched, investments };
}

function upsertConnection(db: Db, connection: ConnectionConfig, fields: Partial<typeof connections.$inferInsert>): void {
  const identity = { owner: connection.owner, institution: connection.institution };
  db.insert(connections)
    .values({ id: connection.itemId, ...identity, ...fields })
    .onConflictDoUpdate({ target: connections.id, set: { ...identity, ...fields } })
    .run();
}

function upsertAccount(db: Db, account: AccountRow): void {
  db.insert(accounts)
    .values(account)
    .onConflictDoUpdate({
      target: accounts.id,
      set: { name: account.name, kind: account.kind, owner: account.owner, connectionId: account.connectionId, raw: account.raw },
    })
    .run();
}

function insertSnapshot(db: Db, accountId: string, balanceCents: number, today: string, nowIso: string): void {
  db.insert(balanceSnapshots).values({ accountId, balanceCents, date: today, takenAt: nowIso }).run();
}

// Uma posição que some de uma sincronização bem-sucedida foi resgatada: o saldo dela passa a zero.
function zeroVanishedInvestments(db: Db, itemId: string, returned: ReadonlySet<string>, today: string, nowIso: string): void {
  const known = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.connectionId, itemId), eq(accounts.kind, 'investment')))
    .all();
  for (const { id } of known) {
    if (returned.has(id)) continue;
    const last = db
      .select({ cents: balanceSnapshots.balanceCents })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, id))
      .orderBy(desc(balanceSnapshots.date), desc(balanceSnapshots.takenAt))
      .limit(1)
      .get();
    if (last !== undefined && last.cents !== 0) insertSnapshot(db, id, 0, today, nowIso);
  }
}

function upsertTransactions(db: Db, rows: readonly TransactionInput[], nowIso: string): void {
  for (const row of rows) {
    const { id: _id, ...provider } = row;
    db.insert(transactions)
      .values({ ...row, firstSeenAt: nowIso, updatedAt: nowIso, missingSince: null })
      .onConflictDoUpdate({ target: transactions.id, set: { ...provider, updatedAt: nowIso, missingSince: null } })
      .run();
  }
}

function upsertMovements(db: Db, rows: readonly MovementRow[], nowIso: string): void {
  for (const row of rows) {
    const { id: _id, ...provider } = row;
    db.insert(investmentMovements)
      .values({ ...row, firstSeenAt: nowIso, updatedAt: nowIso })
      .onConflictDoUpdate({ target: investmentMovements.id, set: { ...provider, updatedAt: nowIso } })
      .run();
  }
}

/** Some da sincronização: pendente vira removida e lançada fica marcada como sumida. Devolve as pendentes removidas. */
function markDisappeared(db: Db, accountId: string, since: string, returned: ReadonlySet<string>, today: string): string[] {
  const removed: string[] = [];
  const inWindow = db
    .select({ id: transactions.id, status: transactions.status, missingSince: transactions.missingSince })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), gte(transactions.date, since)))
    .all();
  for (const row of inWindow) {
    if (returned.has(row.id)) continue;
    if (row.status === 'pending') {
      db.update(transactions).set({ status: 'removed' }).where(eq(transactions.id, row.id)).run();
      removed.push(row.id);
    } else if (row.status === 'posted' && row.missingSince === null) {
      db.update(transactions).set({ missingSince: today }).where(eq(transactions.id, row.id)).run();
    }
  }
  return removed;
}

const CARRY_DAYS = 10;

/**
 * A Pluggy às vezes apaga a compra pendente e manda a lançada com outro id. O que o casal acrescentou à
 * pendente (decisão manual, anotação, divisão e abatimentos) passa para a lançada: mesma conta, mesmo
 * valor, mesmo estabelecimento, até 10 dias depois, e sem nada acrescentado ainda.
 */
function carryUserData(db: Db, accountId: string, removedIds: readonly string[]): void {
  if (removedIds.length === 0) return;
  const rows = db.select().from(transactions).where(eq(transactions.accountId, accountId)).all();
  const manual = new Map(
    db.select().from(classifications).where(eq(classifications.source, 'manual')).all().map((c) => [c.transactionId, c]),
  );
  const noted = new Set(db.select({ id: transactionNotes.transactionId }).from(transactionNotes).all().map((n) => n.id));
  const split = new Set(db.select({ id: transactionSplits.transactionId }).from(transactionSplits).all().map((p) => p.id));
  const linked = new Set(db.select().from(offsets).all().flatMap((o) => [o.creditId, o.purchaseId]));
  const hasData = (id: string) => manual.has(id) || noted.has(id) || split.has(id) || linked.has(id);
  const taken = new Set<string>();
  for (const oldId of removedIds) {
    const old = rows.find((r) => r.id === oldId);
    if (old === undefined || !hasData(oldId)) continue;
    const next = rows.find(
      (r) =>
        r.id !== oldId &&
        r.status !== 'removed' &&
        !removedIds.includes(r.id) &&
        !taken.has(r.id) &&
        !hasData(r.id) &&
        r.amountCents === old.amountCents &&
        r.merchantKey === old.merchantKey &&
        r.date >= old.date &&
        r.date <= addDays(old.date, CARRY_DAYS),
    );
    if (next === undefined) continue;
    taken.add(next.id);
    const decision = manual.get(oldId);
    if (decision !== undefined) {
      const values = { ...decision, transactionId: next.id };
      db.insert(classifications).values(values).onConflictDoUpdate({ target: classifications.transactionId, set: values }).run();
    }
    db.update(transactionNotes).set({ transactionId: next.id }).where(eq(transactionNotes.transactionId, oldId)).run();
    db.update(transactionSplits).set({ transactionId: next.id }).where(eq(transactionSplits.transactionId, oldId)).run();
    db.update(offsets).set({ creditId: next.id }).where(eq(offsets.creditId, oldId)).run();
    db.update(offsets).set({ purchaseId: next.id }).where(eq(offsets.purchaseId, oldId)).run();
  }
}

function upsertBills(db: Db, rows: readonly BillRow[]): void {
  for (const bill of rows) {
    db.insert(bills)
      .values(bill)
      .onConflictDoUpdate({ target: bills.id, set: { dueDate: bill.dueDate, totalCents: bill.totalCents, raw: bill.raw } })
      .run();
  }
}

async function syncConnection(deps: SyncDeps, connection: ConnectionConfig, today: string): Promise<ConnectionOutcome> {
  const { db, source, now } = deps;
  const since = windowStart(db, connection.itemId, today);
  const identity = { itemId: connection.itemId, institution: connection.institution };
  try {
    const fetched = await fetchConnection(typeof source === 'function' ? source(connection) : source, connection, since);
    const nowIso = now().toISOString();
    let count = 0;
    inTransaction(db, () => {
      for (const account of fetched.accounts) {
        const accountId = account.mapped.account.id;
        upsertAccount(db, account.mapped.account);
        insertSnapshot(db, accountId, account.mapped.balanceCents, today, nowIso);
        upsertTransactions(db, account.transactions, nowIso);
        const removed = markDisappeared(db, accountId, since, new Set(account.transactions.map((tx) => tx.id)), today);
        carryUserData(db, accountId, removed);
        upsertBills(db, account.bills);
        count += account.transactions.length;
      }
      for (const { mapped, movements } of fetched.investments) {
        upsertAccount(db, mapped.account);
        insertSnapshot(db, mapped.account.id, mapped.balanceCents, today, nowIso);
        upsertMovements(db, movements, nowIso);
      }
      zeroVanishedInvestments(db, connection.itemId, new Set(fetched.investments.map((i) => i.mapped.account.id)), today, nowIso);
      upsertConnection(db, connection, {
        status: fetched.status,
        consentExpiresAt: fetched.consentExpiresAt,
        lastSyncAt: nowIso,
        // Só avança a janela quando o banco está atualizado; senão a reconexão perderia o intervalo parado.
        ...(fetched.status === 'UPDATED' ? { lastSuccessAt: nowIso } : {}),
        lastError: null,
      });
    });
    return { ...identity, ok: true, error: null, transactions: count };
  } catch (error) {
    const message = errorMessage(error);
    upsertConnection(db, connection, { lastSyncAt: now().toISOString(), lastError: message });
    return { ...identity, ok: false, error: message, transactions: 0 };
  }
}

export async function runSync(deps: SyncDeps): Promise<SyncReport> {
  const { db, config, now } = deps;
  const runId = claimRun(db, now());
  const today = toSaoPauloDate(now());
  const outcomes: ConnectionOutcome[] = [];
  let reclassifyReport: ReclassifyReport;
  try {
    for (const connection of config.connections) outcomes.push(await syncConnection(deps, connection, today));
    if (config.voucherMonthlyCents !== null) {
      ensureVoucher(db, { monthlyCents: config.voucherMonthlyCents, today, nowIso: now().toISOString() });
    }
    reclassifyReport = await reclassify({
      db,
      pipeline: config.pipeline,
      classifier: deps.classifier,
      limits: config.model ?? undefined,
      now,
    });
  } catch (error) {
    db.update(syncRuns)
      .set({ status: 'failed', finishedAt: now().toISOString(), errors: JSON.stringify([{ error: errorMessage(error) }]) })
      .where(eq(syncRuns.id, runId))
      .run();
    throw error;
  }
  const okCount = outcomes.filter((o) => o.ok).length;
  const status: SyncReport['status'] = okCount === outcomes.length ? 'ok' : okCount === 0 ? 'failed' : 'partial';
  db.update(syncRuns)
    .set({
      status,
      finishedAt: now().toISOString(),
      stats: JSON.stringify({ connections: outcomes, reclassify: reclassifyReport }),
      errors: JSON.stringify(outcomes.filter((o) => !o.ok).map((o) => ({ itemId: o.itemId, error: o.error }))),
    })
    .where(eq(syncRuns.id, runId))
    .run();
  return { runId, status, connections: outcomes, reclassify: reclassifyReport };
}
