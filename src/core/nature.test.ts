import { describe, expect, it } from 'vitest';
import { inferNature, isFromPj, isPixBetweenPersons, type NatureConfig } from './nature';
import { makeTx } from './testing';

const config: NatureConfig = { pjDocument: '12345678000199', pjNamePattern: /FULANO SERVICOS LTDA/i };

describe('inferNature', () => {
  it('treats card purchases and card refunds as expenses', () => {
    const purchase = makeTx({ id: 'p', accountKind: 'credit_card', amountCents: -4590, description: 'IFOOD *IFOOD' });
    const refund = makeTx({ id: 'r', accountKind: 'credit_card', amountCents: 4590, description: 'ESTORNO NETFLIX' });
    expect(inferNature(purchase, config)).toEqual({ nature: 'expense', transferKind: null, fromPj: false });
    expect(inferNature(refund, config).nature).toBe('expense');
  });

  it('recognizes bill payments on both sides', () => {
    const onCard = makeTx({ id: 'c', accountKind: 'credit_card', amountCents: 120000, description: 'Pagamento recebido' });
    const onChecking = makeTx({ id: 'k', amountCents: -120000, description: 'PAGAMENTO DE FATURA C6' });
    const shortForm = makeTx({ id: 's', amountCents: -120000, description: 'PGTO FATURA CARTAO' });
    for (const tx of [onCard, onChecking, shortForm]) {
      expect(inferNature(tx, config)).toEqual({ nature: 'transfer', transferKind: 'bill_payment', fromPj: false });
    }
  });

  it('recognizes the C6 bill payment wording on both sides', () => {
    const onCard = makeTx({ id: 'c', accountKind: 'credit_card', amountCents: 120000, description: 'Inclusao de Pagamento Ciclo Corrente' });
    const onChecking = makeTx({ id: 'k', amountCents: -120000, description: 'PGTO FAT CARTAO C6' });
    for (const tx of [onCard, onChecking]) {
      expect(inferNature(tx, config)).toEqual({ nature: 'transfer', transferKind: 'bill_payment', fromPj: false });
    }
  });

  it('recognizes investment moves on the checking account', () => {
    const apply = makeTx({ id: 'a', amountCents: -50000, description: 'APLICAÇÃO CDB LIQUIDEZ DIÁRIA' });
    const redeem = makeTx({ id: 'r', amountCents: 50000, description: 'Resgate automático' });
    expect(inferNature(apply, config).transferKind).toBe('investment');
    expect(inferNature(redeem, config).transferKind).toBe('investment');
  });

  it('treats money sent to and back from the foreign investment account as an investment move', () => {
    const out = makeTx({ id: 'g', amountCents: -50000, description: 'TRANSF CONTA GLOBAL' });
    const back = makeTx({ id: 'b', amountCents: 5000, description: 'RETORNO CONTA GLOBAL' });
    const iof = makeTx({ id: 'f', amountCents: -653, description: 'IOF CAMBIO' });
    expect(inferNature(out, config).transferKind).toBe('investment');
    expect(inferNature(back, config).transferKind).toBe('investment');
    expect(inferNature(iof, config).nature).toBe('expense');
  });

  it('does not take a Pix to someone named after an investment word for an investment move', () => {
    const pix = makeTx({ id: 'p', amountCents: -3000, description: 'Pix enviado  - Igreja Exemplo' });
    expect(inferNature(pix, config)).toEqual({ nature: 'expense', transferKind: null, fromPj: false });
  });

  it('flags income from the PJ by document or by name', () => {
    const byDocument = makeTx({
      id: 'd',
      amountCents: 300000,
      description: 'PIX RECEBIDO',
      counterpartDocType: 'cnpj',
      counterpartDoc: '12345678000199',
    });
    const byName = makeTx({ id: 'n', amountCents: 300000, description: 'TED FULANO SERVICOS LTDA' });
    expect(inferNature(byDocument, config)).toEqual({ nature: 'income', transferKind: null, fromPj: true });
    expect(inferNature(byName, config).fromPj).toBe(true);
    expect(isFromPj(makeTx({ id: 'o', amountCents: -300000, description: 'FULANO SERVICOS LTDA' }), config)).toBe(false);
  });

  it('defaults checking outflows to expense and inflows to income', () => {
    expect(inferNature(makeTx({ id: 'o', amountCents: -2000, description: 'PADARIA' }), config).nature).toBe('expense');
    expect(inferNature(makeTx({ id: 'i', amountCents: 2000, description: 'CASHBACK' }), config)).toEqual({
      nature: 'income',
      transferKind: null,
      fromPj: false,
    });
  });

  it('handles investment and voucher accounts', () => {
    expect(inferNature(makeTx({ id: 'i', accountKind: 'investment', amountCents: 100 }), config).transferKind).toBe(
      'investment',
    );
    expect(inferNature(makeTx({ id: 'v', accountKind: 'voucher', amountCents: 80000 }), config).nature).toBe('income');
    expect(inferNature(makeTx({ id: 'w', accountKind: 'voucher', amountCents: -80000 }), config).nature).toBe('expense');
    expect(inferNature(makeTx({ id: 'x', accountKind: 'cash', amountCents: 300000 }), config).nature).toBe('income');
    expect(inferNature(makeTx({ id: 'y', accountKind: 'cash', amountCents: -1500 }), config).nature).toBe('expense');
  });

  it('works without PJ configuration', () => {
    const empty: NatureConfig = { pjDocument: null, pjNamePattern: null };
    expect(inferNature(makeTx({ id: 'x', amountCents: 300000, description: 'TED FULANO SERVICOS LTDA' }), empty).fromPj).toBe(
      false,
    );
  });
});

describe('isPixBetweenPersons', () => {
  it('uses the document type when present', () => {
    expect(isPixBetweenPersons(makeTx({ id: 'a', counterpartDocType: 'cpf', counterpartDoc: '1' }))).toBe(true);
    expect(isPixBetweenPersons(makeTx({ id: 'b', description: 'PIX ENVIADO LOJA', counterpartDocType: 'cnpj' }))).toBe(
      false,
    );
  });

  it('assumes a person when there is no document and the description says Pix', () => {
    expect(isPixBetweenPersons(makeTx({ id: 'c', description: 'Pix enviado - Maria' }))).toBe(true);
    expect(isPixBetweenPersons(makeTx({ id: 'd', description: 'NETFLIX.COM' }))).toBe(false);
  });
});

describe('inferNature on generic payment descriptions', () => {
  it('does not take a checking boleto described as PAGAMENTO EFETUADO for a bill payment', () => {
    const boleto = makeTx({ id: 'b', amountCents: -80000, description: 'PAGAMENTO EFETUADO CONDOMINIO' });
    expect(inferNature(boleto, config)).toEqual({ nature: 'expense', transferKind: null, fromPj: false });
  });
});
