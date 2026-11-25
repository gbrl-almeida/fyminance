import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getClosingStatus } from '../../../../queries/closing';
import { ClosingNav } from '../../../../web/components/closing/closing-nav';
import { TopBar } from '../../../../web/components/top-bar';
import { formatDay, monthName, OWNER_LABEL } from '../../../../web/format';
import { getAppContext } from '../../../../web/server/context';

export default async function ClosingLayout({ children, params }: { children: ReactNode; params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  if (!/^\d{4}-\d{2}$/.test(mes)) notFound();
  const app = getAppContext();
  const status = getClosingStatus(app.db, mes, app.today(), app.dataDir);
  const by = status.closed?.by;
  return (
    <>
      <TopBar path={`/fechamento/${mes}`} />
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 lg:px-12 lg:py-10">
        <ClosingNav month={mes} states={status.steps} />
        {status.closed !== null && (
          <p className="flex items-center gap-2 rounded-[10px] bg-good-soft px-4 py-3 text-sm text-good">
            <CircleCheck className="size-4" />
            {monthName(mes).split(' ')[0]} foi fechado
            {by === 'anterior' ? ' antes do app' : ` em ${formatDay(status.closed.at.slice(0, 10))} por ${by === 'claude' ? 'Claude' : OWNER_LABEL[by ?? 'casal']}`}.
            <Link href={`/relatorios/${mes}`} className="font-semibold underline">
              Ver relatório
            </Link>
          </p>
        )}
        {children}
      </div>
    </>
  );
}
