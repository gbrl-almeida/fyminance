import type { RedemptionYields, YieldTotals } from '../../../queries/redemption-yields';
import { formatBRL, formatDay, formatPct } from '../../format';
import { Card } from '../bits';

const LINES: Array<{ label: string; value: (t: YieldTotals) => string; strong?: boolean }> = [
  { label: 'Bruto', value: (t) => formatBRL(t.grossCents) },
  { label: 'IOF', value: (t) => (t.unsplit > 0 && t.unsplit === t.count ? '—' : formatBRL(t.iofCents)) },
  { label: 'IR', value: (t) => (t.unsplit > 0 && t.unsplit === t.count ? '—' : formatBRL(t.irCents)) },
  { label: 'Imposto', value: (t) => `${formatBRL(t.taxCents)} · ${formatPct(t.taxPct, 1)}` },
  { label: 'Líquido', value: (t) => formatBRL(t.netCents), strong: true },
];

/** Rendimento dos resgates no mês e no ano, com os resgates do mês e as aplicações abertas. */
export function RedemptionYieldsCard({ view, monthLabel, year }: { view: RedemptionYields; monthLabel: string; year: string }) {
  const unsplit = view.year.unsplit;
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">Rendimento dos resgates</h2>
        <p className="text-[13px] text-ink-2">Quanto as aplicações renderam ao serem resgatadas e quanto foi de imposto. Inclui o CDB do C6, mesmo sendo caixa.</p>
      </div>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-[13px] text-ink-2">
            <th className="pb-2 text-left font-normal" />
            <th className="pb-2 text-right font-normal">{monthLabel}</th>
            <th className="pb-2 text-right font-normal">Em {year}</th>
          </tr>
        </thead>
        <tbody>
          {LINES.map((line) => (
            <tr key={line.label} className={`border-t border-line ${line.strong ? 'font-semibold' : ''}`}>
              <td className="py-2 text-left">{line.label}</td>
              <td className="num py-2 text-right">{line.value(view.month)}</td>
              <td className="num py-2 text-right">{line.value(view.year)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unsplit > 0 && (
        <p className="text-[13px] text-ink-2">
          Em {unsplit} {unsplit === 1 ? 'resgate' : 'resgates'}, o valor descontado pelo banco não bate com as tabelas de IR e IOF; ali só o imposto total entra.
        </p>
      )}
      {view.incomplete.length > 0 && <p className="text-[13px] text-attn">Cálculo incompleto em: {view.incomplete.join(', ')}.</p>}
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold">Resgates de {monthLabel.toLowerCase()} e aplicações abertas</h3>
        {view.rows.length === 0 && <p className="text-sm text-ink-2">Nenhum resgate nem aplicação aberta.</p>}
        <ul className="flex flex-col divide-y divide-line">
          {view.rows.map((row) =>
            row.kind === 'redeemed' ? (
              <li key={`r-${row.accountId}-${row.date}-${row.principalCents}`} className="flex flex-col gap-1 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-medium">{row.account}</span>
                  <span className="num shrink-0 text-[15px] font-semibold text-good">{formatBRL(row.netCents)}</span>
                </div>
                <span className="text-[13px] text-ink-3">
                  {[row.rate, `aplicado em ${formatDay(row.appliedOn)}`, `resgatado em ${formatDay(row.date)}`].filter(Boolean).join(' · ')}
                </span>
                <span className="num text-[13px] text-ink-2">
                  {formatBRL(row.principalCents)} resgatados · bruto {formatBRL(row.grossCents)} ·{' '}
                  {row.iofCents === null || row.irCents === null
                    ? `imposto ${formatBRL(row.taxCents)}`
                    : `IOF ${formatBRL(row.iofCents)} · IR ${formatBRL(row.irCents)}`}
                </span>
              </li>
            ) : (
              <li key={`o-${row.accountId}`} className="flex flex-col gap-1 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-medium">{row.account}</span>
                  <span className="num shrink-0 text-[15px] text-ink-2">{row.accruedCents === null ? '—' : `+${formatBRL(row.accruedCents)}`}</span>
                </div>
                <span className="text-[13px] text-ink-3">{[row.rate, `aplicado em ${formatDay(row.appliedOn)}`, 'rendendo'].filter(Boolean).join(' · ')}</span>
                <span className="num text-[13px] text-ink-2">{formatBRL(row.principalCents)} aplicados · rendimento bruto até agora, antes do imposto</span>
              </li>
            ),
          )}
        </ul>
      </div>
    </Card>
  );
}
