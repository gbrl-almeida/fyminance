import { daysBetween } from './dates';

/** Aplicação (BUY), resgate (SELL) ou outro movimento de um investimento, em centavos. */
export interface InvestmentMovement {
  id: string;
  accountId: string;
  date: string;
  type: string;
  /** Valor bruto do movimento. */
  amountCents: number;
  /** Valor líquido de IR e IOF, quando o banco informa. */
  netCents: number | null;
  quantity: number;
  /** Valor da cota no movimento. */
  unitValue: number | null;
}

export interface Redemption {
  movementId: string;
  accountId: string;
  date: string;
  /** Data da aplicação mais antiga consumida pelo resgate. */
  appliedOn: string;
  principalCents: number;
  grossCents: number;
  /** Nulos quando a conta não bate com o líquido do banco: aí só o imposto total é conhecido. */
  iofCents: number | null;
  irCents: number | null;
  taxCents: number;
  netCents: number;
}

export interface OpenApplication {
  accountId: string;
  appliedOn: string;
  principalCents: number;
}

export interface YieldResult {
  redemptions: Redemption[];
  open: OpenApplication[];
  /** Investimentos com movimentos que o cálculo não cobre. */
  incomplete: Set<string>;
}

const IOF_PCT = [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3];
const NET_TOLERANCE_CENTS = 2;

/** Alíquota regressiva do IOF sobre o rendimento, em %, pelos dias corridos desde a aplicação. */
export function iofPct(days: number): number {
  if (days >= 30) return 0;
  return IOF_PCT[Math.max(1, days) - 1] as number;
}

/** Alíquota do IR sobre o rendimento depois do IOF, em milésimos, pelo prazo da aplicação. */
export function irPerMille(days: number): number {
  if (days <= 180) return 225;
  if (days <= 360) return 200;
  if (days <= 720) return 175;
  return 150;
}

interface Lot {
  appliedOn: string;
  units: number;
  centsPerUnit: number;
}

const UNIT_EPSILON = 1e-6;

function redeem(lots: Lot[], sell: InvestmentMovement): Redemption | null {
  let remaining = sell.quantity;
  const parts: Array<{ lot: Lot; units: number }> = [];
  for (const lot of lots) {
    if (remaining <= UNIT_EPSILON) break;
    const units = Math.min(lot.units, remaining);
    if (units <= UNIT_EPSILON) continue;
    parts.push({ lot, units });
    remaining -= units;
  }
  if (remaining > UNIT_EPSILON || parts.length === 0) return null;

  let principalCents = 0;
  let grossCents = 0;
  let iofCents = 0;
  let irCents = 0;
  let allocated = 0;
  parts.forEach(({ lot, units }, index) => {
    // O valor resgatado se divide entre as aplicações na proporção das cotas; a última leva o resto do arredondamento.
    const amount = index === parts.length - 1 ? sell.amountCents - allocated : Math.round((sell.amountCents * units) / sell.quantity);
    allocated += amount;
    const principal = Math.round(units * lot.centsPerUnit);
    const gross = amount - principal;
    const days = daysBetween(lot.appliedOn, sell.date);
    const iof = gross > 0 ? Math.floor((gross * iofPct(days)) / 100) : 0;
    const ir = gross > 0 ? Math.floor(((gross - iof) * irPerMille(days)) / 1000) : 0;
    principalCents += principal;
    grossCents += gross;
    iofCents += iof;
    irCents += ir;
    lot.units -= units;
  });

  const base = { movementId: sell.id, accountId: sell.accountId, date: sell.date, appliedOn: parts[0]!.lot.appliedOn, principalCents, grossCents };
  if (sell.netCents === null) {
    return { ...base, iofCents, irCents, taxCents: iofCents + irCents, netCents: grossCents - iofCents - irCents };
  }
  // O líquido é o que o banco pagou. Se as tabelas explicam o desconto, o IOF vem delas e o IR leva o centavo de arredondamento.
  const taxCents = sell.amountCents - sell.netCents;
  const netCents = grossCents - taxCents;
  if (Math.abs(taxCents - iofCents - irCents) > NET_TOLERANCE_CENTS) return { ...base, iofCents: null, irCents: null, taxCents, netCents };
  return { ...base, iofCents, irCents: taxCents - iofCents, taxCents, netCents };
}

/** Rendimento de cada resgate e o que segue aplicado, consumindo as aplicações na ordem em que foram feitas. */
export function computeYields(movements: readonly InvestmentMovement[]): YieldResult {
  const byAccount = new Map<string, InvestmentMovement[]>();
  for (const movement of movements) {
    const list = byAccount.get(movement.accountId) ?? [];
    list.push(movement);
    byAccount.set(movement.accountId, list);
  }
  const redemptions: Redemption[] = [];
  const open: OpenApplication[] = [];
  const incomplete = new Set<string>();
  for (const [accountId, list] of byAccount) {
    // No mesmo dia, a aplicação vem antes do resgate.
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'BUY' ? -1 : 0) - (b.type === 'BUY' ? -1 : 0) || a.id.localeCompare(b.id));
    const lots: Lot[] = [];
    for (const movement of ordered) {
      if (movement.type === 'BUY') {
        if (movement.quantity <= 0) continue;
        const centsPerUnit = movement.unitValue !== null ? movement.unitValue * 100 : movement.amountCents / movement.quantity;
        lots.push({ appliedOn: movement.date, units: movement.quantity, centsPerUnit });
      } else if (movement.type === 'SELL') {
        const redemption = redeem(lots, movement);
        if (redemption === null) incomplete.add(accountId);
        else redemptions.push(redemption);
      } else {
        incomplete.add(accountId);
      }
    }
    for (const lot of lots) {
      if (lot.units > UNIT_EPSILON) open.push({ accountId, appliedOn: lot.appliedOn, principalCents: Math.round(lot.units * lot.centsPerUnit) });
    }
  }
  redemptions.sort((a, b) => a.date.localeCompare(b.date) || a.movementId.localeCompare(b.movementId));
  return { redemptions, open, incomplete };
}

const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** A taxa como o banco vende: "102% do CDI", "IPCA + 6% a.a.", "12,5% a.a.". */
export function rateLabel(info: { rate: number | null; rateType: string | null; fixedAnnualRate: number | null }): string | null {
  const type = info.rateType?.toUpperCase() ?? null;
  const fixed = info.fixedAnnualRate !== null && info.fixedAnnualRate > 0 ? info.fixedAnnualRate : null;
  if ((type === 'CDI' || type === 'SELIC') && info.rate !== null && info.rate > 0) return `${number(info.rate)}% do ${type}`;
  if (type === 'IPCA' || type === 'IGPM') return fixed === null ? type : `${type} + ${number(fixed)}% a.a.`;
  return fixed === null ? null : `${number(fixed)}% a.a.`;
}
