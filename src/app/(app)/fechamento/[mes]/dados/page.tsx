import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getBalances } from '../../../../../queries/balances';
import { listTransactions } from '../../../../../queries/transactions';
import { Card, StepIcon } from '../../../../../web/components/bits';
import { StepHeader } from '../../../../../web/components/closing/step-header';
import { SearchField } from '../../../../../web/components/search-field';
import { formatBRL, formatDay, OWNER_LABEL, REVIEW_REASON_LABEL } from '../../../../../web/format';
import { getAppContext } from '../../../../../web/server/context';

const SEARCH_LIMIT = 50;

export default async function DataStep({ params, searchParams }: { params: Promise<{ mes: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { mes } = await params;
  const { busca } = await searchParams;
  const search = typeof busca === 'string' ? busca.trim() : '';
  const app = getAppContext();
  const today = app.today();
  const { connections } = getBalances(app.db, today);
  const found = search === '' ? null : listTransactions(app.db, { search, limit: SEARCH_LIMIT });
  const day = (date: string) => (date.slice(0, 4) === today.slice(0, 4) ? formatDay(date) : `${formatDay(date)} de ${date.slice(0, 4)}`);
  return (
    <main className="flex max-w-[896px] flex-col gap-6">
      <StepHeader month={mes} step={1} title="Dados atualizados" sub="Confira se as conexões com os bancos estão em dia antes de conciliar." />
      <Card className="flex flex-col gap-4">
        {connections.length === 0 && <p className="text-[15px] text-ink-2">Nenhuma conexão com banco ainda. Os dados vêm de lançamentos manuais e de faturas importadas.</p>}
        {connections.map((c) => (
          <div key={c.id} className="flex items-start gap-3">
            <StepIcon state={c.problems.length === 0 ? 'done' : 'attention'} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">
                {c.institution} · {OWNER_LABEL[c.owner]}
              </span>
              <span className="text-[13px] text-ink-3">
                {c.lastSuccessAt === null ? 'nunca sincronizou' : `última sincronização em ${formatDay(c.lastSuccessAt.slice(0, 10))}`}
              </span>
              {c.problems.map((p) => (
                <span key={p} className="text-[13px] text-warn">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Card>
      <Link href={`/fechamento/${mes}/conciliacao`} className="flex items-center justify-center gap-2 self-start rounded-[10px] bg-ink px-5 py-3 text-[15px] font-semibold text-white">
        Ir para a conciliação <ArrowRight className="size-4" />
      </Link>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold">Procurar uma transação</h2>
          <p className="text-sm text-ink-2">Para ver se algo já chegou dos bancos: busque por palavras da descrição, categoria, conta ou pelo valor.</p>
        </div>
        <form method="get" className="flex gap-2">
          <SearchField name="busca" defaultValue={search} className="flex-1" />
          <Button type="submit" variant="outline" className="h-9">
            Buscar
          </Button>
        </form>
        {found !== null && found.total === 0 && <p className="text-sm text-ink-2">Nada encontrado com “{search}”.</p>}
        {found !== null && found.total > 0 && (
          <>
            <p className="text-[13px] text-ink-3">
              {found.total > SEARCH_LIMIT ? `${SEARCH_LIMIT} mais recentes de ${found.total}` : `${found.total} ${found.total === 1 ? 'transação' : 'transações'}`}
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {found.items.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/lancamento/${encodeURIComponent(t.id)}`} title={t.description} className="truncate text-sm hover:underline">
                      {t.description}
                    </Link>
                    {t.note !== null && <span className="text-[13px] text-ink-2 italic wrap-anywhere">{t.note}</span>}
                    <span className="text-xs text-ink-3">
                      {[day(t.date), t.account, t.installment === null ? null : `parcela ${t.installment}`, t.status === 'pending' ? 'ainda não lançada pelo banco' : null]
                        .filter((x) => x !== null)
                        .join(' · ')}
                    </span>
                    <span className={`text-xs ${t.reviewReason === null ? 'text-ink-2' : 'text-warn'}`}>
                      {t.nature === 'transfer'
                        ? 'transferência'
                        : [t.reviewReason === null ? null : `a revisar: ${REVIEW_REASON_LABEL[t.reviewReason]}`, t.category, t.owner === null ? null : OWNER_LABEL[t.owner]]
                            .filter((x) => x !== null)
                            .join(' · ')}
                    </span>
                  </div>
                  <span className="num shrink-0 text-sm">
                    {t.amountCents > 0 ? '+' : ''}
                    {formatBRL(Math.abs(t.amountCents))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </main>
  );
}
