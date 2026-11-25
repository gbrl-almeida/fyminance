/** Texto sem acento e em minúsculas, para comparar na busca. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Valor digitado ("512", "512,40", "512.40", "1.234,56", "R$ 40"): centavos e se os centavos foram digitados. */
function parseAmount(query: string): { cents: number; withCents: boolean } | null {
  const text = query.replace(/^r\$\s*/i, '').trim();
  const decimal = /^(\d+)[.,](\d{1,2})$/.exec(text) ?? /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text) ?? /^(\d+)()$/.exec(text);
  if (decimal === null) return null;
  const reais = Number((decimal[1] as string).replace(/\./g, ''));
  const cents = decimal[2] ?? '';
  return cents === '' ? { cents: reais * 100, withCents: false } : { cents: reais * 100 + Number(cents.padEnd(2, '0')), withCents: true };
}

/**
 * Busca por palavras (todas precisam aparecer) ou por valor: "512" acha R$ 512,40; "512,40" acha só ele.
 * Um número que não bate com nenhum valor ainda é procurado como texto ("99" acha "99 POP").
 */
export function matchesSearch(query: string, texts: readonly string[], amountsCents: readonly number[]): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return true;
  const amount = parseAmount(trimmed);
  if (amount !== null) {
    const hit = amountsCents.some((value) => {
      const abs = Math.abs(value);
      return amount.withCents ? abs === amount.cents : abs - (abs % 100) === amount.cents;
    });
    if (hit) return true;
  }
  const haystack = foldText(texts.join(' '));
  return foldText(trimmed)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
