'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveNote } from '../../../app/(app)/lancamento/actions';
import { useEntryAction } from './use-entry-action';

/** Anotação livre sobre a transação; salvar vazio apaga. */
export function NoteEditor({ transactionId, note, path }: { transactionId: string; note: string; path: string }) {
  const [text, setText] = useState(note);
  const save = useEntryAction((value: string) => saveNote(path, transactionId, value));
  const changed = text.trim() !== note.trim();
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Anotação"
        placeholder="Do que se trata? Ex.: creatina e pré-treino; pneus do carro"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        className="min-h-20 bg-surface"
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate(text)}>
          {save.isPending ? 'Salvando…' : 'Salvar anotação'}
        </Button>
      </div>
    </div>
  );
}
