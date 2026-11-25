'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addManualEntry } from '../../../app/(app)/fechamento/actions';
import type { Owner } from '../../../core/types';
import { CategorySelect, type CategoryOption } from '../category-select';
import { OwnerPicker } from '../owner-picker';
import { useClosingAction } from './use-action';

export interface ManualDefaults {
  accountId?: string;
  billId?: string;
  description?: string;
  value?: string;
  nature?: 'expense' | 'income';
}

/** Lançamento manual: vale-alimentação, dinheiro vivo, diferença de fatura ou renda que a Pluggy não trouxe. */
export function ManualEntryForm({
  path,
  defaultDate,
  expenseOptions,
  incomeOptions,
  defaults = {},
  onClose,
}: {
  path: string;
  defaultDate: string;
  expenseOptions: CategoryOption[];
  incomeOptions: CategoryOption[];
  defaults?: ManualDefaults;
  onClose: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState(defaults.description ?? '');
  const [value, setValue] = useState(defaults.value ?? '');
  const [nature, setNature] = useState<'expense' | 'income'>(defaults.nature ?? 'expense');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [owner, setOwner] = useState<Owner>('casal');
  const save = useClosingAction(
    (input: Parameters<typeof addManualEntry>[1]) => addManualEntry(path, input),
    onClose,
  );
  return (
    <form
      className="flex flex-col gap-3 rounded-[10px] border border-line bg-canvas p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (categoryId === null) return;
        save.mutate({
          ...(defaults.accountId === undefined ? {} : { accountId: defaults.accountId }),
          ...(defaults.billId === undefined ? {} : { billId: defaults.billId }),
          date, value, description, nature, categoryId, owner });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Data
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="bg-surface" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Valor (R$)
          <Input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} required className="num bg-surface" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[13px] text-ink-2">
        Descrição
        <Input value={description} onChange={(e) => setDescription(e.target.value)} required className="bg-surface" />
      </label>
      <div role="radiogroup" aria-label="Tipo" className="flex gap-0.5 self-start rounded-lg bg-track p-0.5">
        {(
          [
            ['expense', 'Gasto'],
            ['income', 'Renda'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={nature === value}
            onClick={() => {
              setNature(value);
              setCategoryId(null);
            }}
            className={`rounded-md px-3 py-1.5 text-[13px] ${nature === value ? 'bg-surface font-semibold' : 'text-ink-2'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <CategorySelect options={nature === 'expense' ? expenseOptions : incomeOptions} value={categoryId} onChange={setCategoryId} invalid />
      <OwnerPicker value={owner} onChange={setOwner} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={save.isPending || categoryId === null}>
          {save.isPending ? 'Lançando…' : 'Lançar'}
        </Button>
      </div>
    </form>
  );
}
