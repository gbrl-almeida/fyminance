'use client';

import { Banknote, CreditCard, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeManualEntry, setCheck, setFlash } from '../../../app/(app)/fechamento/actions';
import type { Actor } from '../../../core/types';
import type { OutsidePluggy as OutsideView } from '../../../queries/closing';
import { formatBRL, formatDay, OWNER_LABEL } from '../../format';
import { StepIcon } from '../bits';
import type { CategoryOption } from '../category-select';
import { ExpandableText } from '../expandable-text';
import { ManualEntryForm } from './manual-entry-form';
import { useClosingAction } from './use-action';

const byName = (actor: Actor) => (actor === 'claude' ? 'Claude' : OWNER_LABEL[actor]);
const asInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OutsidePluggy({ view, month, path, defaultDate, expenseOptions, incomeOptions }: { view: OutsideView; month: string; path: string; defaultDate: string; expenseOptions: CategoryOption[]; incomeOptions: CategoryOption[] }) {
  const [adding, setAdding] = useState(false);
  const [flash, setFlashValue] = useState(view.flash === null ? '' : asInput(view.flash.cents));
  const saveFlash = useClosingAction((value: string) => setFlash(path, month, value));
  const cash = useClosingAction((done: boolean) => setCheck(path, month, 'cash', done));
  const remove = useClosingAction((id: string) => removeManualEntry(path, id));
  return (
    <div className="flex flex-col gap-3">
      {view.flash !== null && (
        <div className="flex flex-col gap-3 rounded-[10px] bg-canvas p-3.5 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-3">
            <StepIcon state={view.flash.confirmedBy === null ? 'pending' : 'done'} />
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                <CreditCard className="size-4 text-ink-2" /> Vale-alimentação
              </span>
              <span className="text-[13px] text-ink-2">
                {view.flash.confirmedBy === null ? 'Gasto estimado do mês: confira no app do vale' : `Alimentação · conferido por ${byName(view.flash.confirmedBy)}`}
              </span>
            </div>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveFlash.mutate(flash);
            }}
          >
            <Input aria-label="Gasto do vale-alimentação no mês" inputMode="decimal" value={flash} onChange={(e) => setFlashValue(e.target.value)} className="num w-32 bg-surface" />
            <Button type="submit" variant="outline" disabled={saveFlash.isPending}>
              {view.flash.confirmedBy === null ? 'Confirmar' : 'Salvar'}
            </Button>
          </form>
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-[10px] bg-canvas p-3.5 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <StepIcon state={view.cashConfirmedBy === null ? 'pending' : 'done'} />
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5 text-[15px] font-semibold">
              <Banknote className="size-4 text-ink-2" /> Dinheiro vivo e avulsos
            </span>
            <span className="text-[13px] text-ink-2">
              {view.cashConfirmedBy === null ? 'Lance o que foi pago fora dos bancos, ou confirme que não houve nada' : `conferido por ${byName(view.cashConfirmedBy)}`}
            </span>
          </div>
        </div>
        <Button type="button" variant="outline" disabled={cash.isPending} onClick={() => cash.mutate(view.cashConfirmedBy === null)}>
          {view.cashConfirmedBy === null ? (view.entries.length === 0 ? 'Nada este mês' : 'Está tudo lançado') : 'Desfazer'}
        </Button>
      </div>
      {view.entries.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {view.entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 flex-col">
                <ExpandableText text={entry.description} className="text-sm" />
                <span className="text-xs text-ink-3">
                  {[formatDay(entry.date), entry.category, entry.account, entry.createdBy === null ? null : `lançado por ${OWNER_LABEL[entry.createdBy]}`]
                    .filter((x) => x !== null)
                    .join(' · ')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`num text-sm ${entry.amountCents > 0 ? 'text-good' : ''}`}>
                  {entry.amountCents > 0 ? '+' : ''}
                  {formatBRL(Math.abs(entry.amountCents))}
                </span>
                <button type="button" aria-label="Apagar lançamento" onClick={() => remove.mutate(entry.id)} className="rounded-md p-1.5 text-ink-3 hover:bg-track hover:text-warn">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <ManualEntryForm path={path} defaultDate={defaultDate} expenseOptions={expenseOptions} incomeOptions={incomeOptions} onClose={() => setAdding(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Lançar gasto ou renda manual
          </Button>
          <Link href="/importar" className="text-[13px] font-semibold text-ink-2 hover:text-ink">
            Importar fatura (CSV)
          </Link>
        </div>
      )}
    </div>
  );
}
