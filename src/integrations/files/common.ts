import { addDays, shiftMonths } from '../../core/dates';

/** Linhas não vazias do arquivo, sem BOM e sem o CR do Windows. */
export function fileLines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
}

/** Campos de uma linha de CSV, com aspas que podem conter o separador e aspas dobradas. */
export function splitCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Valor com ponto decimal ("308.15", "-98", "0") em centavos, sem passar por float. */
export function decimalCents(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) throw new Error(`Valor inválido no arquivo: "${text}".`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

export function cleanDescription(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Vencimento no nome do arquivo, como o banco salva (Fatura_2026-10-20.csv). */
export function dueDateFromName(fileName: string, prefix: string): string | null {
  return new RegExp(`${prefix}_(\\d{4}-\\d{2}-\\d{2})`).exec(fileName)?.[1] ?? null;
}

// Uma fatura cobre cerca de 30 dias que terminam uma semana antes do vencimento.
const BILL_SPAN_DAYS = 40;

/**
 * Data de uma parcela no livro: o mês em que ela é cobrada, como a Pluggy entrega.
 * O arquivo traz a data da compra; quando ela cai antes do período da fatura, a parcela n
 * vai n-1 meses adiante. Uma data já dentro do período é mantida.
 */
export function installmentDates(
  date: string,
  installmentNumber: number | null,
  dueDate: string | null,
): { date: string; purchaseDate: string | null } {
  if (installmentNumber === null) return { date, purchaseDate: null };
  const beforePeriod = dueDate === null || date < addDays(dueDate, -BILL_SPAN_DAYS);
  if (installmentNumber > 1 && beforePeriod) return { date: shiftMonths(date, installmentNumber - 1), purchaseDate: date };
  return { date, purchaseDate: date };
}
