'use client';

import { useState } from 'react';

/** Texto de uma linha, cortado com reticências: o cursor em cima mostra tudo, e o clique (ou toque) abre o texto inteiro e as outras linhas. */
export function ExpandableText({ text, others = [], className = '' }: { text: string; others?: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      title={[text, ...others].join('\n')}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={`block max-w-full text-left ${open ? 'wrap-anywhere' : 'truncate'} ${className}`}
    >
      {open
        ? [text, ...others].map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))
        : text}
    </button>
  );
}
