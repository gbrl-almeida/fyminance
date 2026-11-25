import { daysBetween, toSaoPauloDate } from '../core/dates';
import type { AccountKind, Holder } from '../core/types';
import type { Db } from '../db/client';
import { accounts, connections } from '../db/schema';

const HEALTHY_STATUSES = new Set(['UPDATED', 'UPDATING', 'unknown']);
const STALE_DAYS = 3;
const CONSENT_WARNING_DAYS = 30;

export interface ConnectionHealth {
  id: string;
  institution: string;
  owner: Holder;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  consentExpiresAt: string | null;
  problems: string[];
}

export interface Balances {
  accounts: Array<{ id: string; name: string; kind: AccountKind; holder: Holder; balanceCents: number | null; asOf: string | null }>;
  connections: ConnectionHealth[];
}

export function getBalances(db: Db, today: string): Balances {
  const latest = new Map(
    (
      db.$client.prepare('SELECT account_id, as_of, balance_cents FROM v_balances').all() as Array<{
        account_id: string;
        as_of: string;
        balance_cents: number;
      }>
    ).map((row) => [row.account_id, row]),
  );
  const accountList = db
    .select()
    .from(accounts)
    .orderBy(accounts.id)
    .all()
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      holder: a.owner,
      balanceCents: latest.get(a.id)?.balance_cents ?? null,
      asOf: latest.get(a.id)?.as_of ?? null,
    }));

  const connectionList = db
    .select()
    .from(connections)
    .orderBy(connections.id)
    .all()
    .map((c) => {
      const problems: string[] = [];
      if (c.lastError !== null) problems.push(`Erro na última sincronização: ${c.lastError}`);
      if (!HEALTHY_STATUSES.has(c.status)) {
        problems.push(`Status no Meu Pluggy: ${c.status}. Reconectar ${c.institution} no Meu Pluggy.`);
      }
      if (c.lastSuccessAt === null) {
        problems.push('Nunca sincronizou com sucesso.');
      } else {
        const days = daysBetween(toSaoPauloDate(new Date(c.lastSuccessAt)), today);
        if (days > STALE_DAYS) problems.push(`Sem sincronizar há ${days} dias.`);
      }
      if (c.consentExpiresAt !== null) {
        const expires = c.consentExpiresAt.slice(0, 10);
        if (daysBetween(today, expires) <= CONSENT_WARNING_DAYS) {
          problems.push(`Consentimento vence em ${expires}. Renovar no Meu Pluggy.`);
        }
      }
      return {
        id: c.id,
        institution: c.institution,
        owner: c.owner,
        status: c.status,
        lastSuccessAt: c.lastSuccessAt,
        lastError: c.lastError,
        consentExpiresAt: c.consentExpiresAt,
        problems,
      };
    });

  return { accounts: accountList, connections: connectionList };
}
