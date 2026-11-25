import { looksLikeC6, parseC6Statement } from './c6';
import { looksLikeNubank, parseNubankStatement } from './nubank';

/** Fatura lida de um arquivo exportado pelo banco. Compra é negativa, como no livro. */
export interface ParsedStatement {
  bank: string;
  cardLast4: string | null;
  dueDate: string | null;
  totalCents: number | null;
  rows: Array<{
    /** Mês em que a parcela é cobrada; para compra à vista, a data da compra. */
    date: string;
    purchaseDate: string | null;
    description: string;
    amountCents: number;
    installmentNumber: number | null;
    installmentTotal: number | null;
    cardLast4: string | null;
  }>;
}

/** Lê o texto do arquivo; o nome, como o banco salva, traz o vencimento. */
export type StatementParser = (text: string, fileName: string) => ParsedStatement;

export interface StatementReader {
  label: string;
  /** Reconhece o arquivo pela primeira linha. */
  matches: (text: string) => boolean;
  parse: StatementParser;
}

export const PARSERS: Record<string, StatementReader> = {
  c6: { label: 'C6', matches: looksLikeC6, parse: parseC6Statement },
  nubank: { label: 'Nubank', matches: looksLikeNubank, parse: parseNubankStatement },
};

export const UNKNOWN_FILE = 'Não reconheci o arquivo. Por enquanto, o Fyminance lê as faturas em CSV do C6 e do Nubank (extrato de conta ainda não).';

export function detectBank(text: string): string | null {
  return Object.entries(PARSERS).find(([, reader]) => reader.matches(text))?.[0] ?? null;
}
