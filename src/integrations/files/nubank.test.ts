import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNubankStatement } from './nubank';

const text = readFileSync(new URL('./fixtures/nubank-sintetico.csv', import.meta.url), 'utf8');
const parsed = parseNubankStatement(text, 'Nubank_2026-11-14.csv');
const find = (description: string) => parsed.rows.find((r) => r.description === description);

describe('parseNubankStatement', () => {
  it('parses dates and Brazilian amounts', () => {
    expect(find('Contador Online')).toEqual({
      date: '2026-10-16',
      purchaseDate: null,
      description: 'Contador Online',
      amountCents: -15600,
      installmentNumber: null,
      installmentTotal: null,
      cardLast4: null,
    });
    expect(find('IOF de "Loja Gringa"')?.amountCents).toBe(-60);
    expect(find('Movel Planejado')?.amountCents).toBe(-120000);
  });

  it('takes the installment out of the title and dates it in the month it is charged', () => {
    expect(find('Movel Planejado')).toMatchObject({ date: '2026-10-02', purchaseDate: '2026-08-02', installmentNumber: 3, installmentTotal: 10 });
  });

  it('keeps an installment already dated inside the bill period', () => {
    expect(find('Curso Online')).toMatchObject({ date: '2026-10-10', purchaseDate: '2026-10-10', installmentNumber: 2, installmentTotal: 4 });
  });

  it('payment is skipped and a refund is positive', () => {
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rows.some((r) => r.description === 'Pagamento recebido')).toBe(false);
    expect(find('Estorno de Loja')?.amountCents).toBe(2000);
  });

  it('reads the due date from the file name; the file has no total', () => {
    expect(parsed).toMatchObject({ bank: 'nubank', dueDate: '2026-11-14', totalCents: null, cardLast4: null });
    expect(parseNubankStatement(text, 'fatura.csv').dueDate).toBeNull();
  });

  it('accepts amounts with a dot as decimal separator', () => {
    expect(parseNubankStatement('date,title,amount\n2026-10-01,Loja,21.50\n', 'x.csv').rows[0]?.amountCents).toBe(-2150);
  });

  it('refuses a file that is not a Nubank card statement', () => {
    expect(() => parseNubankStatement('Data,Valor,Identificador,Descrição\n', 'x.csv')).toThrow('Este arquivo não parece uma fatura do Nubank.');
  });
});
