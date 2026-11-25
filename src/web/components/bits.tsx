import { CircleAlert, CircleCheck, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBRL } from '../format';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[14px] border border-line bg-surface p-5 lg:p-6 ${className}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold tracking-[0.05em] text-ink-2 uppercase">{children}</p>;
}

export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={`num ${className}`}>{formatBRL(cents)}</span>;
}

export type Tone = 'good' | 'warn' | 'attn' | 'neutral';

const PILL: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  attn: 'bg-attn-soft text-attn',
  neutral: 'bg-track text-ink-2',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${PILL[tone]}`}>{children}</span>;
}

export type StepState = 'done' | 'pending' | 'attention';

export function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CircleCheck className="mt-0.5 size-[18px] shrink-0 text-good" aria-label="feito" />;
  if (state === 'attention') return <CircleAlert className="mt-0.5 size-[18px] shrink-0 text-warn" aria-label="pendente" />;
  return <Circle className="mt-0.5 size-[18px] shrink-0 text-ink-3" aria-label="a fazer" />;
}

/** Barra horizontal com o valor do mês e a marca da média (e da meta, se houver). */
export function MeterBar({ cents, averageCents, goalCents, max, over }: { cents: number; averageCents: number; goalCents?: number | null; max: number; over: boolean }) {
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-track" aria-hidden>
      <div className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-warn' : 'bg-ink'}`} style={{ width: pct(cents) }} />
      {averageCents > 0 && <div className="absolute -top-[3px] h-3 w-0.5 bg-ink" style={{ left: pct(averageCents) }} title="média" />}
      {goalCents !== null && goalCents !== undefined && <div className="absolute -top-[3px] h-3 w-0.5 bg-good" style={{ left: pct(goalCents) }} title="meta" />}
    </div>
  );
}
