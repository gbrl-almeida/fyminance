'use client';

import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { explain } from '../../../app/(app)/fechamento/actions';
import type { Actor } from '../../../core/types';
import { formatBRL, formatDay, OWNER_LABEL } from '../../format';
import type { CategoryOption } from '../category-select';
import { ManualEntryForm } from './manual-entry-form';
import { useClosingAction } from './use-action';

export interface DivergenceItem {
  key: string;
  kind: 'bill' | 'balance';
  account: string;
  accountId: string;
  date: string;
  bankCents: number | null;
  importedCents: number | null;
  diffCents: number;
  explanation: { note: string; by: Actor; at: string } | null;
}

const byName = (actor: Actor) => (actor === 'claude' ? 'Claude' : OWNER_LABEL[actor]);
// Fatura: total do banco maior que o importado = gasto faltando. Saldo: deriva negativa = saída faltando.
const missingExpense = (item: DivergenceItem) => (item.kind === 'bill' ? item.diffCents > 0 : item.diffCents < 0);
const asInput = (cents: number) => (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Divergences({ items, path, defaultDate, expenseOptions, incomeOptions }: { items: DivergenceItem[]; path: string; defaultDate: string; expenseOptions: CategoryOption[]; incomeOptions: CategoryOption[] }) {
  if (items.length === 0) return <p className="text-[15px] text-good">Faturas e saldos batem.</p>;
  return (
    <ul className="flex flex-col gap-5">
      {items.map((item) => (
        <DivergenceRow key={item.key} item={item} path={path} defaultDate={defaultDate} expenseOptions={expenseOptions} incomeOptions={incomeOptions} />
      ))}
    </ul>
  );
}

function DivergenceRow({ item, path, defaultDate, expenseOptions, incomeOptions }: { item: DivergenceItem; path: string; defaultDate: string; expenseOptions: CategoryOption[]; incomeOptions: CategoryOption[] }) {
  const [mode, setMode] = useState<'idle' | 'entry' | 'explain'>('idle');
  const [note, setNote] = useState('');
  const save = useClosingAction((input: { key: string; note: string }) => explain(path, input.key, input.note), () => setMode('idle'));
  const title = item.kind === 'bill' ? `Fatura do ${item.account} (vence ${formatDay(item.date)})` : `Saldo da ${item.account}`;
  return (
    <li className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className={`num shrink-0 whitespace-nowrap text-[15px] font-semibold ${item.explanation === null ? 'text-attn' : 'text-ink-3'}`}>{formatBRL(item.diffCents)}</span>
      </div>
      {item.bankCents !== null && item.importedCents !== null && (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-2">Total no banco</dt>
            <dd className="num">{formatBRL(item.bankCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-2">Transações importadas</dt>
            <dd className="num">{formatBRL(item.importedCents)}</dd>
          </div>
        </dl>
      )}
      {item.kind === 'balance' && <p className="text-sm text-ink-2">O saldo informado pelo banco não bate com as transações desde {formatDay(item.date)}.</p>}
      {item.explanation !== null ? (
        <p className="flex items-center gap-2 text-sm text-good">
          <Check className="size-4" /> Conferida por {byName(item.explanation.by)}
          {item.explanation.note === '' ? '' : `: ${item.explanation.note}`}
        </p>
      ) : mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setMode('entry')}>
            <Plus className="size-4" /> Lançar a diferença
          </Button>
          <Button type="button" variant="outline" onClick={() => setMode('explain')}>
            <Check className="size-4" /> Conferi, está certo
          </Button>
        </div>
      ) : mode === 'explain' ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ key: item.key, note });
          }}
        >
          <Input placeholder="Nota (opcional): por que está certo" value={note} onChange={(e) => setNote(e.target.value)} className="bg-surface" />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode('idle')}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Confirmar
            </Button>
          </div>
        </form>
      ) : (
        <ManualEntryForm
          path={path}
          defaultDate={defaultDate}
          expenseOptions={expenseOptions}
          incomeOptions={incomeOptions}
          defaults={{ accountId: item.accountId, ...(item.kind === 'bill' ? { billId: item.key.slice('bill:'.length) } : {}), value: asInput(item.diffCents), description: `Diferença: ${title}`, nature: missingExpense(item) ? 'expense' : 'income' }}
          onClose={() => setMode('idle')}
        />
      )}
    </li>
  );
}
