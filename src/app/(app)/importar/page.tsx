import { and, eq, isNull } from 'drizzle-orm';
import { accounts } from '../../../db/schema';
import { PARSERS } from '../../../integrations/files/statement';
import { Card } from '../../../web/components/bits';
import { TopBar } from '../../../web/components/top-bar';
import { getAppContext } from '../../../web/server/context';
import { UploadForm } from './upload-form';

export default async function ImportPage() {
  const app = getAppContext();
  const banks = Object.entries(PARSERS).map(([id, reader]) => ({ id, label: reader.label }));
  // Cartões sem conexão com a Pluggy: os que vieram de arquivo.
  const fileCards = app.db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.kind, 'credit_card'), isNull(accounts.connectionId)))
    .all();
  return (
    <>
      <TopBar path="/importar" />
      <main className="mx-auto flex max-w-[640px] flex-col gap-6 px-4 py-6 lg:py-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold">Importar fatura</h1>
          <p className="text-[15px] text-ink-2">
            Para quando a Pluggy não trouxer tudo: o CSV que o banco exporta, com o nome que ele dá ao arquivo (é dele que sai o vencimento). Importar o mesmo arquivo de
            novo não duplica nada.
          </p>
        </header>
        <Card>
          <UploadForm banks={banks} accounts={fileCards} />
        </Card>
      </main>
    </>
  );
}
