import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardView } from '../../../queries/dashboard';
import { capitalize, formatBRL, formatPct, monthAbbr, monthName, OWNER_LABEL } from '../../format';
import { Money, Pill } from '../bits';
import { addMonths } from '../../../core/dates';

export function Hero({ view }: { view: DashboardView }) {
  const name = monthName(view.month).split(' ')[0] as string;
  const range = `${monthAbbr(addMonths(view.month, -3))}–${monthAbbr(addMonths(view.month, -1))}`;
  if (view.household === null) {
    return (
      <section className="flex flex-col gap-2">
        <p className="text-[15px] text-ink-2">Gastos de {OWNER_LABEL[view.owner === 'all' ? 'casal' : view.owner]} em {name}</p>
        <Money cents={view.expenseCents} className="text-[44px] leading-none font-medium lg:text-[56px]" />
        <p className="text-sm text-ink-2">Renda, sobra e metas são do casal: veja em "Casal".</p>
      </section>
    );
  }
  const h = view.household;
  const diff = h.averageSurplusCents === null ? null : h.surplusCents - h.averageSurplusCents;
  const spentShare = h.incomeCents > 0 ? Math.min(1, h.expenseCents / h.incomeCents) : 1;
  return (
    <section className="flex flex-col gap-4">
      <p className="text-[15px] text-ink-2">{h.surplusCents >= 0 ? `Sobrou em ${name}` : `Faltou em ${name}`}</p>
      <Money cents={h.surplusCents} className={`text-[44px] leading-none font-medium lg:text-[64px] ${h.surplusCents >= 0 ? 'text-good' : 'text-warn'}`} />
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {(
          [
            ['Renda', formatBRL(h.incomeCents)],
            ['Gastos', formatBRL(h.expenseCents)],
            ['Taxa de poupança', formatPct(h.savingsRate)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-[13px] text-ink-2">{label}</dt>
            <dd className="num text-[17px] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {diff !== null && diff !== 0 && (
        <div>
          <Pill tone={diff > 0 ? 'good' : 'warn'}>
            {diff > 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {formatBRL(Math.abs(diff))} {diff > 0 ? 'acima' : 'abaixo'} da sobra média de {range}
          </Pill>
        </div>
      )}
      {h.incomeCents > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-good-soft" aria-hidden>
            <div className="bg-ink" style={{ width: `${spentShare * 100}%` }} />
          </div>
          <p className="flex justify-between text-[13px] text-ink-2">
            <span>{formatPct(spentShare)} da renda em gastos</span>
            <span>{capitalize(formatPct(h.savingsRate))} sobrou</span>
          </p>
        </div>
      )}
    </section>
  );
}
