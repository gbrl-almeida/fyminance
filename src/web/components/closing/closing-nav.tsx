'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { StepState } from '../bits';
import { CLOSING_STEPS } from './steps';

const DOT: Record<StepState, string> = { done: 'bg-good', attention: 'bg-warn', pending: 'bg-track' };

/** Passos do fechamento, navegáveis em qualquer ordem. */
export function ClosingNav({ month, states }: { month: string; states: Record<(typeof CLOSING_STEPS)[number]['key'], StepState> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Passos do fechamento" className="flex gap-1.5 overflow-x-auto pb-1">
      {CLOSING_STEPS.map((step, i) => {
        const href = `/fechamento/${month}/${step.slug}`;
        const current = pathname === href;
        return (
          <Link
            key={step.slug}
            href={href}
            aria-current={current ? 'step' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] ${current ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2'}`}
          >
            <span className={`size-2 rounded-full ${DOT[states[step.key]]}`} />
            {i + 1}. {step.label}
          </Link>
        );
      })}
    </nav>
  );
}
