'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { EntryResult } from '../../../app/(app)/lancamento/actions';

/** Roda uma ação do lançamento, mostra o resultado e atualiza a página. */
export function useEntryAction<T>(action: (input: T) => Promise<EntryResult>, onDone?: () => void) {
  const router = useRouter();
  return useMutation({
    mutationFn: action,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.message !== undefined) toast.success(result.message);
      onDone?.();
      router.refresh();
    },
    onError: () => toast.error('Não deu certo. Recarregue a página e tente de novo.'),
  });
}
