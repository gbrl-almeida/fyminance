import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { DashboardView } from '../../../queries/dashboard';
import { capitalize, formatBRL, formatDay, formatPct, monthAbbr, monthName } from '../../format';
import { Card, Eyebrow, Money, StepIcon } from '../bits';

export function ClosingCard({ closing }: { closing: NonNullable<DashboardView['closing']> }) {
  const name = monthName(closing.month).split(' ')[0] as string;
  const r = closing.reconciliation;
  const reconciliationSub =
    closing.steps.reconciliation === 'done'
      ? 'conciliado'
      : [
          r.reviewGroups > 0 ? `${r.reviewGroups} para revisar (${formatBRL(r.reviewCents)})` : null,
          r.openDivergences > 0 ? `${r.openDivergences} ${r.openDivergences === 1 ? 'diferença' : 'diferenças'}` : null,
          !r.flashConfirmed || !r.cashConfirmed ? 'fora da Pluggy' : null,
        ]
          .filter((x) => x !== null)
          .join(' · ');
  const steps = [
    { label: 'Dados atualizados', sub: closing.steps.data === 'done' ? 'conexões em dia' : 'alguma conexão precisa de atenção', state: closing.steps.data },
    { label: 'Conciliação', sub: reconciliationSub, state: closing.steps.reconciliation },
    { label: 'Categorias e metas', sub: `metas do mês seguinte`, state: closing.steps.goals },
    { label: 'Investimentos', sub: 'quanto está investido e o que mudou', state: closing.steps.investments },
  ];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Fechamento de {name}</h2>
        <p className="text-sm text-ink-2">
          {closing.remaining === 0 ? 'Tudo pronto para fechar o mês' : `Faltam ${closing.remaining} ${closing.remaining === 1 ? 'passo' : 'passos'} para fechar o mês`}
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-3">
            <StepIcon state={s.state} />
            <div className="flex flex-col">
              <span className={`text-[15px] ${s.state === 'attention' ? 'font-semibold text-ink' : s.state === 'done' ? 'text-ink-2' : 'text-ink-2'}`}>{s.label}</span>
              <span className="text-[13px] text-ink-3">{s.sub}</span>
            </div>
          </li>
        ))}
      </ol>
      <Link href={`/fechamento/${closing.month}`} className="flex items-center justify-center gap-2 rounded-[10px] bg-ink px-4 py-3 text-[15px] font-semibold text-white">
        Continuar fechamento <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

export function Installments({ installments }: { installments: DashboardView['installments'] }) {
  const months = installments.months.slice(0, 8);
  const max = Math.max(1, ...months.map((m) => m.cents));
  const last = [...months].reverse().find((m) => m.cents > 0);
  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>Parcelas a vencer</Eyebrow>
      <p className="flex items-end gap-2">
        <Money cents={installments.totalCents} className="text-[26px] leading-none font-medium" />
        {last !== undefined && <span className="text-sm text-ink-2">até {monthAbbr(last.month)}/{last.month.slice(0, 4)}</span>}
      </p>
      <div className="flex h-[110px] items-end gap-2.5" aria-label="Parcelas por mês">
        {months.map((m, i) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
            <div className={`w-full rounded-t ${i === 0 ? 'bg-ink' : 'bg-[#cfc9bd]'}`} style={{ height: `${Math.max(2, Math.round((m.cents / max) * 80))}px` }} title={formatBRL(m.cents)} />
            <span className="text-xs text-ink-2">{monthAbbr(m.month)}</span>
          </div>
        ))}
      </div>
      {months[0] !== undefined && months[0].cents > 0 && (
        <p className="text-[13px] leading-snug text-ink-2">
          {capitalize(monthName(months[0].month).split(' ')[0] as string)} já tem {formatBRL(months[0].cents)} comprometidos com compras parceladas.
        </p>
      )}
    </section>
  );
}

export function OpenBills({ bills }: { bills: DashboardView['openBills'] }) {
  if (bills.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>Faturas abertas</Eyebrow>
      {bills.map((b) => (
        <div key={b.accountId} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">{b.name}</span>
            <Money cents={b.cents} className="text-[15px] font-medium" />
          </div>
          {b.limitUsedPct !== null && (
            <div className="h-1 rounded-full bg-track" aria-hidden>
              <div className="h-1 rounded-full bg-ink-2" style={{ width: `${Math.min(100, b.limitUsedPct * 100)}%` }} />
            </div>
          )}
          <span className="text-[13px] text-ink-3">
            {[b.dueDate === null ? null : `vence ${formatDay(b.dueDate)}`, b.limitUsedPct === null ? null : `${formatPct(b.limitUsedPct)} do limite`]
              .filter((x) => x !== null)
              .join(' · ')}
          </span>
        </div>
      ))}
    </section>
  );
}
