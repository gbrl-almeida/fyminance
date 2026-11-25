import { addMonths, monthName } from '../core/dates';
import { formatBRL } from '../core/money';
import type { Owner, ReviewReason } from '../core/types';

export { formatBRL, monthName };

const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-10" → "out 2026". */
export function formatMonthShort(month: string): string {
  return `${SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "2026-10" → "out". */
export function monthAbbr(month: string): string {
  return SHORT[Number(month.slice(5, 7)) - 1] as string;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatPct(rate: number | null, digits = 0): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(digits).replace('.', ',')}%`;
}

export function formatDay(date: string): string {
  return `${date.slice(8, 10)}/${SHORT[Number(date.slice(5, 7)) - 1]}`;
}

export { OWNER_LABEL } from '../owner-labels';

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  uncategorized: 'sem categoria',
  low_confidence: 'sugestão a confirmar',
  pix_person: 'Pix para pessoa',
  ambiguous_inflow: 'entrada: renda ou devolução?',
  pj_income: 'renda do PJ',
  refund: 'estorno?',
};

export type OwnerFilter = Owner | 'all';

/** Parâmetros da URL: ?mes=AAAA-MM&dono=casal|pessoa1|pessoa2 ("casal" mostra tudo). */
export function readFilters(params: Record<string, string | string[] | undefined>, today: string): { month: string; owner: OwnerFilter } {
  const mes = typeof params.mes === 'string' && /^\d{4}-\d{2}$/.test(params.mes) ? params.mes : today.slice(0, 7);
  const dono = params.dono;
  const owner: OwnerFilter = dono === 'pessoa1' || dono === 'pessoa2' ? dono : 'all';
  return { month: mes, owner };
}

export function filterQuery(month: string, owner: OwnerFilter, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ mes: month, ...(owner === 'all' ? {} : { dono: owner }), ...extra });
  return `?${query.toString()}`;
}

export { addMonths };
