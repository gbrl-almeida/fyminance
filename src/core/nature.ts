import type { Nature, TransferKind, Tx } from './types';

export interface NatureConfig {
  pjDocument: string | null;
  pjNamePattern: RegExp | null;
}

export interface NatureResult {
  nature: Nature;
  transferKind: TransferKind | null;
  fromPj: boolean;
}

const BILL_PAYMENT =
  /(?:PAG(?:AMENTO|TO)?|PGTO)\.?\s+(?:DE\s+|DA\s+)?FAT(?:URA)?\b|PAGAMENTO\s+(?:RECEBIDO|EFETUADO)|INCLUSAO\s+DE\s+PAGAMENTO|FATURA\s+(?:DO\s+)?CARTAO/;
// Na conta corrente, "PAGAMENTO EFETUADO" sozinho também descreve boletos; exige menção à fatura ou ao cartão.
const MENTIONS_CARD_BILL = /FATURA|CARTAO/;
// "TRANSF CONTA GLOBAL" e "RETORNO CONTA GLOBAL": dinheiro que vai e volta da conta de investimento no exterior do C6.
const INVESTMENT_MOVE = /\b(?:APLICACAO|APLIC|RESGATE|CDB|RDB|LCI|LCA|TESOURO|CONTA GLOBAL)\b/;

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function transfer(kind: TransferKind): NatureResult {
  return { nature: 'transfer', transferKind: kind, fromPj: false };
}

function simple(nature: Nature): NatureResult {
  return { nature, transferKind: null, fromPj: false };
}

export function isPixBetweenPersons(tx: Pick<Tx, 'counterpartDocType' | 'description'>): boolean {
  if (tx.counterpartDocType === 'cpf') return true;
  if (tx.counterpartDocType === 'cnpj') return false;
  return /\bPIX\b/.test(plain(tx.description));
}

/** Pagamento da fatura recebido no cartão. */
export function isCardBillPayment(tx: Pick<Tx, 'accountKind' | 'amountCents' | 'description'>): boolean {
  return tx.accountKind === 'credit_card' && tx.amountCents > 0 && BILL_PAYMENT.test(plain(tx.description));
}

export function isFromPj(tx: Tx, config: NatureConfig): boolean {
  if (tx.amountCents <= 0) return false;
  if (config.pjDocument !== null && tx.counterpartDoc === config.pjDocument) return true;
  return config.pjNamePattern !== null && config.pjNamePattern.test(plain(tx.description));
}

export function inferNature(tx: Tx, config: NatureConfig): NatureResult {
  const description = plain(tx.description);
  switch (tx.accountKind) {
    case 'credit_card':
      if (isCardBillPayment(tx)) return transfer('bill_payment');
      return simple('expense');
    case 'investment':
      return transfer('investment');
    case 'voucher':
    case 'cash':
      return simple(tx.amountCents > 0 ? 'income' : 'expense');
    case 'checking':
      if (tx.amountCents < 0 && BILL_PAYMENT.test(description) && MENTIONS_CARD_BILL.test(description)) {
        return transfer('bill_payment');
      }
      // Pix nunca é aplicação: "Pix enviado - Paróquia N. Sra. do Resgate" é para uma pessoa ou empresa.
      if (INVESTMENT_MOVE.test(description) && !/\bPIX\b/.test(description)) return transfer('investment');
      if (isFromPj(tx, config)) return { nature: 'income', transferKind: null, fromPj: true };
      return simple(tx.amountCents > 0 ? 'income' : 'expense');
  }
}
