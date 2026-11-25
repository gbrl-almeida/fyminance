import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectBank } from './statement';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('detectBank', () => {
  it('recognizes each bank by the first line of the file', () => {
    expect(detectBank(fixture('c6-sintetico.csv'))).toBe('c6');
    expect(detectBank(fixture('nubank-sintetico.csv'))).toBe('nubank');
    expect(detectBank('﻿date,title,amount\r\n')).toBe('nubank');
  });

  it('does not take an account statement for a card statement', () => {
    expect(detectBank('Data,Valor,Identificador,Descrição\n24/09/2026,870.00,abc,Pix\n')).toBeNull();
  });
});
