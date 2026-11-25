import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDb, openDb } from '../db/client';
import { auditLog } from '../db/schema';
import { seedCategories } from '../db/seed';
import { categoryIdByName } from '../db/testing';
import { buildLedgerFixture } from '../queries/test-fixture';
import { CURATION_TOOLS, QUERY_TOOLS, createServer } from './server';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connect() {
  const dir = mkdtempSync(join(tmpdir(), 'fyminance-mcp-'));
  dirs.push(dir);
  const file = join(dir, 'fyminance.db');
  const writer = openDb(file);
  migrateDb(writer.db);
  seedCategories(writer.db);
  buildLedgerFixture(writer.db);
  const reader = openDb(file, { readonly: true });
  const server = createServer({
    readDb: reader.db,
    readSqlite: reader.sqlite,
    writeDb: writer.db,
    dataDir: dir,
    pipeline: { pjDocument: null, pjNamePattern: null, transferWindowDays: 3, householdDocuments: new Set() },
    now: () => new Date('2026-10-14T10:00:00.000Z'),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text: string }>;
      return { isError: result.isError === true, text: content[0]?.text ?? '' };
    } catch (error) {
      return { isError: true, text: error instanceof Error ? error.message : String(error) };
    }
  };
  return { client, call, writer, dir };
}

