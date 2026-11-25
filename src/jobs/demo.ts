import { setUserPassword } from '../auth/passwords';
import { addMonths, monthOf } from '../core/dates';
import { normalizeMerchantKey } from '../core/merchant';
import type { Confidence, DocType, Nature, Owner, ReviewReason, TransferKind } from '../core/types';
import { inTransaction, type Db } from '../db/client';
import { loadCategories } from '../db/ledger';
import { accounts, balanceSnapshots, bills, classifications, connections, investmentMovements, rules, transactions } from '../db/schema';
import { ensureVoucher } from './voucher';

/** Senha dos dois usuários do banco de demonstração. Nada aqui é dado real. */
export const DEMO_PASSWORD = 'demo-senha-123';

const MONTHS = 6;

interface DemoTx {
  accountId: string;
  date: string;
  amountCents: number;
  description: string;
  category?: string;
  nature?: Nature;
  transferKind?: TransferKind;
  owner?: Owner;
  source?: 'rule' | 'model' | 'manual' | 'system';
  confidence?: Confidence;
  reviewReason?: ReviewReason;
  billId?: string;
  installment?: [number, number];
  counterpart?: [DocType, string];
}

// Gastos recorrentes no cartão: [descrição, categoria, valor base em centavos, dia].
const CARD_SPENDING: Array<[string, string, number, number]> = [
  ['SUPERMERCADO BOM PRECO', 'Mercado', 68000, 4],
  ['HORTIFRUTI DA ESQUINA', 'Mercado', 21000, 11],
  ['SUPERMERCADO BOM PRECO', 'Mercado', 59000, 19],
  ['BISTRO DA VILA', 'Restaurante', 32000, 8],
  ['CANTINA NONNA', 'Restaurante', 41000, 22],
  ['IFOOD *IFOOD', 'Delivery', 18000, 6],
  ['IFOOD *IFOOD', 'Delivery', 24000, 17],
  ['PADARIA REAL', 'Padaria e café', 9000, 3],
  ['CAFE CULTURA', 'Padaria e café', 7000, 15],
  ['UBER *TRIP', 'Transporte', 26000, 9],
  ['POSTO IPIRANGA', 'Transporte', 31000, 13],
  ['DROGASIL', 'Saúde', 18000, 10],
  ['CINEMARK', 'Lazer', 16000, 14],
  ['SYMPLA', 'Lazer', 22000, 24],
  ['NETFLIX.COM', 'Assinaturas', 5590, 2],
  ['SPOTIFY', 'Assinaturas', 3490, 2],
  ['LEROY MERLIN', 'Casa', 27000, 20],
  ['BARBEARIA DO ZE', 'Cuidados pessoais', 9000, 12],
];

function vary(base: number, month: number, item: number): number {
  const factor = 1 + (((month * 7 + item * 3) % 5) - 2) * 0.06;
  return Math.round((base * factor) / 10) * 10;
}

