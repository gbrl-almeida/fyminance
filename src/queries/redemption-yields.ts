import { eq, lte } from 'drizzle-orm';
import { lastDayOfMonth, monthOf } from '../core/dates';
import { computeYields, rateLabel, type Redemption } from '../core/investment-yields';
import type { Db } from '../db/client';
import { accounts, investmentMovements } from '../db/schema';
import { balanceAt } from './yield';

export interface YieldTotals {
  count: number;
  grossCents: number;
  /** IOF e IR somam só os resgates em que a conta bate com o banco; `unsplit` conta os outros. */
  iofCents: number;
  irCents: number;
  taxCents: number;
  netCents: number;
  taxPct: number | null;
  unsplit: number;
}

export interface RedeemedRow extends Omit<Redemption, 'movementId'> {
  kind: 'redeemed';
  account: string;
  rate: string | null;
}

export interface OpenRow {
  kind: 'open';
  accountId: string;
  account: string;
  rate: string | null;
  appliedOn: string;
  principalCents: number;
  /** Rendimento bruto acumulado até a data, sem imposto; nulo sem saldo registrado. */
  accruedCents: number | null;
}

export interface RedemptionYields {
  month: YieldTotals;
  year: YieldTotals;
  rows: Array<RedeemedRow | OpenRow>;
  incomplete: string[];
}

function totals(list: readonly Redemption[]): YieldTotals {
  const sum = (pick: (r: Redemption) => number) => list.reduce((acc, r) => acc + pick(r), 0);
  const grossCents = sum((r) => r.grossCents);
  const taxCents = sum((r) => r.taxCents);
  return {
    count: list.length,
    grossCents,
    iofCents: sum((r) => r.iofCents ?? 0),
    irCents: sum((r) => r.irCents ?? 0),
    taxCents,
    netCents: sum((r) => r.netCents),
    taxPct: grossCents > 0 ? taxCents / grossCents : null,
    unsplit: list.filter((r) => r.iofCents === null).length,
  };
}

function readRate(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { rate?: number | null; rateType?: string | null; fixedAnnualRate?: number | null };
    return rateLabel({ rate: data.rate ?? null, rateType: data.rateType ?? null, fixedAnnualRate: data.fixedAnnualRate ?? null });
  } catch {
    return null;
  }
}

/** Rendimento dos resgates do mês e do ano, e o que seguia aplicado no fim do mês (hoje, no mês corrente). */
export function getRedemptionYields(db: Db, month: string, today: string): RedemptionYields {
  const cutoff = month === monthOf(today) ? today : lastDayOfMonth(month);
  const investmentAccounts = db
    .select({ id: accounts.id, name: accounts.name, raw: accounts.raw })
    .from(accounts)
    .where(eq(accounts.kind, 'investment'))
    .all();
  const info = new Map(investmentAccounts.map((a) => [a.id, { name: a.name, rate: readRate(a.raw) }]));
  const movements = db
    .select()
    .from(investmentMovements)
    .where(lte(investmentMovements.date, cutoff))
    .all()
    .filter((m) => info.has(m.accountId));
  const { redemptions, open, incomplete } = computeYields(movements);

  const year = `${month.slice(0, 4)}-01-01`;
  const inMonth = redemptions.filter((r) => monthOf(r.date) === month);
  const inYear = redemptions.filter((r) => r.date >= year);

  const rows: RedemptionYields['rows'] = inMonth.map(({ movementId: _id, ...r }) => ({
    kind: 'redeemed' as const,
    ...r,
    account: info.get(r.accountId)?.name ?? r.accountId,
    rate: info.get(r.accountId)?.rate ?? null,
  }));
  const openByAccount = new Map<string, { appliedOn: string; principalCents: number }>();
  for (const lot of open) {
    const current = openByAccount.get(lot.accountId);
    openByAccount.set(lot.accountId, {
      appliedOn: current === undefined || lot.appliedOn < current.appliedOn ? lot.appliedOn : current.appliedOn,
      principalCents: (current?.principalCents ?? 0) + lot.principalCents,
    });
  }
  for (const [accountId, position] of [...openByAccount].sort((a, b) => a[1].appliedOn.localeCompare(b[1].appliedOn))) {
    const balance = balanceAt(db, accountId, cutoff);
    rows.push({
      kind: 'open',
      accountId,
      account: info.get(accountId)?.name ?? accountId,
      rate: info.get(accountId)?.rate ?? null,
      ...position,
      accruedCents: balance === null ? null : balance - position.principalCents,
    });
  }

  return {
    month: totals(inMonth),
    year: totals(inYear),
    rows,
    incomplete: [...incomplete].map((id) => info.get(id)?.name ?? id).sort(),
  };
}
