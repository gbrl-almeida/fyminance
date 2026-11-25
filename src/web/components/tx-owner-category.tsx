'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { reclassifyTransactions } from '../../app/(app)/categoria/actions';
import type { Owner } from '../../core/types';
import { CategorySelect, type CategoryOption } from './category-select';
import { OwnerPicker } from './owner-picker';

/** Troca categoria e dono de transações, criando regra para o estabelecimento ou só para estas. */
export function TxOwnerCategory({
  transactionIds,
  categoryId,
  owner,
  options,
  path,
  label = 'Alterar',
}: {
  transactionIds: string[];
  categoryId: number | null;
  owner: Owner;
  options: CategoryOption[];
  path: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<number | null>(categoryId);
  const [who, setWho] = useState(owner);
  const [onlyThese, setOnlyThese] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      reclassifyTransactions(
        { target: { transactionIds }, categoryId: category ?? undefined, owner: who, scope: onlyThese ? 'only_these' : 'rule' },
        path,
      ),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.error);
      toast.success(onlyThese ? 'Alterado.' : 'Alterado, com regra para o estabelecimento.');
      setOpen(false);
      router.refresh();
    },
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[13px] font-semibold text-ink-2 hover:text-ink">
        {label}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-canvas p-3">
      <CategorySelect options={options} value={category} onChange={setCategory} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OwnerPicker value={who} onChange={setWho} />
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={onlyThese} onChange={(e) => setOnlyThese(e.target.checked)} className="size-4 accent-ink" />
          Só esta{transactionIds.length > 1 ? 's' : ''} (sem regra)
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="button" size="sm" disabled={category === null || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
