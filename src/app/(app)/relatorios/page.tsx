import Link from 'next/link';
import { listDocuments } from '../../../curation/documents';
import { Card } from '../../../web/components/bits';
import { TopBar } from '../../../web/components/top-bar';
import { capitalize, monthName } from '../../../web/format';
import { getAppContext } from '../../../web/server/context';

export default async function ReportsPage() {
  const app = getAppContext();
  const reports = listDocuments(app.dataDir).filter((d) => d.kind === 'relatorio');
  return (
    <>
      <TopBar path="/relatorios" />
      <main className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-6 lg:py-10">
        <h1 className="text-[28px] font-bold">Relatórios</h1>
        {reports.length === 0 && <p className="text-[15px] text-ink-2">Nenhum mês fechado ainda.</p>}
        <Card className="flex flex-col divide-y divide-line p-0 lg:p-0">
          {reports.map((r) => {
            const month = r.path.slice('relatorios/'.length, -'.md'.length);
            return (
              <Link key={r.path} href={`/relatorios/${month}`} className="px-5 py-4 text-[15px] font-medium hover:bg-canvas">
                {capitalize(monthName(month))}
              </Link>
            );
          })}
        </Card>
      </main>
    </>
  );
}
