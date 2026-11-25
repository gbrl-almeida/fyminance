'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeNote, upsertNote } from '../../../app/(app)/fechamento/actions';
import type { PlanNoteView } from '../../../queries/goals';
import { formatBRL, monthName, OWNER_LABEL } from '../../format';
import { CategorySelect, type CategoryOption } from '../category-select';
import { useClosingAction } from './use-action';

interface Line {
  categoryId: number | null;
  sign: 1 | -1;
  value: string;
}

/** "O que muda no mês seguinte": anotações com categorias e valores a mais ou a menos. */
export function PlanNotes({ notes, targetMonth, path, options }: { notes: PlanNoteView[]; targetMonth: string; path: string; options: CategoryOption[] }) {
  const [adding, setAdding] = useState(false);
  const remove = useClosingAction((id: number) => removeNote(path, id));
  const name = monthName(targetMonth).split(' ')[0];
  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">O que muda em {name}</h2>
        <p className="text-sm text-ink-2">Viagem, fim das férias, presente: o que vai deixar o mês diferente da média.</p>
      </div>
      {notes.map((note) => (
        <div key={note.id} className="flex flex-col gap-2 rounded-[10px] bg-canvas p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[15px] font-semibold">{note.title}</span>
            <button type="button" aria-label={`Apagar ${note.title}`} onClick={() => remove.mutate(note.id)} className="rounded-md p-1 text-ink-3 hover:bg-track hover:text-warn">
              <Trash2 className="size-4" />
            </button>
          </div>
          {note.lines.map((line) => (
            <div key={line.categoryId} className="flex justify-between text-sm">
              <span className="text-ink-2">{line.name}</span>
              <span className="num text-attn">
                {line.deltaCents > 0 ? '+' : '−'}
                {formatBRL(Math.abs(line.deltaCents))}
              </span>
            </div>
          ))}
          {note.createdBy !== null && <span className="text-xs text-ink-3">{OWNER_LABEL[note.createdBy]} anotou</span>}
        </div>
      ))}
      {adding ? (
        <NoteForm targetMonth={targetMonth} path={path} options={options} onClose={() => setAdding(false)} />
      ) : (
        <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Anotar mudança
        </Button>
      )}
    </section>
  );
}

function NoteForm({ targetMonth, path, options, onClose }: { targetMonth: string; path: string; options: CategoryOption[]; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Line[]>([{ categoryId: null, sign: 1, value: '' }]);
  const save = useClosingAction((input: Parameters<typeof upsertNote>[1]) => upsertNote(path, input), onClose);
  const update = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ready = title.trim() !== '' && lines.every((l) => l.categoryId !== null && l.value.trim() !== '');
  return (
    <form
      className="flex flex-col gap-3 rounded-[10px] border border-line bg-canvas p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        save.mutate({ month: targetMonth, title, lines: lines.map((l) => ({ categoryId: l.categoryId as number, sign: l.sign, value: l.value })) });
      }}
    >
      <Input aria-label="Título da anotação" placeholder="Ex.: Viagem para Floripa" value={title} onChange={(e) => setTitle(e.target.value)} className="bg-surface" />
      {lines.map((line, i) => (
        <div key={i} className="flex flex-col gap-2">
          <CategorySelect options={options} value={line.categoryId} onChange={(id) => update(i, { categoryId: id })} />
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={line.sign === 1 ? 'A mais (trocar para a menos)' : 'A menos (trocar para a mais)'}
              onClick={() => update(i, { sign: line.sign === 1 ? -1 : 1 })}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface"
            >
              {line.sign === 1 ? <Plus className="size-4" /> : <Minus className="size-4" />}
            </button>
            <Input aria-label="Valor da mudança" inputMode="decimal" placeholder="0,00" value={line.value} onChange={(e) => update(i, { value: e.target.value })} className="num bg-surface" />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setLines((prev) => [...prev, { categoryId: null, sign: 1, value: '' }])} className="self-start text-[13px] font-semibold text-ink-2">
        + outra categoria
      </button>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!ready || save.isPending}>
          Salvar anotação
        </Button>
      </div>
    </form>
  );
}
