import { eq } from 'drizzle-orm';
import { purchaseCapacityCents, purchaseUnitKey } from '../core/adjustments';
import { addDays } from '../core/dates';
import { matchesSearch } from '../core/search';
import type { AccountKind, Nature, Owner, ReviewReason, Tx, TxStatus } from '../core/types';
import type { Db } from '../db/client';
import { categoryPath, loadCategories, loadClassifications, loadTxs } from '../db/ledger';
import { accounts, transactionNotes } from '../db/schema';
import { loadOffsets, loadSplits } from './rows';

/** Até quantos dias entre compra e crédito a tela sugere ligar os dois; a busca procura em tudo. */
const CANDIDATE_WINDOW_DAYS = 120;
/** Sem busca, só os mais prováveis; com busca, mais resultados. */
const CANDIDATE_LIMIT = 10;
const SEARCH_LIMIT = 30;

export interface EntryLink {
  id: string;
  date: string;
  description: string;
  account: string;
  /** Quanto este crédito abateu desta compra. */
  amountCents: number;
}

export interface EntryCandidate {
  id: string;
  date: string;
  description: string;
  account: string;
  amountCents: number;
  installment: string | null;
  /** O que ainda falta abater na compra, ou o que sobra do crédito. */
  leftCents: number;
  /** O valor bate: o crédito cobre a compra inteira ou um número exato de parcelas. */
  match: boolean;
}

export interface Entry {
  id: string;
  date: string;
  description: string;
  merchantKey: string;
  account: string;
  accountKind: AccountKind;
  amountCents: number;
  status: TxStatus;
  installment: string | null;
  nature: Nature | null;
  categoryId: number | null;
  category: string | null;
  owner: Owner | null;
  reviewReason: ReviewReason | null;
  note: { text: string; by: string; at: string } | null;
  /** Divisão da compra; numa compra parcelada, feita em uma das parcelas (`anchorId`) e valendo para todas. */
  split: { anchorId: string; parts: Array<{ amountCents: number; categoryId: number; category: string; owner: Owner }> } | null;
  /** Numa saída: o total da compra (com as parcelas que ainda vão chegar), o que voltou e o que falta. */
  purchase: { totalCents: number; offsetCents: number; leftCents: number; links: EntryLink[] } | null;
  /** Numa entrada: quanto do crédito já abateu compras e quanto sobra. */
  credit: { totalCents: number; usedCents: number; leftCents: number; links: EntryLink[] } | null;
  /** Créditos que podem abater esta compra, ou compras que este crédito pode abater; os de valor igual primeiro. */
  candidates: EntryCandidate[];
}

const installmentOf = (tx: Tx): string | null =>
  tx.installmentNumber !== null && tx.installmentTotal !== null ? `${tx.installmentNumber}/${tx.installmentTotal}` : null;

