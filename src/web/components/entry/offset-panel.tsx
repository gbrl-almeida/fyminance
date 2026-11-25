'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { linkOffset, unlinkOffset } from '../../../app/(app)/lancamento/actions';
import type { EntryCandidate, EntryLink } from '../../../queries/entry';
import { formatBRL, formatDay } from '../../format';
import { useEntryAction } from './use-entry-action';

const asInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Abatimentos de uma compra (créditos que voltaram) ou de um crédito (compras que ele pagou), com os candidatos. */
export function OffsetPanel({
  mode,
  entryId,
  leftCents,
  links,
  candidates,
  path,
}: {
  mode: 'purchase' | 'credit';
  entryId: string;
  leftCents: number;
  links: EntryLink[];
  candidates: EntryCandidate[];
  path: string;
}) {
  const pair = (otherId: string) => (mode === 'purchase' ? { creditId: otherId, purchaseId: entryId } : { creditId: entryId, purchaseId: otherId });
  const unlink = useEntryAction((otherId: string) => {
    const { creditId, purchaseId } = pair(otherId);
    return unlinkOffset(path, creditId, purchaseId);
  });
  return (
    <div className="flex flex-col gap-4">
      {links.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {links.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="flex min-w-0 flex-col">
                <Link href={`/lancamento/${l.id}`} className="truncate text-sm font-medium hover:underline">
                  {l.description}
                </Link>
                <span className="text-xs text-ink-3">
                  {formatDay(l.date)} · {l.account}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="num text-sm">{formatBRL(l.amountCents)}</span>
                <button type="button" disabled={unlink.isPending} onClick={() => unlink.mutate(l.id)} className="text-xs font-semibold text-ink-2 hover:text-ink">
                  Desfazer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {leftCents > 0 && candidates.length === 0 && (
        <p className="text-sm text-ink-2">{mode === 'purchase' ? 'Nenhum crédito perto da data da compra. Use a busca.' : 'Nenhuma compra perto da data do crédito. Use a busca.'}</p>
      )}
      {leftCents > 0 && candidates.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {candidates.map((c) => (
            <Candidate key={c.id} candidate={c} maxCents={Math.min(c.leftCents, leftCents)} path={path} {...pair(c.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Candidate({ candidate, maxCents, path, creditId, purchaseId }: { candidate: EntryCandidate; maxCents: number; path: string; creditId: string; purchaseId: string }) {
  const [value, setValue] = useState(asInput(maxCents));
  const link = useEntryAction((amount: string) => linkOffset(path, creditId, purchaseId, amount));
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Link href={`/lancamento/${candidate.id}`} className="truncate text-sm font-medium hover:underline">
            {candidate.description}
          </Link>
          <span className="text-xs text-ink-3">
            {[formatDay(candidate.date), candidate.account, candidate.installment === null ? null : `parcela ${candidate.installment}`].filter((x) => x !== null).join(' · ')}
          </span>
          {candidate.match && <span className="text-xs font-semibold text-good">valor igual</span>}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="num text-sm">
            {candidate.amountCents > 0 ? '+' : ''}
            {formatBRL(Math.abs(candidate.amountCents))}
          </span>
          {candidate.leftCents !== Math.abs(candidate.amountCents) && <span className="text-xs text-ink-3">{candidate.amountCents > 0 ? 'sobra' : 'falta'} {formatBRL(candidate.leftCents)}</span>}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Input aria-label="Valor a abater" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="num h-8 w-[110px] bg-surface" />
        <Button type="button" size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(value)}>
          Abater
        </Button>
      </div>
    </li>
  );
}
