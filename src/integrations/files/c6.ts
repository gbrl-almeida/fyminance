import { cleanDescription, decimalCents, dueDateFromName, fileLines, installmentDates, splitCsvLine } from './common';
import type { ParsedStatement } from './statement';

const HEADER = /^Data de Compra;/;
// O pagamento da fatura anterior aparece como crédito; não é gasto nem devolução.
const PAYMENT = /^Inclus[aã]o de Pagamento/i;

export function looksLikeC6(text: string): boolean {
  return HEADER.test(fileLines(text)[0] ?? '');
}

function isoDate(text: string | undefined): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text?.trim() ?? '');
  if (match === null) throw new Error(`Data inválida na fatura do C6: "${text ?? ''}".`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** CSV da fatura do C6 (dentro do .zip que o app do banco envia): separado por ";", valor em reais com ponto. */
export function parseC6Statement(text: string, fileName: string): ParsedStatement {
  const [header, ...lines] = fileLines(text);
  if (header === undefined || !HEADER.test(header)) throw new Error('Este arquivo não parece uma fatura do C6.');
  const columns = splitCsvLine(header, ';');
  const at = (name: string) => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`Falta a coluna "${name}" na fatura do C6.`);
    return index;
  };
  const col = { date: at('Data de Compra'), card: at('Final do Cartão'), description: at('Descrição'), installment: at('Parcela'), amount: at('Valor (em R$)') };
  const dueDate = dueDateFromName(fileName, 'Fatura');

  const rows = lines.flatMap((line) => {
    const fields = splitCsvLine(line, ';');
    const description = cleanDescription(fields[col.description] ?? '');
    if (PAYMENT.test(description)) return [];
    const installment = /^(\d+)\/(\d+)$/.exec(fields[col.installment]?.trim() ?? '');
    const installmentNumber = installment === null ? null : Number(installment[1]);
    return [
      {
        ...installmentDates(isoDate(fields[col.date]), installmentNumber, dueDate),
        description,
        amountCents: -decimalCents(fields[col.amount] ?? ''),
        installmentNumber,
        installmentTotal: installment === null ? null : Number(installment[2]),
        cardLast4: fields[col.card]?.trim() || null,
      },
    ];
  });

  const cards = new Set(rows.map((r) => r.cardLast4));
  return { bank: 'c6', cardLast4: cards.size === 1 ? ([...cards][0] ?? null) : null, dueDate, totalCents: null, rows };
}
