import { describe, expect, it } from 'vitest';
import { formatBRL, parseBRL, toCents } from './money';

describe('money', () => {
  it('converts reais to integer cents', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(-0.1)).toBe(-10);
    expect(toCents(1999.9)).toBe(199990);
    expect(toCents(0)).toBe(0);
  });

  it('formats cents as BRL with a plain space', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(-500)).toBe('-R$ 5,00');
  });

  it('parseBRL accepts Brazilian formats', () => {
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL('1234,5')).toBe(123450);
    expect(parseBRL('R$ 45,90')).toBe(4590);
    expect(parseBRL('45')).toBe(4500);
    expect(parseBRL(' 0,99 ')).toBe(99);
    expect(parseBRL('12.345.678')).toBe(1234567800);
  });

  it('parseBRL refuses ambiguous or invalid values', () => {
    for (const text of ['', '12,345', 'abc', '-5', '1.23', '1,2,3']) {
      expect(() => parseBRL(text), text).toThrow('Valor inválido: use o formato 1.234,56.');
    }
  });
});
