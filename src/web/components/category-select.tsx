'use client';

export interface CategoryOption {
  id: number;
  path: string;
}

/** Select nativo: no celular abre o seletor do sistema. */
export function CategorySelect({
  options,
  value,
  onChange,
  placeholder = 'Escolher…',
  invalid = false,
}: {
  options: CategoryOption[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <select
      aria-label="Categoria"
      value={value ?? ''}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`h-9 w-full min-w-0 rounded-lg border bg-surface px-2.5 text-sm ${invalid && value === null ? 'border-warn text-warn' : 'border-line text-ink'}`}
    >
      {value === null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.path}
        </option>
      ))}
    </select>
  );
}
