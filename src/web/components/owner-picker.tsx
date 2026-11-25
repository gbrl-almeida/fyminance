'use client';

import type { Owner } from '../../core/types';
import { OWNER_LABEL } from '../../owner-labels';

const OPTIONS = Object.entries(OWNER_LABEL) as Array<[Owner, string]>;

/** Seletor segmentado Casal / pessoa 1 / pessoa 2. */
export function OwnerPicker({ value, onChange, label = 'De quem' }: { value: Owner; onChange: (owner: Owner) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-track p-0.5">
      {OPTIONS.map(([owner, text]) => (
        <button
          key={owner}
          type="button"
          role="radio"
          aria-checked={owner === value}
          onClick={() => onChange(owner)}
          className={`rounded-md px-2.5 py-1.5 text-[13px] ${owner === value ? 'bg-surface font-semibold text-ink' : 'font-medium text-ink-2'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
