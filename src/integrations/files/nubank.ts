import { cleanDescription, decimalCents, dueDateFromName, fileLines, installmentDates, splitCsvLine } from './common';
import type { ParsedStatement } from './statement';

const HEADER = /^date,title,amount$/;
const PAYMENT = /^Pagamento recebido$/i;
const INSTALLMENT = /^(.*?)\s*-\s*Parcela (\d+)\/(\d+)$/i;

export function looksLikeNubank(text: string): boolean {
  return HEADER.test(fileLines(text)[0]?.trim() ?? '');
}

/** "1.200,00", "- 156,00" ou, nos arquivos antigos, "21.50". */
function amountCents(text: string): number {
  const compact = text.replace(/\s/g, '');
  return decimalCents(compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact);
}

/** CSV da fatura do cartão do Nubank: date, title, amount; a compra vem positiva. */
export function parseNubankStatement(text: string, fileName: string): ParsedStatement {
  const [header, ...lines] = fileLines(text);
  if (header === undefined || !HEADER.test(header.trim())) throw new Error('Este arquivo não parece uma fatura do Nubank.');
  const dueDate = dueDateFromName(fileName, 'Nubank');

  const rows = lines.flatMap((line) => {
    const [date = '', title = '', amount = ''] = splitCsvLine(line, ',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Data inválida na fatura do Nubank: "${date}".`);
    const full = cleanDescription(title);
    if (PAYMENT.test(full)) return [];
    const installment = INSTALLMENT.exec(full);
    const installmentNumber = installment === null ? null : Number(installment[2]);
    return [
      {
        ...installmentDates(date, installmentNumber, dueDate),
        description: installment === null ? full : (installment[1] ?? full),
        amountCents: -amountCents(amount),
        installmentNumber,
        installmentTotal: installment === null ? null : Number(installment[3]),
        cardLast4: null,
      },
    ];
  });

  return { bank: 'nubank', cardLast4: null, dueDate, totalCents: null, rows };
}
