import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

/** Campo de busca por palavras da descrição ou por um valor ("512" ou "512,40"). */
export function SearchField({ className = '', ...props }: ComponentProps<'input'>) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
      <Input type="search" aria-label="Buscar" placeholder="Buscar por descrição ou valor" autoComplete="off" className="h-9 bg-surface pl-8" {...props} />
    </div>
  );
}
