'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ActionResult } from '../../../app/(app)/fechamento/actions';

/** Roda uma server action do fechamento, mostra o resultado e atualiza a página. */
export function useClosingAction<T>(action: (input: T) => Promise<ActionResult>, onDone?: () => void) {
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
    onError: () => toast.error('Não deu certo. Tente de novo.'),
  });
}
