'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

/** Volta para a página de onde veio (painel, categoria, conciliação ou busca). */
export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
      className="flex items-center gap-1.5 self-start text-sm text-ink-2 hover:text-ink"
    >
      <ArrowLeft className="size-4" /> Voltar
    </button>
  );
}