describe('mcp server', () => {
  it('new query tools are listed and read-only', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ['closing_status', 'goals', 'investments']) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of ['explain_divergence', 'confirm_check', 'close_month']) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint).not.toBe(true);
    }
  });

  it('answers the closing status of a month', async () => {
    const { call } = await connect();
    const result = await call('closing_status', { month: '2026-10' });
    expect(JSON.parse(result.text)).toMatchObject({ month: '2026-10', reconciliation: { reviewGroups: 2, complete: false } });
  });

  it('close_month refuses incomplete reconciliation', async () => {
    const { call } = await connect();
    expect(await call('close_month', { month: '2026-10' })).toEqual({ isError: true, text: 'A conciliação de outubro de 2026 ainda não terminou.' });
  });

  it('explain_divergence records claude as actor', async () => {
    const { call, writer } = await connect();
    expect((await call('explain_divergence', { key: 'bill:bill-2', note: 'IOF' })).isError).toBe(false);
    const last = writer.db.select().from(auditLog).all().at(-1);
    expect(JSON.parse(last?.payload ?? '{}')).toMatchObject({ actor: 'claude', key: 'bill:bill-2' });
  });

  it('save_report refuses a month that was not closed', async () => {
    const { call } = await connect();
    expect(await call('save_report', { month: '2026-10', markdown: '# Outubro' })).toEqual({
      isError: true,
      text: 'Outubro de 2026 ainda não foi fechado. Feche com close_month antes de salvar observações.',
    });
  });

  it('save_report appends observations to the generated report', async () => {
    const { call, dir } = await connect();
    expect((await call('confirm_check', { month: '2026-09', key: 'cash' })).isError).toBe(false);
    expect(JSON.parse((await call('close_month', { month: '2026-09' })).text)).toMatchObject({ alreadyClosed: false });
    await call('save_report', { month: '2026-09', markdown: '1. Primeira observação.' });
    await call('save_report', { month: '2026-09', markdown: '1. Observação revista.' });
    const report = readFileSync(join(dir, 'relatorios/2026-09.md'), 'utf8');
    expect(report).toContain('# Relatório de setembro de 2026');
    expect(report).toContain('## Observações do Claude\n\n1. Observação revista.');
    expect(report).not.toContain('Primeira observação');
  });

  it('registers the query tools as read-only and the curation tools as writers', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...QUERY_TOOLS, ...CURATION_TOOLS].sort());
    expect(tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()).toEqual([...QUERY_TOOLS].sort());
  });

  it('answers the month summary', async () => {
    const { call } = await connect();
    const result = await call('month_summary', { month: '2026-10' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ incomeCents: 900000, expenseCents: 357880, surplusCents: 542120 });
  });

  it('refuses writes through sql and rejects malformed input', async () => {
    const { call } = await connect();
    expect(await call('sql', { query: 'DELETE FROM transactions' })).toEqual({
      isError: true,
      text: 'Apenas consultas de leitura são permitidas.',
    });
    expect((await call('month_summary', { month: 'outubro' })).isError).toBe(true);
  });

  it('records a decision through curation and shows it in queries', async () => {
    const { call, writer } = await connect();
    const others = categoryIdByName(writer.db, 'Outros');

    const decided = await call('categorize', { transactionIds: ['unknown'], categoryId: others, scope: 'rule' });

    expect(decided.isError).toBe(false);
    const listed = JSON.parse((await call('transactions', { search: 'LOJA XPTO' })).text);
    expect(listed.items[0]).toMatchObject({ id: 'unknown', category: 'Outros', reviewReason: null });
    const pending = JSON.parse((await call('pending_items')).text);
    expect(pending.review.map((g: { merchantKey: string }) => g.merchantKey)).not.toContain('LOJA XPTO');
  });

  it('annotates, splits and offsets, and shows it on the transactions', async () => {
    const { call, writer } = await connect();
    const leisure = categoryIdByName(writer.db, 'Lazer');
    const gifts = categoryIdByName(writer.db, 'Presentes e doações');

    expect((await call('annotate', { transactionId: 'game', note: 'jogo e presente do sobrinho' })).isError).toBe(false);
    const split = await call('split', {
      transactionId: 'game',
      parts: [
        { amountCents: 9990, categoryId: leisure, owner: 'pessoa1' },
        { amountCents: 10000, categoryId: gifts, owner: 'casal' },
      ],
    });
    expect(split.isError).toBe(false);
    expect(JSON.parse((await call('offset', { creditId: 'prolabore', purchaseId: 'unknown', amountCents: 3300 })).text)).toEqual({ amountCents: 3300 });

    const [game] = JSON.parse((await call('transactions', { search: 'sobrinho' })).text).items;
    expect(game).toMatchObject({ id: 'game', note: 'jogo e presente do sobrinho' });
    expect(game.split.map((p: { category: string }) => p.category)).toEqual(['Lazer', 'Presentes e doações']);
    const [shop] = JSON.parse((await call('transactions', { search: 'LOJA XPTO' })).text).items;
    expect(shop.offsets).toEqual([{ transactionId: 'prolabore', amountCents: 3300 }]);
    expect(writer.db.select().from(auditLog).all().map((entry) => entry.action)).toEqual(['annotate', 'split', 'offset']);
  });

  it('asks for a target when categorizing', async () => {
    const { call } = await connect();
    expect(await call('categorize', { owner: 'casal', scope: 'rule' })).toEqual({
      isError: true,
      text: 'Informe transactionIds ou merchantKey.',
    });
  });

  it('saves and reads documents, auditing each save', async () => {
    const { call, writer } = await connect();
    await call('confirm_check', { month: '2026-09', key: 'cash' });
    await call('close_month', { month: '2026-09' });
    expect(JSON.parse((await call('save_report', { month: '2026-09', markdown: 'Observação.' })).text)).toEqual({
      path: 'relatorios/2026-09.md',
    });
    expect(JSON.parse((await call('read_document', { path: 'relatorios/2026-09.md' })).text)).toContain('## Observações do Claude\n\nObservação.');
    expect(JSON.parse((await call('save_note', { title: 'Comprar ou alugar', markdown: '# Estudo' })).text)).toEqual({
      path: 'notas/2026-10-14-comprar-ou-alugar.md',
    });
    expect(writer.db.select().from(auditLog).all().map((entry) => entry.action)).toEqual(['confirm_check', 'close_month', 'save_report', 'save_note']);
  });
});
