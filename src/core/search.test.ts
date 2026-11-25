import { describe, expect, it } from 'vitest';
import { matchesSearch } from './search';

describe('matchesSearch', () => {
  it('finds every word, ignoring case and accents', () => {
    expect(matchesSearch('pagamento convenio', ['Pagamento de Convênio - GÁS EXEMPLO'], [])).toBe(true);
    expect(matchesSearch('gas', ['Pagamento de Convênio - GÁS EXEMPLO'], [])).toBe(true);
    expect(matchesSearch('gas luz', ['Pagamento de Convênio - GÁS EXEMPLO'], [])).toBe(false);
  });

  it('finds a value typed in reais, whole or with cents', () => {
    expect(matchesSearch('512', ['BOLETO'], [-51240])).toBe(true);
    expect(matchesSearch('512,40', ['BOLETO'], [-51240])).toBe(true);
    expect(matchesSearch('512.40', ['BOLETO'], [-51240])).toBe(true);
    expect(matchesSearch('R$ 512,3', ['BOLETO'], [-51230])).toBe(true);
    expect(matchesSearch('512,30', ['BOLETO'], [-51240])).toBe(false);
    expect(matchesSearch('1.234,56', ['LOJA'], [123456])).toBe(true);
    expect(matchesSearch('1234', ['LOJA'], [123456])).toBe(true);
  });

  it('still reads numbers as text when no value matches', () => {
    expect(matchesSearch('99', ['99 POP CORRIDA'], [-1850])).toBe(true);
  });

  it('matches everything when the search is empty', () => {
    expect(matchesSearch('  ', ['LOJA'], [100])).toBe(true);
  });
});
