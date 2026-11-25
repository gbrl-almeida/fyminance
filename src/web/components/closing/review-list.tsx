'use client';

import { Check, CheckCheck, Loader2, RotateCw, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { confirmSuggestions, saveReviewDecision } from '../../../app/(app)/fechamento/actions';
import { linkOffset } from '../../../app/(app)/lancamento/actions';
import { matchesSearch } from '../../../core/search';
import type { Owner, ReviewReason } from '../../../core/types';
import { formatBRL, formatDay, monthName, REVIEW_REASON_LABEL } from '../../format';
import { CategorySelect, type CategoryOption } from '../category-select';
import { useEntryAction } from '../entry/use-entry-action';
import { ExpandableText } from '../expandable-text';
import { OwnerPicker } from '../owner-picker';
import { SearchField } from '../search-field';
import { useClosingAction } from './use-action';

export interface ReviewItem {
  key: string;
  merchantKey: string;
  reason: ReviewReason;
  count: number;
  totalCents: number;
  direction: 'in' | 'out' | 'mixed';
  samples: string[];
  transactionIds: string[];
  lastDate: string;
  suggestedCategoryId: number | null;
  lateFromMonth: string | null;
  refundOf: { id: string; date: string; description: string; amountCents: number; installment: string | null } | null;
}

interface RowState {
  categoryId: number | null;
  owner: Owner;
  onlyThese: boolean;
}

interface Decision {
  categoryId: number;
  owner: Owner;
  scope: 'rule' | 'only_these';
}

type SaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'error';

/** Espera curta para juntar categoria, dono e "só esta" escolhidos em sequência numa gravação só. */
const SAVE_DELAY_MS = 700;

export function ReviewList({ items, path, expenseOptions, incomeOptions }: { items: ReviewItem[]; path: string; expenseOptions: CategoryOption[]; incomeOptions: CategoryOption[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  // Linha salva fica na tela até sair da página, mesmo depois que a revisão deixa de trazê-la.
  const [saved, setSaved] = useState<Record<string, ReviewItem>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const stateOf = (item: ReviewItem): RowState => rows[item.key] ?? { categoryId: item.suggestedCategoryId, owner: 'casal', onlyThese: false };
  const shown = useMemo(() => {
    const live = new Set(items.map((i) => i.key));
    return [...items, ...Object.values(saved).filter((i) => !live.has(i.key))].filter((i) => !confirmed.has(i.key)).sort((a, b) => b.totalCents - a.totalCents);
  }, [items, saved, confirmed]);
  const matches = (item: ReviewItem) => matchesSearch(query, [...item.samples, item.merchantKey], [item.totalCents]);
  const pending = shown.filter((i) => !(i.key in saved));
  // "Confirmar todas" leva só as linhas da busca que continuam na sugestão, com o dono e o escopo que a linha mostra.
  const suggestions = pending.filter(
    (i) => matches(i) && i.suggestedCategoryId !== null && i.direction === 'out' && i.reason === 'low_confidence' && stateOf(i).categoryId === i.suggestedCategoryId,
  );
  const confirmAll = useClosingAction(
    (groups: Array<{ transactionIds: string[]; categoryId: number; owner: Owner; scope: 'rule' | 'only_these' }>) => confirmSuggestions(path, groups),
    () => setConfirmed((prev) => new Set([...prev, ...suggestions.map((s) => s.key)])),
  );
  const inflowOptions = [...incomeOptions, ...expenseOptions.map((o) => ({ ...o, path: `Devolução · ${o.path}` }))];
  if (shown.length === 0) return <p className="py-2 text-[15px] text-good">Nada para revisar neste mês.</p>;
  const searching = query.trim() !== '';
  return (
    <div className="flex flex-col gap-3">
      <SearchField value={query} onChange={(e) => setQuery(e.target.value)} />
      {pending.length === 0 && <p className="text-[15px] text-good">Nada para revisar neste mês.</p>}
      {searching && !shown.some(matches) && <p className="text-sm text-ink-2">Nada na revisão com “{query.trim()}”.</p>}
      <ul className="flex flex-col">
        {shown.map((item) => (
          <ReviewRow
            key={item.key}
            item={item}
            path={path}
            hidden={searching && !matches(item)}
            state={stateOf(item)}
            onChange={(patch) => setRows((prev) => ({ ...prev, [item.key]: { ...stateOf(item), ...patch } }))}
            options={item.direction === 'out' ? expenseOptions : inflowOptions}
            onSaved={() => setSaved((prev) => ({ ...prev, [item.key]: item }))}
          />
        ))}
      </ul>
      {suggestions.length > 0 && (
        <div className="flex justify-end border-t border-line pt-4">
          <Button
            type="button"
            disabled={confirmAll.isPending}
            onClick={() =>
              confirmAll.mutate(
                suggestions.map((s) => {
                  const state = stateOf(s);
                  return { transactionIds: s.transactionIds, categoryId: s.suggestedCategoryId as number, owner: state.owner, scope: state.onlyThese ? 'only_these' : 'rule' };
                }),
              )
            }
          >
            <CheckCheck className="size-4" />
            Confirmar {suggestions.length} {suggestions.length === 1 ? 'sugestão' : 'sugestões'}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Grava a decisão da linha logo depois de cada mudança, para nada se perder se a página recarregar.
 * A primeira gravação cria a decisão; as seguintes a refazem, sem deixar regra repetida.
 */
function useAutosave(transactionIds: string[], path: string, onSaved: () => void) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<Decision | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const previous = useRef<{ ruleId: number | null } | undefined>(undefined);

  const write = (decision: Decision) => {
    queue.current = queue.current.then(async () => {
      setStatus('saving');
      try {
        const result = await saveReviewDecision(path, { transactionIds, ...decision, replaces: previous.current });
        if (!result.ok) {
          toast.error(result.error);
          setStatus('error');
          return;
        }
        previous.current = { ruleId: result.ruleId ?? null };
        setStatus('saved');
        onSaved();
        router.refresh();
      } catch {
        toast.error('Não salvou. Recarregue a página e marque de novo.');
        setStatus('error');
      }
    });
  };
  const flush = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const decision = waiting.current;
    waiting.current = null;
    if (decision !== null) write(decision);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  // Sair da página com uma escolha esperando a gravação não pode perdê-la.
  useEffect(() => () => flushRef.current(), []);

  return {
    status,
    schedule: (decision: Decision) => {
      if (timer.current !== null) clearTimeout(timer.current);
      waiting.current = decision;
      setStatus('waiting');
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    saveNow: (decision: Decision) => {
      waiting.current = decision;
      flush();
    },
  };
}

const BUTTON: Record<SaveStatus, { label: string; className: string }> = {
  idle: { label: 'Confirmar', className: 'bg-ink text-white disabled:bg-track disabled:text-ink-3' },
  waiting: { label: 'Salvando', className: 'bg-ink text-white' },
  saving: { label: 'Salvando', className: 'bg-ink text-white' },
  saved: { label: 'Salvo', className: 'bg-good text-white' },
  error: { label: 'Tentar de novo', className: 'bg-warn text-white' },
};

function ReviewRow({
  item,
  path,
  options,
  state,
  hidden,
  onChange,
  onSaved,
}: {
  item: ReviewItem;
  path: string;
  options: CategoryOption[];
  state: RowState;
  hidden: boolean;
  onChange: (patch: Partial<RowState>) => void;
  onSaved: () => void;
}) {
  const { categoryId, owner, onlyThese } = state;
  // O PJ manda pró-labore e lucros pelo mesmo Pix: uma regra levaria todas as entradas para a mesma categoria.
  const ruleAllowed = item.reason !== 'pj_income';
  const decisionOf = (s: RowState): Decision | null =>
    s.categoryId === null ? null : { categoryId: s.categoryId, owner: s.owner, scope: s.onlyThese || !ruleAllowed ? 'only_these' : 'rule' };
  const { status, schedule, saveNow } = useAutosave(item.transactionIds, path, onSaved);
  const change = (patch: Partial<RowState>) => {
    onChange(patch);
    const decision = decisionOf({ ...state, ...patch });
    if (decision !== null) schedule(decision);
  };
  const button = BUTTON[status];
  const busy = status === 'waiting' || status === 'saving';
  const sign = item.direction === 'in' ? '+' : '';
  return (
    <li className={`flex-col gap-2.5 border-t border-line py-3.5 first:border-t-0 2xl:flex-row 2xl:items-center 2xl:gap-4 ${hidden ? 'hidden' : 'flex'}`}>
      <div className="flex min-w-0 items-start justify-between gap-3 2xl:flex-1">
        <div className="flex min-w-0 flex-col">
          <ExpandableText text={item.samples[0] ?? item.merchantKey} others={item.samples.slice(1)} className="text-[15px] font-medium" />
          <span className="text-xs text-ink-3">
            {[
              REVIEW_REASON_LABEL[item.reason],
              item.count > 1 ? `${item.count} transações` : formatDay(item.lastDate),
              item.lateFromMonth === null ? null : `chegou depois do fechamento de ${monthName(item.lateFromMonth).split(' ')[0]}`,
            ]
              .filter((x) => x !== null)
              .join(' · ')}
            {item.count === 1 && (
              <>
                {' · '}
                <Link href={`/lancamento/${encodeURIComponent(item.transactionIds[0] as string)}`} className="font-semibold text-ink-2 hover:text-ink">
                  detalhes
                </Link>
              </>
            )}
          </span>
          {item.refundOf !== null && <RefundOf credit={item.transactionIds[0] as string} purchase={item.refundOf} path={path} onSaved={onSaved} />}
        </div>
        <span className="num shrink-0 text-[15px] 2xl:hidden">
          {sign}
          {formatBRL(item.totalCents)}
        </span>
      </div>
      <span className="num hidden w-[110px] shrink-0 text-right text-[15px] 2xl:block">
        {sign}
        {formatBRL(item.totalCents)}
      </span>
      <div className="flex items-center gap-1.5 2xl:w-[220px]">
        {item.suggestedCategoryId !== null && categoryId === item.suggestedCategoryId && <Sparkles className="size-3.5 shrink-0 text-attn" aria-label="sugestão" />}
        <CategorySelect options={options} value={categoryId} onChange={(id) => change({ categoryId: id })} invalid />
      </div>
      <div className="flex items-center justify-between gap-2">
        <OwnerPicker value={owner} onChange={(o) => change({ owner: o })} />
        <label className={`flex items-center gap-1.5 text-xs text-ink-2 2xl:hidden ${ruleAllowed ? '' : 'invisible'}`}>
          <input type="checkbox" checked={onlyThese} onChange={(e) => change({ onlyThese: e.target.checked })} className="size-4 accent-ink" /> só esta
        </label>
        <button
          type="button"
          aria-label={button.label}
          title={button.label}
          disabled={categoryId === null || busy || status === 'saved'}
          onClick={() => {
            const decision = decisionOf(state);
            if (decision !== null) saveNow(decision);
          }}
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${button.className}`}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : status === 'error' ? <RotateCw className="size-4" /> : <Check className="size-4" />}
        </button>
      </div>
      <label className={`hidden items-center gap-1.5 text-xs text-ink-2 2xl:flex ${ruleAllowed ? '' : '2xl:invisible'}`} title="Sem criar regra para o estabelecimento">
        <input type="checkbox" checked={onlyThese} onChange={(e) => change({ onlyThese: e.target.checked })} className="size-4 accent-ink" /> só esta
      </label>
    </li>
  );
}

/** Compra de que o crédito parece ser estorno, com o atalho para abater. */
function RefundOf({ credit, purchase, path, onSaved }: { credit: string; purchase: NonNullable<ReviewItem['refundOf']>; path: string; onSaved: () => void }) {
  const link = useEntryAction(() => linkOffset(path, credit, purchase.id), onSaved);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
      <span className="min-w-0">
        de <span className="font-medium text-ink">{purchase.description}</span> · {formatDay(purchase.date)} · {formatBRL(-purchase.amountCents)}
        {purchase.installment === null ? '' : ` (parcela ${purchase.installment})`}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(undefined)}>
        É estorno
      </Button>
    </div>
  );
}
