import { describe, expect, it } from 'vitest';
import { normalizeMerchantKey } from './merchant';

describe('normalizeMerchantKey', () => {
  it.each([
    ['IFOOD *IFOOD 02/03', 'IFOOD IFOOD'],
    ['Pix enviado - Maria da Silva', 'MARIA DA SILVA'],
    ['PAG*PadariaPãoQuente', 'PADARIAPAOQUENTE'],
    ['UBER *TRIP HELP.UBER.COM', 'UBER TRIP HELP UBER'],
    ['Supermercado Bom Preço 0234', 'SUPERMERCADO BOM PRECO'],
    ['Pagamento de fatura', 'FATURA'],
    ['PIX RECEBIDO DE JOAO 05/10/2026', 'JOAO'],
  ])('normalizes "%s" to "%s"', (description, key) => {
    expect(normalizeMerchantKey(description)).toBe(key);
  });

  it('gives the same key to installments of the same merchant', () => {
    expect(normalizeMerchantKey('NETFLIX.COM 05/10')).toBe(normalizeMerchantKey('NETFLIX.COM'));
  });

  it('keeps a lone noise word instead of returning nothing', () => {
    expect(normalizeMerchantKey('PIX')).toBe('PIX');
  });

  it('falls back to DESCONHECIDO when nothing is left', () => {
    expect(normalizeMerchantKey('123456')).toBe('DESCONHECIDO');
    expect(normalizeMerchantKey('  ')).toBe('DESCONHECIDO');
  });
});
