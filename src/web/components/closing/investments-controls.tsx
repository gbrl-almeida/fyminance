'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { finishMonth, setInvestmentFlag } from '../../../app/(app)/fechamento/actions';
import { useClosingAction } from './use-action';

export function InvestmentFlag({ accountId, counts, path }: { accountId: string; counts: boolean; path: string }) {
  const toggle = useClosingAction((next: boolean) => setInvestmentFlag(path, accountId, next));
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-2">
      <input type="checkbox" checked={counts} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} className="size-4 accent-ink" />
      conta como investimento
    </label>
  );
}

/** Meta de aporte do mês seguinte e o botão de fechar: o que estiver digitado é gravado ao fechar. */
export function ClosingFinish({
  month,
  label,
  goalLabel,
  initialGoal,
  disabledReason,
  path,
}: {
  month: string;
  label: string;
  goalLabel: string;
  initialGoal: string;
  disabledReason: string | null;
  path: string;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState(initialGoal);
  const finish = useClosingAction((value: string) => finishMonth(path, month, value), () => router.push(`/relatorios/${month}`));
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        {goalLabel}
        <Input inputMode="decimal" placeholder="0,00" value={goal} onChange={(e) => setGoal(e.target.value)} disabled={disabledReason !== null} className="num h-10 bg-surface" />
      </label>
      <Button type="button" className="h-12 text-[15px]" disabled={disabledReason !== null || finish.isPending} onClick={() => finish.mutate(goal)}>
        {finish.isPending ? 'Fechando…' : label} <Check className="size-4" />
      </Button>
      <p className="text-center text-[13px] text-ink-2">
        {disabledReason ?? 'Gera o relatório do mês e guarda as metas do mês seguinte (as sugestões, se vocês não salvaram outras).'}
      </p>
    </div>
  );
}
