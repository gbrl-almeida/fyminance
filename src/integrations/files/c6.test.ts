import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseC6Statement } from './c6';

const text = readFileSync(new URL('./fixtures/c6-sintetico.csv', import.meta.url), 'utf8');
const parsed = parseC6Statement(text, 'Fatura_2026-10-20.csv');
const find = (description: string) => parsed.rows.find((r) => r.description === description);

describe('parseC6Statement', () => {
  it('parses dates, amounts and installments', () => {
    expect(find('PADARIA DO BAIRRO')).toEqual({
      date: '2026-09-20',
      purchaseDate: null,
      description: 'PADARIA DO BAIRRO',
      amountCents: -2550,
      installmentNumber: null,
      installmentTotal: null,
      cardLast4: '2222',
    });
    expect(find('SERVICO ONLINE')?.amountCents).toBe(-10800);
    expect(find('MERCADO CENTRAL')).toMatchObject({ date: '2026-09-21', purchaseDate: '2026-09-21', installmentNumber: 1, installmentTotal: 3 });
  });

  it('dates a later installment in the month it is charged', () => {
    expect(find('LOJA DE MOVEIS')).toMatchObject({ date: '2026-09-29', purchaseDate: '2025-11-29', installmentNumber: 11, installmentTotal: 11 });
    expect(find('LOJA; COM PONTO E VIRGULA')).toMatchObject({ date: '2026-10-04', purchaseDate: '2026-05-04', installmentNumber: 6 });
  });

  it('purchase is negative and payment is skipped', () => {
    expect(parsed.rows).toHaveLength(7);
    expect(parsed.rows.some((r) => /pagamento/i.test(r.description))).toBe(false);
    expect(find('Anuidade Diferenciada')?.amountCents).toBe(-9800);
    expect(find('Estorno Tarifa')?.amountCents).toBe(9800);
  });

  it('reads the due date from the file name; the file has no total', () => {
    expect(parsed).toMatchObject({ bank: 'c6', dueDate: '2026-10-20', totalCents: null, cardLast4: null });
    expect(parseC6Statement(text, 'fatura.csv').dueDate).toBeNull();
  });

  it('a file with a single card carries its final digits', () => {
    const single = text
      .split('\r\n')
      .filter((line, i) => i === 0 || line.includes(';1111;'))
      .join('\r\n');
    expect(parseC6Statement(single, 'Fatura_2026-10-20.csv').cardLast4).toBe('1111');
  });

  it('refuses a file that is not a C6 statement', () => {
    expect(() => parseC6Statement('date,title,amount\n2026-10-01,Loja,"1,00"\n', 'x.csv')).toThrow('Este arquivo não parece uma fatura do C6.');
  });
});
