import { monthName } from '../../format';

export function StepHeader({ month, step, title, sub }: { month: string; step: number; title: string; sub: string }) {
  return (
    <header className="flex flex-col gap-1.5">
      <p className="text-[13px] font-semibold tracking-[0.05em] text-ink-2 uppercase">
        Fechamento de {monthName(month).split(' ')[0]} · passo {step} de 4
      </p>
      <h1 className="text-[28px] font-bold lg:text-[32px]">{title}</h1>
      <p className="text-[15px] text-ink-2">{sub}</p>
    </header>
  );
}
