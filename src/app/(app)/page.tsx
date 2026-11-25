import { Info } from 'lucide-react';
import { getDashboard } from '../../queries/dashboard';
import { Pill } from '../../web/components/bits';
import { Categories } from '../../web/components/dashboard/categories';
import { Hero } from '../../web/components/dashboard/hero';
import { ClosingCard, Installments, OpenBills } from '../../web/components/dashboard/side';
import { TopBar } from '../../web/components/top-bar';
import { formatBRL, readFilters } from '../../web/format';
import { getAppContext } from '../../web/server/context';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const app = getAppContext();
  const today = app.today();
  const { month, owner } = readFilters(await searchParams, today);
  const view = getDashboard(app.db, month, owner, today, app.dataDir);
  const drift = view.drift;
  return (
    <>
      <TopBar path="/" month={month} owner={owner} />
      <main className="mx-auto flex max-w-[1440px] flex-col gap-8 px-4 py-6 lg:flex-row lg:items-start lg:gap-12 lg:px-12 lg:py-10">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {drift !== null && (
            <Pill tone="attn">
              <Info className="size-3.5" />
              Mudou desde o fechamento:{' '}
              {[
                drift.expenseCents === 0 ? null : `${formatBRL(Math.abs(drift.expenseCents))} ${drift.expenseCents > 0 ? 'a mais' : 'a menos'} em gastos`,
                drift.incomeCents === 0 ? null : `${formatBRL(Math.abs(drift.incomeCents))} ${drift.incomeCents > 0 ? 'a mais' : 'a menos'} em renda`,
              ]
                .filter((x) => x !== null)
                .join(', ')}
            </Pill>
          )}
          <Hero view={view} />
          {view.closing !== null && (
            <div className="lg:hidden">
              <ClosingCard closing={view.closing} />
            </div>
          )}
          <Categories categories={view.categories} month={month} owner={owner} />
        </div>
        <aside className="flex w-full flex-col gap-8 lg:w-[400px] lg:shrink-0">
          {view.closing !== null && (
            <div className="hidden lg:block">
              <ClosingCard closing={view.closing} />
            </div>
          )}
          <Installments installments={view.installments} />
          <OpenBills bills={view.openBills} />
        </aside>
      </main>
    </>
  );
}
