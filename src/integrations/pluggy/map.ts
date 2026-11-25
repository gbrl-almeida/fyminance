import type { ConnectionConfig } from '../../config';
import { toSaoPauloDate } from '../../core/dates';
import { normalizeMerchantKey } from '../../core/merchant';
import { toCents } from '../../core/money';
import type { accounts, bills, investmentMovements, transactions } from '../../db/schema';
import {
  PluggyAccountSchema,
  PluggyBillSchema,
  PluggyInvestmentMovementSchema,
  PluggyInvestmentSchema,
  PluggyItemSchema,
  PluggyTransactionSchema,
} from './schemas';

export type AccountRow = typeof accounts.$inferInsert;
export type BillRow = typeof bills.$inferInsert;
export type MovementRow = Omit<typeof investmentMovements.$inferInsert, 'firstSeenAt' | 'updatedAt'>;
export type TransactionInput = Omit<typeof transactions.$inferInsert, 'firstSeenAt' | 'updatedAt' | 'missingSince'>;

export interface MappedAccount {
  account: AccountRow;
  balanceCents: number;
}

export interface MappedItem {
  status: string;
  consentExpiresAt: string | null;
}

export function pluggyDateToLocal(instant: Date): string {
  const iso = instant.toISOString();
  const time = iso.slice(11, 23);
  if (time === '00:00:00.000' || time === '03:00:00.000') return iso.slice(0, 10);
  return toSaoPauloDate(instant);
}

export function mapItem(raw: unknown): MappedItem {
  const item = PluggyItemSchema.parse(raw);
  return { status: item.status, consentExpiresAt: item.consentExpiresAt ? item.consentExpiresAt.toISOString() : null };
}

// O Open Finance manda o nome do banco no lugar do nome da conta ("C6 BANK", "BANCO INTER").
const BANK_ACCOUNT_NAMES: Record<string, string> = { CHECKING_ACCOUNT: 'Conta corrente', SAVINGS_ACCOUNT: 'Poupança' };

export function mapAccount(raw: unknown, connection: ConnectionConfig): MappedAccount {
  const account = PluggyAccountSchema.parse(raw);
  return {
    account: {
      id: account.id,
      connectionId: connection.itemId,
      kind: account.type === 'CREDIT' ? 'credit_card' : 'checking',
      name: `${connection.institution} · ${(account.subtype && BANK_ACCOUNT_NAMES[account.subtype]) || account.name.trim()}`,
      owner: connection.owner,
      raw: JSON.stringify(raw),
    },
    balanceCents: toCents(account.balance),
  };
}

export function mapInvestment(raw: unknown, connection: ConnectionConfig): MappedAccount {
  const investment = PluggyInvestmentSchema.parse(raw);
  return {
    account: {
      id: investment.id,
      connectionId: connection.itemId,
      kind: 'investment',
      name: `${connection.institution} · ${investment.name}`,
      owner: connection.owner,
      raw: JSON.stringify(raw),
    },
    balanceCents: toCents(investment.balance),
  };
}

export function mapInvestmentMovement(raw: unknown, accountId: string): MovementRow {
  const m = PluggyInvestmentMovementSchema.parse(raw);
  return {
    id: m.id,
    accountId,
    date: pluggyDateToLocal(m.date),
    type: m.type,
    amountCents: Math.abs(toCents(m.amount)),
    netCents: m.netAmount == null ? null : Math.abs(toCents(m.netAmount)),
    quantity: Math.abs(m.quantity ?? 0),
    unitValue: m.value ?? null,
    raw: JSON.stringify(raw),
  };
}

export function mapTransaction(raw: unknown): TransactionInput {
  const t = PluggyTransactionSchema.parse(raw);
  const inflow = t.type === 'CREDIT';
  const cents = Math.abs(toCents(t.amount));
  const party = inflow ? t.paymentData?.payer : t.paymentData?.receiver;
  // No pagamento de convênio (gás, luz), o banco põe o próprio pagador como recebedor.
  const document = t.operationType === 'CONVENIO_ARRECADACAO' ? null : party?.documentNumber;
  const card = t.creditCardMetadata;
  const cardDigits = card?.cardNumber?.replace(/\D/g, '') ?? '';
  // Boleto pago vem descrito pelo banco emissor ("Pagamento Boleto BCO ..."); quem recebe diz o que foi pago.
  // Menos quando a descrição já diz que é a fatura do cartão: o recebedor seria só o banco do cartão.
  const paysCardBill = /fatura|cart[aã]o/i.test(t.description);
  const boletoReceiver = !inflow && !paysCardBill && t.paymentData?.paymentMethod === 'BOLETO' ? t.paymentData.receiver?.name?.trim() : null;
  const description = boletoReceiver ? `Boleto ${boletoReceiver}` : t.description;
  return {
    id: t.id,
    accountId: t.accountId,
    date: pluggyDateToLocal(t.date),
    amountCents: inflow ? cents : -cents,
    description,
    merchantKey: normalizeMerchantKey(boletoReceiver || t.description),
    status: t.status === 'PENDING' ? 'pending' : 'posted',
    cardLast4: cardDigits.length >= 4 ? cardDigits.slice(-4) : null,
    installmentNumber: card?.installmentNumber ?? null,
    installmentTotal: card?.totalInstallments ?? null,
    purchaseDate: card?.purchaseDate ? pluggyDateToLocal(card.purchaseDate) : null,
    billId: card?.billId ?? null,
    counterpartDocType: document?.type === 'CPF' ? 'cpf' : document?.type === 'CNPJ' ? 'cnpj' : null,
    counterpartDoc: document?.value ? document.value.replace(/\D/g, '') : null,
    raw: JSON.stringify(raw),
  };
}

export function mapBill(raw: unknown, accountId: string): BillRow {
  const bill = PluggyBillSchema.parse(raw);
  return {
    id: bill.id,
    accountId,
    dueDate: pluggyDateToLocal(bill.dueDate),
    totalCents: toCents(bill.totalAmount),
    raw: JSON.stringify(raw),
  };
}

/** O que o banco diz da loja (categoria e empresa registrada), como pista para o modelo. */
export function bankHint(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { category, merchant } = raw as { category?: unknown; merchant?: unknown };
  const parts: string[] = [];
  if (typeof category === 'string' && category.trim() !== '') parts.push(`categoria do banco: ${category.trim()}`);
  if (typeof merchant === 'object' && merchant !== null) {
    const { businessName, name, cnae } = merchant as { businessName?: unknown; name?: unknown; cnae?: unknown };
    const company = [businessName, name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (company !== undefined) parts.push(`empresa: ${company.trim()}${typeof cnae === 'string' && cnae !== '' ? ` (CNAE ${cnae})` : ''}`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}
