const SAO_PAULO = 'America/Sao_Paulo';

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + n;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Mesmo dia, n meses depois; no mês mais curto, o último dia. */
export function shiftMonths(date: string, n: number): string {
  const month = addMonths(monthOf(date), n);
  const last = lastDayOfMonth(month);
  const day = `${month}-${date.slice(8, 10)}`;
  return day > last ? last : day;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function lastDayOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

export function toSaoPauloDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2026-10" → "outubro de 2026". */
export function monthName(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[mon - 1]} de ${year}`;
}
