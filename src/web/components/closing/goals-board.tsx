'use client';

import { ArrowRight, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveGoalsAction } from '../../../app/(app)/fechamento/actions';
import { parseBRL } from '../../../core/money';
import type { GoalsBoard as Board } from '../../../queries/goals';
import { formatBRL, monthAbbr } from '../../format';
import { addMonths } from '../../../core/dates';
import { useClosingAction } from './use-action';

const asInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tryParse(text: string): number | null {
  try {
    return parseBRL(text);
  } catch {
    return null;
  }
}

/** Tabela de metas por categoria, com soma, renda esperada e quanto deve sobrar ao vivo. */
export function GoalsBoard({ board, path }: { board: Board; path: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(board.rows.map((r) => [r.categoryId, asInput(r.goalCents ?? r.suggestionCents)])),
  );
  const [notes, setNotes] = useState<Record<number, string>>(() => Object.fromEntries(board.rows.map((r) => [r.categoryId, r.note ?? ''])));
  const [income, setIncome] = useState(asInput(board.expectedIncomeCents));
  // Quando o quadro muda (anotação nova, por exemplo), as metas que ninguém editou acompanham a nova sugestão,
  // e categorias novas entram com a sugestão delas.
  const defaults = useRef<Record<number, string>>(Object.fromEntries(board.rows.map((r) => [r.categoryId, asInput(r.goalCents ?? r.suggestionCents)])));
  const incomeDefault = useRef(asInput(board.expectedIncomeCents));
  useEffect(() => {
    const next = Object.fromEntries(board.rows.map((r) => [r.categoryId, asInput(r.goalCents ?? r.suggestionCents)]));
    // Os atualizadores rodam depois: guardam os padrões anteriores antes de os refs mudarem.
    const previous = defaults.current;
    const previousIncome = incomeDefault.current;
    setValues((current) => {
      const merged: Record<number, string> = {};
      for (const r of board.rows) {
        const value = current[r.categoryId];
        merged[r.categoryId] = value === undefined || value === previous[r.categoryId] ? (next[r.categoryId] as string) : value;
      }
      return merged;
    });
    setNotes((current) => ({ ...Object.fromEntries(board.rows.map((r) => [r.categoryId, r.note ?? ''])), ...current }));
    defaults.current = next;
    const nextIncome = asInput(board.expectedIncomeCents);
    setIncome((current) => (current === previousIncome ? nextIncome : current));
    incomeDefault.current = nextIncome;
  }, [board]);
  const save = useClosingAction(
    () =>
      saveGoalsAction(
        path,
        board.targetMonth,
        board.rows.map((r) => ({ categoryId: r.categoryId, value: values[r.categoryId] ?? '0', note: notes[r.categoryId] ?? '' })),
        income === asInput(board.expectedIncomeCents) && board.expectedIncomeIsDefault ? null : income,
      ),
    () => router.push(path.replace(/metas$/, 'investimentos')),
  );
  const totals = useMemo(() => {
    const goals = board.rows.map((r) => tryParse(values[r.categoryId] ?? '') ?? 0);
    const goalsTotal = goals.reduce((a, b) => a + b, 0);
    const average = board.rows.reduce((a, r) => a + r.averageCents, 0);
    const incomeCents = tryParse(income) ?? 0;
    const cuts = board.rows.filter((r, i) => (goals[i] ?? 0) < r.suggestionCents).map((r) => r.name);
    return { goalsTotal, diff: goalsTotal - average, remain: incomeCents - goalsTotal, cuts };
  }, [values, income, board.rows]);
  const range = `${monthAbbr(addMonths(board.closingMonth, -2))}–${monthAbbr(board.closingMonth)}`;
  const reasons = [board.notes.map((n) => n.title).join(' e '), totals.cuts.length > 0 ? `com cortes em ${totals.cuts.join(', ')}` : '']
    .filter((x) => x !== '')
    .join(', ');
  const invalid = board.rows.some((r) => tryParse(values[r.categoryId] ?? '') === null) || tryParse(income) === null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-5 rounded-[14px] border border-line bg-surface p-5 lg:p-7">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-2">Soma das metas</span>
            <span className="num text-[32px] leading-none font-medium lg:text-[36px]">{formatBRL(totals.goalsTotal)}</span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-2">Renda esperada {board.expectedIncomeIsDefault && <span className="text-ink-3">(média)</span>}</span>
            <Input aria-label="Renda esperada" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} className="num h-11 bg-surface text-xl" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-2">Deve sobrar</span>
            <span className={`num text-[32px] leading-none font-medium lg:text-[36px] ${totals.remain >= 0 ? 'text-good' : 'text-warn'}`}>{formatBRL(totals.remain)}</span>
          </div>
        </div>
        {totals.diff !== 0 && (
          <p className="inline-flex items-start gap-1.5 self-start rounded-2xl bg-attn-soft px-3 py-1.5 text-[13px] font-medium text-attn">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {formatBRL(Math.abs(totals.diff))} {totals.diff > 0 ? 'acima' : 'abaixo'} da média de {range}
            {reasons === '' ? '' : `: ${reasons}`}
          </p>
        )}
      </section>

      <section className="flex flex-col">
        <h2 className="pb-3 text-xl font-bold">Por categoria</h2>
        <div className="hidden grid-cols-[1fr_120px_120px_120px_130px_200px] gap-4 px-3 pb-2 text-[13px] text-ink-2 lg:grid">
          <span>Categoria</span>
          <span className="text-right">média {range}</span>
          <span className="text-right">{monthAbbr(board.closingMonth)}</span>
          <span className="text-right">sugestão</span>
          <span className="text-right">meta de {monthAbbr(board.targetMonth)}</span>
          <span>nota</span>
        </div>
        <ul className="flex flex-col gap-2 lg:gap-0">
          {board.rows.map((r) => {
            const goal = tryParse(values[r.categoryId] ?? '');
            const cut = goal !== null && goal < r.suggestionCents;
            return (
              <li
                key={r.categoryId}
                className={`grid grid-cols-2 items-center gap-x-4 gap-y-2 rounded-[10px] p-3 lg:grid-cols-[1fr_120px_120px_120px_130px_200px] lg:rounded-lg ${r.noteFromPlan !== null ? 'bg-attn-soft' : 'bg-surface lg:bg-transparent'}`}
              >
                <span className="col-span-2 text-[15px] font-medium lg:col-span-1">{r.name}</span>
                <span className="num text-[13px] whitespace-nowrap text-ink-2 lg:text-right lg:text-[15px] lg:text-ink">
                  <span className="lg:hidden">média </span>
                  {formatBRL(r.averageCents)}
                </span>
                <span className="num hidden text-right text-[15px] text-ink-2 lg:block">{formatBRL(r.closingMonthCents)}</span>
                <span className="num text-right text-[13px] whitespace-nowrap text-ink-2 lg:text-[15px]">
                  <span className="lg:hidden">sugestão </span>
                  {formatBRL(r.suggestionCents)}
                </span>
                <Input
                  aria-label={`Meta de ${r.name}`}
                  inputMode="decimal"
                  value={values[r.categoryId] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [r.categoryId]: e.target.value }))}
                  className={`num col-span-2 h-9 bg-surface text-right lg:col-span-1 ${cut ? 'font-semibold text-good' : ''} ${goal === null ? 'border-warn' : ''}`}
                />
                <Input
                  aria-label={`Nota de ${r.name}`}
                  placeholder={r.noteFromPlan ?? 'nota'}
                  value={notes[r.categoryId] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [r.categoryId]: e.target.value }))}
                  className="col-span-2 h-9 bg-surface lg:col-span-1"
                />
              </li>
            );
          })}
        </ul>
      </section>
      <Button type="button" className="h-11 self-start px-5 text-[15px]" disabled={invalid || save.isPending} onClick={() => save.mutate(undefined)}>
        {save.isPending ? 'Salvando…' : 'Salvar metas'} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
