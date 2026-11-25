import { ChevronLeft, ChevronRight, FileText, LogOut, Upload } from 'lucide-react';
import Link from 'next/link';
import { logoutAction } from '../../app/login/actions';
import { addMonths, capitalize, filterQuery, formatMonthShort, monthName, OWNER_LABEL, type OwnerFilter } from '../format';

const OWNERS: Array<[OwnerFilter, string]> = [
  ['all', OWNER_LABEL.casal],
  ['pessoa1', OWNER_LABEL.pessoa1],
  ['pessoa2', OWNER_LABEL.pessoa2],
];

interface TopBarProps {
  /** Caminho da página, para os links de mês e de pessoa. */
  path: string;
  month?: string;
  owner?: OwnerFilter;
}

/** Barra do topo: marca, troca de mês e filtro por pessoa. */
export function TopBar({ path, month, owner = 'all' }: TopBarProps) {
  return (
    <header className="border-b border-line bg-canvas">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-12 lg:py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-[17px] font-bold tracking-tight lg:text-lg">
            fyminance
          </Link>
          {month !== undefined && (
            <nav aria-label="Mês" className="flex items-center gap-2 lg:hidden">
              <MonthLinks path={path} month={month} owner={owner} short />
            </nav>
          )}
        </div>
        {month !== undefined && (
          <nav aria-label="Mês" className="hidden items-center gap-3 lg:flex">
            <MonthLinks path={path} month={month} owner={owner} />
          </nav>
        )}
        <div className="flex items-center gap-2">
          {month !== undefined && (
            <div role="group" aria-label="De quem" className="flex flex-1 gap-0.5 rounded-[10px] bg-track p-[3px] lg:flex-none">
              {OWNERS.map(([value, label]) => (
                <Link
                  key={value}
                  href={`${path}${filterQuery(month, value)}`}
                  aria-current={value === owner ? 'true' : undefined}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-center text-sm lg:flex-none ${value === owner ? 'bg-surface font-semibold text-ink' : 'font-medium text-ink-2'}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
          <Link href="/relatorios" aria-label="Relatórios" className="rounded-lg p-2 text-ink-2 hover:bg-track">
            <FileText className="size-[18px]" />
          </Link>
          <Link href="/importar" aria-label="Importar fatura" className="rounded-lg p-2 text-ink-2 hover:bg-track">
            <Upload className="size-[18px]" />
          </Link>
          <form action={logoutAction}>
            <button type="submit" aria-label="Sair" className="rounded-lg p-2 text-ink-2 hover:bg-track">
              <LogOut className="size-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function MonthLinks({ path, month, owner, short = false }: { path: string; month: string; owner: OwnerFilter; short?: boolean }) {
  return (
    <>
      <Link href={`${path}${filterQuery(addMonths(month, -1), owner)}`} aria-label="Mês anterior" className="rounded-md p-1 text-ink-2 hover:bg-track">
        <ChevronLeft className="size-[18px]" />
      </Link>
      <span className="min-w-20 text-center text-[15px] font-semibold">{short ? capitalize(formatMonthShort(month)) : capitalize(monthName(month))}</span>
      <Link href={`${path}${filterQuery(addMonths(month, 1), owner)}`} aria-label="Próximo mês" className="rounded-md p-1 text-ink-2 hover:bg-track">
        <ChevronRight className="size-[18px]" />
      </Link>
    </>
  );
}
