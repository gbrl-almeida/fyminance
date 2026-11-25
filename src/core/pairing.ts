import { daysBetween } from './dates';
import { isCardBillPayment } from './nature';
import type { AccountKind, TransferKind, Tx } from './types';

export interface TransferPair {
  pairId: string;
  kind: TransferKind;
}

export interface PairingOptions {
  windowDays: number;
  householdDocuments: ReadonlySet<string>;
}

export function transferKindFor(a: AccountKind, b: AccountKind): TransferKind {
  if (a === 'credit_card' || b === 'credit_card') return 'bill_payment';
  if (a === 'investment' || b === 'investment') return 'investment';
  return 'internal';
}

function canBeOwnTransfer(tx: Tx, household: ReadonlySet<string>): boolean {
  return tx.counterpartDoc === null || household.has(tx.counterpartDoc);
}

function canPair(out: Tx, inflow: Tx, household: ReadonlySet<string>): boolean {
  if (inflow.accountKind === 'credit_card') {
    // Um Pix para um CPF cai numa conta, nunca no cartão.
    if (out.counterpartDocType === 'cpf') return false;
    // A fatura paga com saldo da conta tem o banco emissor (um CNPJ) como contraparte.
    return out.counterpartDoc === null || isCardBillPayment(inflow);
  }
  return canBeOwnTransfer(out, household);
}

export function pairTransfers(txs: readonly Tx[], options: PairingOptions): Map<string, TransferPair> {
  const eligible = txs.filter(
    (tx) =>
      tx.status !== 'removed' &&
      tx.accountKind !== 'voucher' &&
      tx.amountCents !== 0 &&
      // Uma compra no cartão nunca é um lado de transferência; só o pagamento recebido pela fatura é.
      !(tx.accountKind === 'credit_card' && tx.amountCents < 0),
  );
  const inflowsByAmount = new Map<number, Tx[]>();
  for (const tx of eligible) {
    if (tx.amountCents <= 0 || !canBeOwnTransfer(tx, options.householdDocuments)) continue;
    const list = inflowsByAmount.get(tx.amountCents) ?? [];
    list.push(tx);
    inflowsByAmount.set(tx.amountCents, list);
  }
  const outflows = eligible
    .filter((tx) => tx.amountCents < 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const pairs = new Map<string, TransferPair>();
  for (const out of outflows) {
    let best: Tx | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const inflow of inflowsByAmount.get(-out.amountCents) ?? []) {
      if (pairs.has(inflow.id) || inflow.accountId === out.accountId) continue;
      if (!canPair(out, inflow, options.householdDocuments)) continue;
      const gap = Math.abs(daysBetween(out.date, inflow.date));
      if (gap > options.windowDays) continue;
      if (gap < bestGap || (gap === bestGap && best !== null && inflow.id < best.id)) {
        best = inflow;
        bestGap = gap;
      }
    }
    if (best === null) continue;
    const kind = transferKindFor(out.accountKind, best.accountKind);
    pairs.set(out.id, { pairId: best.id, kind });
    pairs.set(best.id, { pairId: out.id, kind });
  }
  return pairs;
}
