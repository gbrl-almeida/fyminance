import { describe, expect, it } from 'vitest';
import { syncRuns } from '../db/schema';
import { createTestDb } from '../db/testing';
import { FIXTURE_TODAY, buildLedgerFixture } from '../queries/test-fixture';
import { formatStatus } from './status';

describe('formatStatus', () => {
  it('summarizes runs, connections and pending work', () => {
    const { db } = createTestDb();
    buildLedgerFixture(db);
    db.insert(syncRuns).values({ startedAt: '2026-10-14T10:00:00.000Z', finishedAt: '2026-10-14T10:01:00.000Z', status: 'partial' }).run();

    const text = formatStatus(db, FIXTURE_TODAY);

    expect(text).toContain('#1');
    expect(text).toContain('partial');
    expect(text).toContain('C6 (pessoa1): ok');
    expect(text).toContain('Inter (pessoa2): Status no Meu Pluggy: LOGIN_ERROR.');
    expect(text).toContain('revisão: 2 transações em 2 grupos');
    expect(text).toContain('divergências de saldo: 0');
    expect(text).toContain('divergências de fatura: 1');
    expect(text).toContain('lançamentos que sumiram do banco: 1');
  });

  it('says when nothing ran yet', () => {
    const { db } = createTestDb();
    expect(formatStatus(db, FIXTURE_TODAY)).toContain('nenhuma ainda');
  });
});
