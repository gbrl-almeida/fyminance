import { CircleAlert } from 'lucide-react';
import { addMonths } from '../../../../../core/dates';
import { getClosingStatus } from '../../../../../queries/closing';
import { getInvestments } from '../../../../../queries/investments';
import { Card, Money } from '../../../../../web/components/bits';
import { ClosingFinish, InvestmentFlag } from '../../../../../web/components/closing/investments-controls';
import { RedemptionYieldsCard } from '../../../../../web/components/closing/redemption-yields';
import { StepHeader } from '../../../../../web/components/closing/step-header';
import { formatBRL, formatDay, formatPct, monthName } from '../../../../../web/format';
import { getAppContext } from '../../../../../web/server/context';

const asInput = (cents: number | null) => (cents === null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default async function InvestmentsStep({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  const app = getAppContext();
  const today = app.today();
  const path = `/fechamento/${mes}/investimentos`;
  const view = getInvestments(app.db, mes, today);
  const target = addMonths(mes, 1);
  const nextGoal = getInvestments(app.db, target, today).goalCents;
  const status = getClosingStatus(app.db, mes, today, app.dataDir);
  const name = monthName(mes).split(' ')[0] as string;
  const missing = view.goalCents === null ? 0 : Math.max(0, view.goalCents - view.contributedCents);
  const disabledReason =
    status.closed !== null ? 'Este mês já foi fechado.' : status.reconciliation.complete ? null : `Termine a conciliação de ${name} para fechar o mês.`;
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <StepHeader month={mes} step={4} title="Investimentos" sub="Quanto vocês têm, quanto rendeu e quanto aplicaram." />
        <Card className="flex flex-col gap-5 lg:p-7">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-2">Total investido</span>
              <Money cents={view.totalCents} className="text-[32px] leading-none font-medium lg:text-[36px]" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-2">Rendeu em {name}</span>
              {view.yieldCents === null ? (
                <span className="text-[15px] text-ink-3">indisponível</span>
              ) : (
                <span className="flex items-end gap-2">
                  <Money cents={view.yieldCents} className="text-[32px] leading-none font-medium text-good lg:text-[36px]" />
                  <span className="num text-[15px] text-good">{formatPct(view.yieldPct, 2)}</span>
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-2">Aportado em {name}</span>
              <Money cents={view.contributedCents} className="text-[32px] leading-none font-medium lg:text-[36px]" />
            </div>
          </div>
          {view.goalCents !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Meta de aporte do mês</span>
                <span className="num text-ink-2">
                  {formatBRL(view.contributedCents)} de {formatBRL(view.goalCents)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-track">
                <div className={`h-1.5 rounded-full ${missing > 0 ? 'bg-attn' : 'bg-good'}`} style={{ width: `${Math.min(100, (view.contributedCents / Math.max(1, view.goalCents)) * 100)}%` }} />
              </div>
              {missing > 0 && (
                <p className="text-[13px] text-attn">
                  Faltaram {formatBRL(missing)}.{view.surplusCents > missing ? ` Sobraram ${formatBRL(view.surplusCents)} em ${name}: dá para completar agora.` : ''}
                </p>
              )}
            </div>
          )}
        </Card>
        <RedemptionYieldsCard view={view.redemptions} monthLabel={name} year={mes.slice(0, 4)} />
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Contas de investimento</h2>
          {view.accounts.length === 0 && <p className="text-[15px] text-ink-2">Nenhuma conta de investimento conectada.</p>}
          <ul className="flex flex-col divide-y divide-line">
            {view.accounts.map((a) => (
              <li key={a.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <span className="text-[15px] font-medium">{a.name}</span>
                  <InvestmentFlag accountId={a.id} counts={a.counts} path={path} />
                </div>
                <span className="num text-[15px]">{a.balanceCents === null ? '—' : formatBRL(a.balanceCents)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-ink-2">O CDB do C6 é caixa até o pagamento da fatura; por isso não conta, a menos que vocês marquem.</p>
        </Card>
      </main>
      <aside className="flex w-full flex-col gap-6 lg:w-[400px] lg:shrink-0">
        <Card className="flex flex-col gap-3.5">
          <h2 className="text-lg font-bold">Aportes de {name}</h2>
          {view.contributions.length === 0 && <p className="text-sm text-ink-2">Nenhum aporte no mês.</p>}
          {[...view.contributions.map((c) => ({ ...c, out: true })), ...view.withdrawals.map((w) => ({ ...w, out: false }))].map((c, i) => (
            <div key={`${c.date}-${i}`} className="flex items-start justify-between gap-3 border-t border-line pt-3 first-of-type:border-t-0">
              <div className="flex flex-col">
                <span className="text-[15px]">{c.out ? 'Aplicação' : 'Resgate'}</span>
                <span className="text-[13px] text-ink-3">
                  {formatDay(c.date)} · {c.account}
                </span>
              </div>
              <span className={`num text-[15px] ${c.out ? '' : 'text-warn'}`}>
                {c.out ? '' : '−'}
                {formatBRL(c.cents)}
              </span>
            </div>
          ))}
          <p className="flex items-start gap-2 rounded-[10px] bg-attn-soft p-3 text-[13px] leading-snug text-attn">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> Objetivos e conciliação com a corretora entram quando vocês escolherem onde investir.
          </p>
        </Card>
        <ClosingFinish
          month={mes}
          label={`Fechar ${name}`}
          goalLabel={`Meta de aporte de ${monthName(target).split(' ')[0]}`}
          initialGoal={asInput(nextGoal)}
          disabledReason={disabledReason}
          path={path}
        />
      </aside>
    </div>
  );
}