/** Valores que fecham com a compra: o que falta nela ou um número exato de parcelas. */
function closes(credit: number, purchase: Tx, leftCents: number): boolean {
  if (credit === leftCents) return true;
  const total = purchase.installmentTotal ?? 1;
  return Array.from({ length: total }, (_, k) => (k + 1) * -purchase.amountCents).includes(credit);
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function getEntry(db: Db, id: string, options: { search?: string } = {}): Entry {
  const txs = loadTxs(db).filter((t) => t.status !== 'removed');
  const tx = txs.find((t) => t.id === id);
  if (tx === undefined) throw new Error(`A transação ${id} não existe ou foi removida.`);
  const byId = new Map(txs.map((t) => [t.id, t]));
  const classifications = loadClassifications(db);
  const list = loadCategories(db);
  const accountNames = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  const accountOf = (t: Tx) => accountNames.get(t.accountId) ?? t.accountId;
  const offsets = loadOffsets(db).filter((o) => byId.has(o.creditId) && byId.has(o.purchaseId));
  const cls = classifications.get(tx.id) ?? null;
  const counts = (t: Tx) => classifications.get(t.id)?.nature !== 'transfer';

  const usedOf = (credit: Tx) => offsets.filter((o) => o.creditId === credit.id).reduce((s, o) => s + o.amountCents, 0);
  const unitOffsets = (purchase: Tx) => {
    const unit = purchaseUnitKey(purchase);
    return offsets.filter((o) => purchaseUnitKey(byId.get(o.purchaseId) as Tx) === unit);
  };
  const leftOf = (purchase: Tx) => purchaseCapacityCents(purchase, txs) - unitOffsets(purchase).reduce((s, o) => s + o.amountCents, 0);
  const link = (other: Tx, amountCents: number): EntryLink => ({ id: other.id, date: other.date, description: other.description, account: accountOf(other), amountCents });

  const search = options.search?.trim() ?? '';
  const noteRows = new Map(db.select().from(transactionNotes).all().map((n) => [n.transactionId, n]));
  const found = (t: Tx) => matchesSearch(search, [t.description, t.merchantKey, accountOf(t), noteRows.get(t.id)?.note ?? ''], [t.amountCents]);

  let purchase: Entry['purchase'] = null;
  let credit: Entry['credit'] = null;
  let candidates: EntryCandidate[] = [];
  if (counts(tx) && tx.amountCents < 0) {
    const mine = unitOffsets(tx);
    const totalCents = purchaseCapacityCents(tx, txs);
    const offsetCents = mine.reduce((s, o) => s + o.amountCents, 0);
    purchase = { totalCents, offsetCents, leftCents: totalCents - offsetCents, links: mine.map((o) => link(byId.get(o.creditId) as Tx, o.amountCents)) };
    const bought = tx.purchaseDate ?? tx.date;
    // Renda já decidida (salário, PJ) e o voucher não pagam compras de volta; a busca ainda os encontra.
    const reimbursable = (t: Tx) => {
      const decided = classifications.get(t.id);
      return t.accountKind !== 'voucher' && !(decided?.nature === 'income' && (decided.source === 'rule' || decided.source === 'manual'));
    };
    candidates = txs
      .filter((t) => t.amountCents > 0 && counts(t) && !mine.some((o) => o.creditId === t.id))
      .filter((t) => search !== '' || reimbursable(t))
      // Estorno de cartão só vale no próprio cartão.
      .filter((t) => t.accountKind !== 'credit_card' || t.accountId === tx.accountId)
      .filter((t) => (search === '' ? t.date >= bought && t.date <= addDays(bought, CANDIDATE_WINDOW_DAYS) : found(t)))
      .map((t) => {
        const leftCents = t.amountCents - usedOf(t);
        return { t, leftCents, match: closes(leftCents, tx, purchase?.leftCents ?? 0), distance: daysBetween(t.date, bought) };
      })
      .filter((c) => c.leftCents > 0)
      .sort((a, b) => Number(b.match) - Number(a.match) || a.distance - b.distance || a.t.id.localeCompare(b.t.id))
      .map(({ t, leftCents, match }) => ({ id: t.id, date: t.date, description: t.description, account: accountOf(t), amountCents: t.amountCents, installment: installmentOf(t), leftCents, match }));
  } else if (counts(tx) && tx.amountCents > 0) {
    const mine = offsets.filter((o) => o.creditId === tx.id);
    const usedCents = mine.reduce((s, o) => s + o.amountCents, 0);
    credit = { totalCents: tx.amountCents, usedCents, leftCents: tx.amountCents - usedCents, links: mine.map((o) => link(byId.get(o.purchaseId) as Tx, o.amountCents)) };
    const seen = new Set<string>();
    candidates = txs
      .filter((t) => t.amountCents < 0 && counts(t))
      .filter((t) => tx.accountKind !== 'credit_card' || t.accountId === tx.accountId)
      .filter((t) => {
        const bought = t.purchaseDate ?? t.date;
        return search === '' ? bought <= tx.date && bought >= addDays(tx.date, -CANDIDATE_WINDOW_DAYS) : found(t);
      })
      .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))
      // Uma compra parcelada aparece uma vez, pela primeira parcela que chegou.
      .filter((t) => {
        const unit = purchaseUnitKey(t);
        if (seen.has(unit)) return false;
        seen.add(unit);
        return true;
      })
      .map((t) => {
        const leftCents = leftOf(t);
        return { t, leftCents, match: closes(credit?.leftCents ?? 0, t, leftCents), distance: daysBetween(t.purchaseDate ?? t.date, tx.date) };
      })
      .filter((c) => c.leftCents > 0 && !mine.some((o) => purchaseUnitKey(byId.get(o.purchaseId) as Tx) === purchaseUnitKey(c.t)))
      .sort((a, b) => Number(b.match) - Number(a.match) || a.distance - b.distance || a.t.id.localeCompare(b.t.id))
      .map(({ t, leftCents, match }) => ({ id: t.id, date: t.date, description: t.description, account: accountOf(t), amountCents: t.amountCents, installment: installmentOf(t), leftCents, match }));
  }

  const unit = purchaseUnitKey(tx);
  const members = new Set(txs.filter((t) => purchaseUnitKey(t) === unit).map((t) => t.id));
  const parts = loadSplits(db)
    .filter((p) => members.has(p.transactionId))
    .sort((a, b) => a.position - b.position);
  const anchorId = parts.find((p) => p.transactionId === tx.id)?.transactionId ?? parts[0]?.transactionId;
  const split =
    anchorId === undefined
      ? null
      : {
          anchorId,
          parts: parts
            .filter((p) => p.transactionId === anchorId)
            .map((p) => ({ amountCents: p.amountCents, categoryId: p.categoryId, category: categoryPath(list, p.categoryId), owner: p.owner })),
        };
  const note = db.select().from(transactionNotes).where(eq(transactionNotes.transactionId, tx.id)).get();

  return {
    id: tx.id,
    date: tx.date,
    description: tx.description,
    merchantKey: tx.merchantKey,
    account: accountOf(tx),
    accountKind: tx.accountKind,
    amountCents: tx.amountCents,
    status: tx.status,
    installment: installmentOf(tx),
    nature: cls?.nature ?? null,
    categoryId: cls?.categoryId ?? null,
    category: cls?.categoryId == null ? null : categoryPath(list, cls.categoryId),
    owner: cls?.owner ?? null,
    reviewReason: cls?.reviewReason ?? null,
    note: note === undefined ? null : { text: note.note, by: note.updatedBy, at: note.updatedAt },
    split,
    purchase,
    credit,
    candidates: candidates.slice(0, search === '' ? CANDIDATE_LIMIT : SEARCH_LIMIT),
  };
}
