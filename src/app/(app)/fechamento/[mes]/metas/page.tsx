import { listCategories } from '../../../../../curation/categories';
import { getGoalsBoard } from '../../../../../queries/goals';
import { Eyebrow, Money } from '../../../../../web/components/bits';
import { GoalsBoard } from '../../../../../web/components/closing/goals-board';
import { PlanNotes } from '../../../../../web/components/closing/plan-notes';
import { StepHeader } from '../../../../../web/components/closing/step-header';
import { monthName } from '../../../../../web/format';
import { getAppContext } from '../../../../../web/server/context';

export default async function GoalsStep({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  const app = getAppContext();
  const board = getGoalsBoard(app.db, mes, app.today());
  const target = monthName(board.targetMonth).split(' ')[0];
  const options = listCategories(app.db)
    .filter((c) => c.kind === 'expense' && c.parentId === null)
    .map((c) => ({ id: c.id, path: c.path }));
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <StepHeader month={mes} step={3} title={`Metas de ${target}`} sub="A sugestão é a média dos últimos 3 meses mais o que vocês anotaram. Ajustem onde dá para gastar menos." />
        <GoalsBoard board={board} path={`/fechamento/${mes}/metas`} />
      </main>
      <aside className="flex w-full flex-col gap-8 lg:w-[400px] lg:shrink-0">
        <PlanNotes notes={board.notes} targetMonth={board.targetMonth} path={`/fechamento/${mes}/metas`} options={options} />
        <section className="flex flex-col gap-3.5">
          <Eyebrow>Já comprometido</Eyebrow>
          <p className="flex flex-wrap items-end gap-x-2 gap-y-1">
            <Money cents={board.committed.totalCents} className="text-[26px] leading-none font-medium whitespace-nowrap" />
            <span className="text-sm text-ink-2">antes de {target} começar</span>
          </p>
          {(
            [
              ['Moradia e contas fixas', board.committed.fixedCents],
              ['Parcelas de compras', board.committed.installmentsCents],
              ['Assinaturas', board.committed.subscriptionsCents],
            ] as const
          ).map(([label, cents]) => (
            <div key={label} className="flex justify-between text-[15px]">
              <span className="text-ink-2">{label}</span>
              <Money cents={cents} />
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
