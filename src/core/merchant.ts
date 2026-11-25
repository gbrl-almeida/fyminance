const LEADING_NOISE = new Set([
  'PIX', 'ENVIADO', 'ENVIADA', 'RECEBIDO', 'RECEBIDA', 'TRANSF', 'TRANSFERENCIA', 'TED', 'DOC',
  'COMPRA', 'CARTAO', 'DEBITO', 'CREDITO', 'PAG', 'PGTO', 'PAGAMENTO', 'PARC', 'PARCELA',
  'NO', 'NA', 'DE', 'DA', 'DO', 'EM', 'PARA', 'A', 'O',
]);
const MAX_TOKENS = 4;

export function normalizeMerchantKey(description: string): string {
  const cleaned = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter((token) => token.length > 0 && !/^\d+$/.test(token));
  while (tokens.length > 1 && LEADING_NOISE.has(tokens[0] as string)) tokens.shift();
  const key = tokens.slice(0, MAX_TOKENS).join(' ');
  return key.length > 0 ? key : 'DESCONHECIDO';
}
