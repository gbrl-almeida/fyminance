'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveSplit } from '../../../app/(app)/lancamento/actions';
import { parseBRL } from '../../../core/money';
import type { Owner } from '../../../core/types';
import { formatBRL } from '../../format';
import { CategorySelect, type CategoryOption } from '../category-select';
import { OwnerPicker } from '../owner-picker';
import { useEntryAction } from './use-entry-action';

interface Draft {
  value: string;
  categoryId: number | null;
  owner: Owner;
}

const asInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function centsOf(value: string): number | null {
  try {
    return parseBRL(value);
  } catch {
    return null;
  }
}

/** Divide a saída em partes; a última se completa com o que falta para fechar o total. */
export function SplitEditor({
  transactionId,
  totalCents,
  parts,
  categoryId,
  owner,
  options,
  path,
}: {
  transactionId: string;
  totalCents: number;
  parts: Array<{ amountCents: number; categoryId: number; owner: Owner }>;
  categoryId: number | null;
  owner: Owner;
  options: CategoryOption[];
  path: string;
}) {
  const saved = parts.map((p) => ({ value: asInput(p.amountCents), categoryId: p.categoryId, owner: p.owner }));
  const [drafts, setDrafts] = useState<Draft[]>(saved);
  const save = useEntryAction((input: Draft[]) =>
    saveSplit(
      path,
      transactionId,
      input.map((d) => ({ value: d.value, categoryId: d.categoryId as number, owner: d.owner })),
    ),
  );
  if (drafts.length === 0) {
    return (
      <Button type="button" variant="outline" className="self-start" onClick={() => setDrafts([{ value: '', categoryId, owner }, { value: '', categoryId: null, owner }])}>
        Dividir em categorias
      </Button>
    );
  }
  const typed = drafts.slice(0, -1).map((d) => centsOf(d.value));
  const rest = totalCents - typed.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
  const complete = typed.every((cents) => cents !== null && cents > 0) && rest > 0 && drafts.every((d) => d.categoryId !== null);
  const update = (index: number, patch: Partial<Draft>) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {drafts.map((draft, index) => {
          const last = index === drafts.length - 1;
          return (
            <li key={index} className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Valor da parte ${index + 1}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={last ? (rest > 0 ? asInput(rest) : '') : draft.value}
                  readOnly={last}
                  onChange={(e) => update(index, { value: e.target.value })}
                  className={`num h-9 w-[120px] bg-surface ${last ? 'text-ink-2' : ''}`}
                />
                <div className="min-w-0 flex-1">
                  <CategorySelect options={options} value={draft.categoryId} onChange={(id) => update(index, { categoryId: id })} invalid />
                </div>
                {drafts.length > 2 && !last && (
                  <button type="button" aria-label="Tirar parte" onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))} className="text-ink-3 hover:text-ink">
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <OwnerPicker value={draft.owner} onChange={(o) => update(index, { owner: o })} />
            </li>
          );
        })}
      </ul>
      {rest <= 0 && <p className="text-[13px] text-warn">As partes passam do total de {formatBRL(totalCents)}.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts((prev) => [...prev.slice(0, -1), { value: '', categoryId: null, owner }, prev.at(-1) as Draft])}>
          <Plus className="size-4" /> Parte
        </Button>
        <div className="flex gap-2">
          {parts.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => save.mutate([])}>
              Desfazer divisão
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts([])}>
              Cancelar
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!complete || save.isPending}
            onClick={() => save.mutate(drafts.map((d, i) => (i === drafts.length - 1 ? { ...d, value: asInput(rest) } : d)))}
          >
            {save.isPending ? 'Salvando…' : 'Salvar divisão'}
          </Button>
        </div>
      </div>
    </div>
  );
}
