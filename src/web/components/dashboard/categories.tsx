import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { DashboardCategory } from '../../../queries/dashboard';
import { formatBRL, filterQuery, monthAbbr, type OwnerFilter } from '../../format';
import { addMonths } from '../../../core/dates';
import { MeterBar } from '../bits';

const VISIBLE = 10;

function Delta({ cents, averageCents, hideNeutral = false }: { cents: number; averageCents: number; hideNeutral?: boolean }) {
  if (averageCents === 0) return hideNeutral ? null : <span className="text-ink-3">novo</span>;
  const diff = cents - averageCents;
  if (Math.abs(diff) < 1000) return hideNeutral ? null : <span className="text-ink-3">≈ média</span>;
  return <span className={diff > 0 ? 'text-warn' : 'text-good'}>{`${diff > 0 ? '+' : '−'}${formatBRL(Math.abs(diff))}`}</span>;
}

function Row({ category, max, href, expandable }: { category: DashboardCategory | DashboardCategory['children'][number]; max: number; href?: string; expandable?: boolean }) {
  const goal = 'goalCents' in category ? category.goalCents : null;
  const over = goal !== null ? category.cents > goal : category.averageCents > 0 && category.cents > category.averageCents * 1.1;
  const body = (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 lg:grid-cols-[200px_1fr_110px_100px]">
      <span className="flex items-center gap-1.5 text-[15px] font-medium">
        {expandable === true && <ChevronRight className="size-4 text-ink-2 transition-transform group-open:rotate-90" />}
        {category.name}
        <span className="num text-xs font-semibold lg:hidden">
          <Delta cents={category.cents} averageCents={category.averageCents} hideNeutral />
        </span>
      </span>
      <span className="num text-right text-[15px] lg:order-3">{formatBRL(category.cents)}</span>
      <div className="col-span-2 lg:order-2 lg:col-span-1">
        <MeterBar cents={category.cents} averageCents={category.averageCents} goalCents={goal} max={max} over={over} />
      </div>
      <span className="num hidden text-right text-[13px] lg:order-4 lg:block">
        <Delta cents={category.cents} averageCents={category.averageCents} />
      </span>
    </div>
  );
  return href === undefined ? body : <Link href={href} className="block rounded-lg hover:bg-canvas">{body}</Link>;
}

export function Categories({ categories, month, owner }: { categories: DashboardCategory[]; month: string; owner: OwnerFilter }) {
  const max = Math.max(1, ...categories.flatMap((c) => [c.cents, c.averageCents, c.goalCents ?? 0]));
  const href = (id: number | null) => (id === null ? undefined : `/categoria/${id}${filterQuery(month, owner)}`);
  const visible = categories.slice(0, VISIBLE);
  const rest = categories.slice(VISIBLE);
  const range = `${monthAbbr(addMonths(month, -3))}–${monthAbbr(addMonths(month, -1))}`;

  const render = (c: DashboardCategory) =>
    c.children.length === 0 ? (
      <li key={c.categoryId ?? 'none'} className="border-b border-line last:border-b-0">
        <Row category={c} max={max} href={href(c.categoryId)} />
      </li>
    ) : (
      <li key={c.categoryId ?? 'none'} className="border-b border-line last:border-b-0">
        <details className="group">
          <summary className="cursor-pointer list-none rounded-lg hover:bg-canvas [&::-webkit-details-marker]:hidden">
            <Row category={c} max={max} expandable />
          </summary>
          <ul className="mb-3 ml-5 border-l border-line pl-4">
            {c.children.map((child) => (
              <li key={child.categoryId}>
                <Row category={child} max={max} href={href(child.categoryId)} />
              </li>
            ))}
            <li>
              <Link href={href(c.categoryId) ?? '#'} className="inline-block py-2 text-sm font-semibold text-ink-2 hover:text-ink">
                Ver transações de {c.name}
              </Link>
            </li>
          </ul>
        </details>
      </li>
    );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 pb-2 lg:flex-row lg:items-end lg:justify-between">
        <h2 className="text-xl font-bold">Para onde foi o dinheiro</h2>
        <p className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-4 rounded-full bg-ink" /> no mês
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-ink" /> média {range}
          </span>
          {categories.some((c) => c.goalCents !== null) && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-0.5 bg-good" /> meta
            </span>
          )}
        </p>
      </div>
      {categories.length === 0 ? (
        <p className="py-6 text-[15px] text-ink-2">Nenhum gasto neste mês.</p>
      ) : (
        <ul>{visible.map(render)}</ul>
      )}
      {rest.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[15px] text-ink-2 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" /> Outras {rest.length} categorias
            </span>
            <span className="num">{formatBRL(rest.reduce((sum, c) => sum + c.cents, 0))}</span>
          </summary>
          <ul>{rest.map(render)}</ul>
        </details>
      )}
    </section>
  );
}
