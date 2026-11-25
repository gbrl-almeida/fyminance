import { purchaseGroupKey } from './installments';
import type { LedgerRow } from './summary';
import type { Owner, Tx } from './types';

/** Parte de uma saída dividida em categorias. */
export interface SplitPart {
  transactionId: string;
  position: number;
  amountCents: number;
  categoryId: number;
  owner: Owner;
}

/** Crédito (estorno ou reembolso) que abate uma compra. */
export interface Offset {
  creditId: string;
  purchaseId: string;
  amountCents: number;
}

/** Uma compra parcelada é uma unidade só: todas as parcelas da mesma compra. */
export const purchaseUnitKey = (tx: Tx): string => purchaseGroupKey(tx) ?? tx.id;
const unitKey = purchaseUnitKey;

const counts = (row: LedgerRow): boolean => row.cls !== null && row.cls.nature !== 'transfer';

/** Quanto uma compra pode receber de abatimento: o valor inteiro, contando as parcelas que ainda vão chegar. */
export function purchaseCapacityCents(tx: Tx, txs: readonly Tx[]): number {
  const key = purchaseGroupKey(tx);
  if (key === null || tx.installmentTotal === null) return -tx.amountCents;
  const members = txs.filter((t) => t.id !== tx.id && t.status !== 'removed' && purchaseGroupKey(t) === key);
  members.push(tx);
  const seen = members.reduce((sum, m) => sum - m.amountCents, 0);
  return seen + Math.max(0, tx.installmentTotal - members.length) * -tx.amountCents;
}

/** Divide `total` na proporção dos pesos; a última parte leva o resto do arredondamento. */
function share(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(0, total - given);
    const value = sum === 0 ? 0 : Math.round((total * weight) / sum);
    given += value;
    return value;
  });
}

/**
 * Aplica divisões e abatimentos às linhas do razão. O abatimento conta no mês da compra: a compra
 * passa a custar o que não voltou, e a parte abatida do crédito sai do mês em que ele entrou. Numa
 * compra parcelada, o abatimento é consumido parcela por parcela, na ordem, e a divisão vale para todas.
 */
export function adjustLedger(rows: readonly LedgerRow[], splits: readonly SplitPart[], offsets: readonly Offset[]): LedgerRow[] {
  const byId = new Map(rows.map((r) => [r.tx.id, r]));
  const units = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (r.tx.amountCents >= 0 || !counts(r)) continue;
    const key = unitKey(r.tx);
    units.set(key, [...(units.get(key) ?? []), r]);
  }
  for (const list of units.values()) {
    list.sort((a, b) => (a.tx.installmentNumber ?? 0) - (b.tx.installmentNumber ?? 0) || a.tx.date.localeCompare(b.tx.date) || a.tx.id.localeCompare(b.tx.id));
  }

  const taken = new Map<string, number>();
  const unitOffset = new Map<string, number>();
  for (const offset of offsets) {
    const credit = byId.get(offset.creditId);
    const purchase = byId.get(offset.purchaseId);
    if (credit === undefined || purchase === undefined || !counts(credit) || !counts(purchase)) continue;
    if (credit.tx.amountCents <= 0 || purchase.tx.amountCents >= 0) continue;
    taken.set(offset.creditId, (taken.get(offset.creditId) ?? 0) + offset.amountCents);
    const key = unitKey(purchase.tx);
    unitOffset.set(key, (unitOffset.get(key) ?? 0) + offset.amountCents);
  }
  const reduction = new Map<string, number>();
  for (const [key, total] of unitOffset) {
    let left = total;
    for (const member of units.get(key) ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, -member.tx.amountCents);
      reduction.set(member.tx.id, take);
      left -= take;
    }
  }

  const partsById = new Map<string, SplitPart[]>();
  for (const part of splits) partsById.set(part.transactionId, [...(partsById.get(part.transactionId) ?? []), part]);
  const unitParts = new Map<string, SplitPart[]>();
  for (const [id, parts] of partsById) {
    parts.sort((a, b) => a.position - b.position);
    const anchor = byId.get(id);
    if (anchor === undefined || anchor.tx.amountCents >= 0 || !counts(anchor)) continue;
    const key = unitKey(anchor.tx);
    if (!unitParts.has(key)) unitParts.set(key, parts);
  }

  const result: LedgerRow[] = [];
  for (const r of rows) {
    const bank = r.tx.amountCents;
    if (!counts(r) || bank === 0) {
      result.push(r);
      continue;
    }
    if (bank > 0) {
      const out = taken.get(r.tx.id) ?? 0;
      if (out === 0) result.push(r);
      else if (bank > out) result.push({ ...r, tx: { ...r.tx, amountCents: bank - out }, adjustment: { bankCents: bank, offsetCents: out, part: null } });
      continue;
    }
    const offsetCents = reduction.get(r.tx.id) ?? 0;
    const amount = bank + offsetCents;
    if (amount === 0) continue;
    const parts = partsById.get(r.tx.id) ?? unitParts.get(unitKey(r.tx));
    if (parts === undefined) {
      result.push(offsetCents === 0 ? r : { ...r, tx: { ...r.tx, amountCents: amount }, adjustment: { bankCents: bank, offsetCents, part: null } });
      continue;
    }
    const cls = r.cls as NonNullable<LedgerRow['cls']>;
    const shares = share(-amount, parts.map((p) => p.amountCents));
    parts.forEach((part, index) => {
      const cents = shares[index] as number;
      if (cents === 0) return;
      result.push({
        tx: { ...r.tx, amountCents: -cents },
        cls: { ...cls, nature: 'expense', categoryId: part.categoryId, owner: part.owner, reviewReason: null },
        adjustment: { bankCents: bank, offsetCents, part: { index, count: parts.length } },
      });
    });
  }
  return result;
}
