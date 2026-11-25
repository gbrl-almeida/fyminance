import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { lastDayOfMonth } from '../../../../../core/dates';
import { listCategories } from '../../../../../curation/categories';
import { getBalances } from '../../../../../queries/balances';
import { getClosingStatus, getOutsidePluggy } from '../../../../../queries/closing';
import { getMonthSummary } from '../../../../../queries/month-summary';
import { getPendingItems } from '../../../../../queries/pending';
import { Card, Eyebrow, Money, StepIcon } from '../../../../../web/components/bits';
import type { DivergenceItem } from '../../../../../web/components/closing/divergences';
import { Divergences } from '../../../../../web/components/closing/divergences';
import { OutsidePluggy } from '../../../../../web/components/closing/outside-pluggy';
import { ReviewList } from '../../../../../web/components/closing/review-list';
import { StepHeader } from '../../../../../web/components/closing/step-header';
import { formatBRL, monthName, OWNER_LABEL } from '../../../../../web/format';
import { getAppContext } from '../../../../../web/server/context';

export default async function ReconciliationStep({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  const app = getAppContext();
  const today = app.today();
  const path = `/fechamento/${mes}/conciliacao`;
  const status = getClosingStatus(app.db, mes, today, app.dataDir);
  const pending = getPendingItems(app.db, { today, month: mes });
  const outside = getOutsidePluggy(app.db, mes);
  const summary = getMonthSummary(app.db, mes, today);
  const categories = listCategories(app.db);
  const expenseOptions = categories.filter((c) => c.kind === 'expense').map((c) => ({ id: c.id, path: c.path }));
  const incomeOptions = categories.filter((c) => c.kind === 'income').map((c) => ({ id: c.id, path: `Renda · ${c.path}` }));
  const defaultDate = today.startsWith(mes) ? today : lastDayOfMonth(mes);
  const divergences: DivergenceItem[] = [
    ...pending.billDivergences.map((d) => ({
      key: d.key,
      kind: 'bill' as const,
      account: d.account,
      accountId: d.accountId,
      date: d.dueDate,
      bankCents: d.totalCents,
      importedCents: d.computedCents,
      diffCents: d.diffCents,
      explanation: d.explanation,
    })),
    ...pending.balanceDivergences.map((d) => ({
      key: d.key,
      kind: 'balance' as const,
      account: d.account,
      accountId: d.accountId,
      date: d.sinceDate,
      bankCents: null,
      importedCents: null,
      diffCents: d.diffCents,
      explanation: d.explanation,
    })),
  ];
  const r = status.reconciliation;
  const reviewItems = pending.review.map((g) => ({
    key: g.key,
    merchantKey: g.merchantKey,
    reason: g.reason,
    count: g.count,
    totalCents: g.totalCents,
    direction: g.direction,
    samples: g.samples,
    transactionIds: g.transactionIds,
    lastDate: g.lastDate,
    suggestedCategoryId: g.suggestedCategoryId,
    lateFromMonth: g.lateFromMonth,
    refundOf: g.refundOf,
  }));
  const outsideDone = r.flashConfirmed && r.cashConfirmed;
  const balances = getBalances(app.db, today).accounts;
  const total = Object.values(summary.expenseByOwner).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <StepHeader month={mes} step={2} title="Conciliação" sub={`Tudo o que entrou e saiu em ${monthName(mes).split(' ')[0]} precisa estar aqui, com categoria e dono.`} />
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex flex-wrap items-center gap-2.5 text-lg font-bold">
              Transações para revisar
              {r.reviewGroups > 0 && (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                  {r.reviewGroups} · {formatBRL(r.reviewCents)}
                </span>
              )}
            </h2>
            <p className="text-sm text-ink-2">
              Cada linha é salva assim que você troca a categoria ou o dono; para aceitar a sugestão como está, confirme a linha. Só marque o dono quando não for do casal.
              Sem “só esta”, a escolha vira regra para o estabelecimento.
            </p>
          </div>
          <ReviewList items={reviewItems} path={path} expenseOptions={expenseOptions} incomeOptions={incomeOptions} />
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Faturas e saldos</h2>
          <Divergences items={divergences} path={path} defaultDate={defaultDate} expenseOptions={expenseOptions} incomeOptions={incomeOptions} />
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold">Fora da Pluggy</h2>
            <p className="text-sm text-ink-2">Gastos e rendas que não passam pelos bancos conectados.</p>
          </div>
          <OutsidePluggy view={outside} month={mes} path={path} defaultDate={defaultDate} expenseOptions={expenseOptions} incomeOptions={incomeOptions} />
        </Card>
        <details className="group rounded-[14px] border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">Conferir saldos com o app do banco</span>
              <span className="text-[13px] text-ink-2">Opcional. Só quando algo não bater ou a Pluggy ficar sem atualizar.</span>
            </span>
            <ChevronDown className="size-5 shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="flex flex-col divide-y divide-line px-5 pb-4">
            {balances.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>{a.name}</span>
                <span className="num">{a.balanceCents === null ? '—' : formatBRL(a.balanceCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      </main>
      <aside className="flex w-full flex-col gap-6 lg:w-[400px] lg:shrink-0">
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-bold">Conciliação de {monthName(mes).split(' ')[0]}</h2>
            <p className="text-sm text-ink-2">{[r.reviewGroups === 0, r.openDivergences === 0, outsideDone].filter(Boolean).length} de 3 resolvidos</p>
          </div>
          {(
            [
              ['Revisar transações', r.reviewGroups === 0 ? 'nada pendente' : `${r.reviewGroups} restantes`, r.reviewGroups === 0],
              ['Faturas e saldos', r.openDivergences === 0 ? 'tudo bate' : `${r.openDivergences} sem explicação`, r.openDivergences === 0],
              ['Fora da Pluggy', outsideDone ? 'conferido' : 'falta conferir', outsideDone],
            ] as const
          ).map(([label, sub, ok]) => (
            <div key={label} className="flex items-start gap-3">
              <StepIcon state={ok ? 'done' : 'attention'} />
              <div className="flex flex-col">
                <span className="text-[15px] font-medium">{label}</span>
                <span className="text-[13px] text-ink-3">{sub}</span>
              </div>
            </div>
          ))}
          {r.complete ? (
            <Link href={`/fechamento/${mes}/metas`} className="flex items-center justify-center gap-2 rounded-[10px] bg-ink px-4 py-3 text-[15px] font-semibold text-white">
              Concluir conciliação <ArrowRight className="size-4" />
            </Link>
          ) : (
            <span aria-disabled className="flex items-center justify-center rounded-[10px] bg-track px-4 py-3 text-[15px] font-semibold text-ink-3">
              Concluir conciliação
            </span>
          )}
        </Card>
        <section className="flex flex-col gap-3.5">
          <Eyebrow>Gastos de {monthName(mes).split(' ')[0]} por pessoa</Eyebrow>
          {(Object.entries(summary.expenseByOwner) as Array<[keyof typeof OWNER_LABEL, number]>).map(([owner, cents]) => (
            <div key={owner} className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-[15px] font-medium">{OWNER_LABEL[owner]}</span>
                <Money cents={cents} className="text-[15px]" />
              </div>
              <div className="h-1.5 rounded-full bg-track">
                <div className="h-1.5 rounded-full bg-ink" style={{ width: `${(cents / total) * 100}%` }} />
              </div>
            </div>
          ))}
          <p className="text-[13px] leading-snug text-ink-2">Sem cartão individual, o dono vem da marcação de vocês.</p>
        </section>
      </aside>
    </div>
  );
}
