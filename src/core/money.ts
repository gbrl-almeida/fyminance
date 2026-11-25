const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ');
}

const BRL_INPUT = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** Valor digitado em reais no formato brasileiro ("1.234,56", "R$ 45,90", "45") para centavos. */
export function parseBRL(text: string): number {
  const match = BRL_INPUT.exec(text.trim());
  if (match === null) throw new Error('Valor inválido: use o formato 1.234,56.');
  const reais = Number((match[1] as string).replace(/\./g, ''));
  const cents = Number((match[2] ?? '0').padEnd(2, '0'));
  return reais * 100 + cents;
}