/** Popula um banco vazio com 6 meses sintéticos que terminam no mês de `today`. */
export function seedDemo(db: Db, today: string): void {
  const nowIso = `${today}T12:00:00.000Z`;
  const current = monthOf(today);
  const first = addMonths(current, -(MONTHS - 1));
  const closing = addMonths(current, -1);
  const categoryId = new Map(loadCategories(db).map((c) => [`${c.kind}:${c.name}`, c.id]));
  const txs: DemoTx[] = [];

  for (let i = 0; i < MONTHS; i++) {
    const month = addMonths(first, i);
    const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
    const isPast = month < current;
    const cardBill = month === addMonths(closing, -1) ? `demo-bill-${closing}` : undefined;
    if (isPast || Number(today.slice(8, 10)) >= 6) {
      txs.push({ accountId: 'inter-checking', date: day(5), amountCents: 650000, description: 'SALARIO EMPRESA EXEMPLO', category: 'Salário', nature: 'income', owner: 'pessoa2', source: 'rule' });
      txs.push({ accountId: 'c6-checking', date: day(5), amountCents: 900000, description: 'PIX RECEBIDO PJ EXEMPLO LTDA', category: 'Pró-labore', nature: 'income', owner: 'pessoa1', source: 'rule' });
      txs.push({ accountId: 'c6-checking', date: day(5), amountCents: 350000, description: 'PIX RECEBIDO PJ EXEMPLO LTDA', category: 'Lucros do PJ', nature: 'income', owner: 'pessoa1', source: 'rule' });
      txs.push({ accountId: 'c6-checking', date: day(7), amountCents: -380000, description: 'PIX ENVIADO IMOBILIARIA EXEMPLO', category: 'Moradia', source: 'rule', counterpart: ['cnpj', '11111111000111'] });
      txs.push({ accountId: 'c6-checking', date: day(7), amountCents: -95000, description: 'CONDOMINIO EDIFICIO EXEMPLO', category: 'Moradia', source: 'rule' });
      txs.push({ accountId: 'inter-checking', date: day(6), amountCents: -250000, description: 'APLICACAO CDB INTER', nature: 'transfer', transferKind: 'investment', source: 'system' });
      txs.push({ accountId: 'c6-checking', date: day(6), amountCents: -100000, description: 'APLICACAO CDB', nature: 'transfer', transferKind: 'investment', source: 'system' });
    }
    CARD_SPENDING.forEach(([description, category, base, d], item) => {
      if (!isPast && d > Number(today.slice(8, 10))) return;
      txs.push({
        accountId: 'c6-card',
        date: day(d),
        amountCents: -vary(base, i, item),
        description,
        category,
        source: 'model',
        confidence: 'high',
        // Dono diferente de casal só vem de decisão manual ou regra; o modelo nunca define dono.
        ...(item === 17 ? { owner: 'pessoa1' as const, source: 'manual' as const } : {}),
        ...(cardBill === undefined ? {} : { billId: cardBill }),
      });
    });
    if (i === 3 || i === 4) {
      txs.push({ accountId: 'c6-card', date: day(16), amountCents: -150000, description: 'LATAM AIRLINES', category: 'Viagem', source: 'model', confidence: 'high' });
    }
    // Compras parceladas: TV em 10 vezes desde o 2º mês, notebook em 6 vezes desde o 4º.
    if (i >= 1) txs.push({ accountId: 'c6-card', date: day(10), amountCents: -50000, description: `LOJA DE TV ${String(i).padStart(2, '0')}/10`, category: 'Casa', source: 'manual', installment: [i, 10] });
    if (i >= 3) txs.push({ accountId: 'c6-card', date: day(12), amountCents: -80000, description: `LOJA NOTEBOOK ${String(i - 2).padStart(2, '0')}/06`, category: 'Casa', source: 'manual', installment: [i - 2, 6] });
  }

  // Fila de revisão do mês que fecha.
  const day = (d: number) => `${closing}-${String(d).padStart(2, '0')}`;
  txs.push({ accountId: 'c6-card', date: day(12), amountCents: -18640, description: 'PG *BISTRO DA VILA', category: 'Restaurante', source: 'model', confidence: 'medium', reviewReason: 'low_confidence' });
  txs.push({ accountId: 'c6-checking', date: day(15), amountCents: -35000, description: 'PIX ENVIADO MARIA S', source: 'system', reviewReason: 'pix_person', counterpart: ['cpf', '22222222222'] });
  txs.push({ accountId: 'c6-card', date: day(18), amountCents: -23990, description: 'MP *LOJAOBRASIL ELETRODOMESTICOS', category: 'Casa', source: 'model', confidence: 'low', reviewReason: 'low_confidence' });
  txs.push({ accountId: 'c6-card', date: day(21), amountCents: -12990, description: 'AMAZON MKTPLACE', source: 'system', reviewReason: 'uncategorized' });
  // Passagem em 4 vezes cancelada: o estorno das duas primeiras parcelas chega como "Refund".
  txs.push({ accountId: 'c6-card', date: day(9), amountCents: -21000, description: 'BUS SERVICOS*CLICKBUS', category: 'Viagem', source: 'model', confidence: 'high', installment: [1, 4] });
  txs.push({ accountId: 'c6-card', date: day(9), amountCents: 42000, description: 'Refund', category: 'Viagem', nature: 'expense', source: 'system', reviewReason: 'refund' });

  const billTotal = txs.filter((t) => t.billId !== undefined).reduce((sum, t) => sum - t.amountCents, 0) + 4590;
  const creditRaw = JSON.stringify({ creditData: { creditLimit: 21000, availableCreditLimit: 14700, balanceDueDate: `${addMonths(current, 1)}-15T03:00:00.000Z` } });

  inTransaction(db, () => {
    db.insert(connections)
      .values([
        { id: 'demo-c6', owner: 'pessoa1', institution: 'C6', status: 'UPDATED', lastSyncAt: nowIso, lastSuccessAt: nowIso },
        { id: 'demo-inter', owner: 'pessoa2', institution: 'Inter', status: 'UPDATED', lastSyncAt: nowIso, lastSuccessAt: nowIso },
      ])
      .run();
    // Regras de verdade para o que vem marcado como regra: o reprocessamento recalcula tudo que não é manual.
    const rule = (merchantKey: string, category: string, kind: 'income' | 'expense', direction: 'in' | 'out', cents?: number) =>
      db
        .insert(rules)
        .values({
          merchantKey,
          direction,
          minCents: cents ?? null,
          maxCents: cents ?? null,
          setCategoryId: categoryId.get(`${kind}:${category}`) ?? null,
          origin: 'user',
          createdAt: nowIso,
        })
        .run();
    rule('SALARIO EMPRESA EXEMPLO', 'Salário', 'income', 'in');
    rule('PJ EXEMPLO LTDA', 'Pró-labore', 'income', 'in', 900000);
    rule('PJ EXEMPLO LTDA', 'Lucros do PJ', 'income', 'in', 350000);
    rule('IMOBILIARIA EXEMPLO', 'Moradia', 'expense', 'out');
    rule('CONDOMINIO EDIFICIO EXEMPLO', 'Moradia', 'expense', 'out');
    db.insert(accounts)
      .values([
        { id: 'c6-checking', connectionId: 'demo-c6', kind: 'checking', name: 'C6 · Conta corrente', owner: 'pessoa1' },
        { id: 'c6-card', connectionId: 'demo-c6', kind: 'credit_card', name: 'C6 · Cartão', owner: 'pessoa1', raw: creditRaw },
        { id: 'c6-cdb', connectionId: 'demo-c6', kind: 'investment', name: 'C6 · CDB liquidez diária', owner: 'pessoa1' },
        { id: 'inter-checking', connectionId: 'demo-inter', kind: 'checking', name: 'Inter · Conta', owner: 'pessoa2' },
        { id: 'inter-cdb', connectionId: 'demo-inter', kind: 'investment', name: 'Inter · CDB', owner: 'pessoa2', raw: JSON.stringify({ rateType: 'IPCA', fixedAnnualRate: 6 }) },
        { id: 'c6-cdb-fatura', connectionId: 'demo-c6', kind: 'investment', name: 'C6 · CDB - BANCO EXEMPLO S.A.', owner: 'pessoa1', raw: JSON.stringify({ rate: 102, rateType: 'CDI' }) },
      ])
      .run();
    txs.forEach((t, n) => {
      const id = `demo-${n}`;
      db.insert(transactions)
        .values({
          id,
          accountId: t.accountId,
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          merchantKey: normalizeMerchantKey(t.description),
          status: 'posted',
          cardLast4: t.accountId === 'c6-card' ? '1234' : null,
          installmentNumber: t.installment?.[0] ?? null,
          installmentTotal: t.installment?.[1] ?? null,
          billId: t.billId ?? null,
          counterpartDocType: t.counterpart?.[0] ?? null,
          counterpartDoc: t.counterpart?.[1] ?? null,
          raw: '{}',
          firstSeenAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      const nature = t.nature ?? (t.amountCents > 0 ? 'income' : 'expense');
      const kind = nature === 'income' ? 'income' : 'expense';
      db.insert(classifications)
        .values({
          transactionId: id,
          nature,
          transferKind: t.transferKind ?? null,
          categoryId: t.category === undefined ? null : (categoryId.get(`${kind}:${t.category}`) ?? null),
          owner: t.owner ?? 'casal',
          source: t.source ?? 'rule',
          model: t.source === 'model' ? 'demo/modelo' : null,
          confidence: t.confidence ?? null,
          reviewReason: t.reviewReason ?? null,
          updatedAt: nowIso,
        })
        .run();
    });
    db.insert(bills).values({ id: `demo-bill-${closing}`, accountId: 'c6-card', dueDate: `${closing}-15`, totalCents: billTotal, raw: '{}' }).run();

    // Saldos: CDBs no começo de cada mês e hoje; fatura aberta do cartão hoje.
    let inter = 4_000_000;
    let c6 = 300_000;
    for (let i = 0; i <= MONTHS; i++) {
      const month = addMonths(first, i);
      const date = month > current ? today : `${month}-01`;
      db.insert(balanceSnapshots).values({ accountId: 'inter-cdb', date, takenAt: `${date}T10:00:00.000Z`, balanceCents: inter }).run();
      db.insert(balanceSnapshots).values({ accountId: 'c6-cdb', date, takenAt: `${date}T10:00:00.000Z`, balanceCents: c6 }).run();
      inter += 250000 + Math.round(inter * 0.009);
      c6 += 100000 + Math.round(c6 * 0.008);
    }
    db.insert(balanceSnapshots).values({ accountId: 'c6-cdb-fatura', date: today, takenAt: `${today}T10:00:00.000Z`, balanceCents: 0 }).run();
    db.insert(balanceSnapshots).values({ accountId: 'c6-card', date: today, takenAt: `${today}T10:00:00.000Z`, balanceCents: 623000 }).run();

    // Movimentos dos CDBs: o do Inter recebe aportes e segue aberto; o do C6 é aplicado e resgatado para pagar a fatura.
    const movement = (id: string, accountId: string, date: string, type: 'BUY' | 'SELL', amountCents: number, quantity: number) =>
      db.insert(investmentMovements)
        .values({ id, accountId, date, type, amountCents, netCents: null, quantity, unitValue: type === 'BUY' ? 1 : null, raw: '{}', firstSeenAt: nowIso, updatedAt: nowIso })
        .run();
    movement('demo-inter-buy-0', 'inter-cdb', `${first}-01`, 'BUY', 4_000_000, 40_000);
    for (let i = 1; i <= MONTHS; i++) {
      const month = addMonths(first, i);
      if (month > current) break;
      movement(`demo-inter-buy-${i}`, 'inter-cdb', `${month}-01`, 'BUY', 250_000, 2_500);
      if (month === current) continue;
      movement(`demo-c6-buy-${i}`, 'c6-cdb-fatura', `${month}-05`, 'BUY', 600_000 + i * 10_000, 6_000 + i * 100);
      movement(`demo-c6-sell-${i}`, 'c6-cdb-fatura', `${month}-20`, 'SELL', 602_400 + i * 10_040, 6_000 + i * 100);
    }
    db.insert(balanceSnapshots).values({ accountId: 'c6-checking', date: today, takenAt: `${today}T10:00:00.000Z`, balanceCents: 1_250_000 }).run();
    db.insert(balanceSnapshots).values({ accountId: 'inter-checking', date: today, takenAt: `${today}T10:00:00.000Z`, balanceCents: 480_000 }).run();
  });

  ensureVoucher(db, { monthlyCents: 110000, today, nowIso });
  setUserPassword(db, 'pessoa1', DEMO_PASSWORD, nowIso);
  setUserPassword(db, 'pessoa2', DEMO_PASSWORD, nowIso);
}
