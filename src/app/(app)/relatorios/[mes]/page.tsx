import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readDocument } from '../../../../curation/documents';
import { Card } from '../../../../web/components/bits';
import { ReportView } from '../../../../web/components/report-view';
import { TopBar } from '../../../../web/components/top-bar';
import { getAppContext } from '../../../../web/server/context';

export default async function ReportPage({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  if (!/^\d{4}-\d{2}$/.test(mes)) notFound();
  let markdown: string;
  try {
    markdown = readDocument(getAppContext().dataDir, `relatorios/${mes}.md`);
  } catch {
    notFound();
  }
  return (
    <>
      <TopBar path={`/relatorios/${mes}`} />
      <main className="mx-auto flex max-w-[860px] flex-col gap-6 px-4 py-6 lg:py-10">
        <Link href="/relatorios" className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Relatórios
        </Link>
        <Card className="lg:p-8">
          <ReportView markdown={markdown} />
        </Card>
      </main>
    </>
  );
}
