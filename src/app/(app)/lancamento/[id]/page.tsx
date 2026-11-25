import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { listCategories } from '../../../../curation/categories';
import { getEntry, type Entry } from '../../../../queries/entry';
import { Card } from '../../../../web/components/bits';
import { BackLink } from '../../../../web/components/entry/back-link';
import { NoteEditor } from '../../../../web/components/entry/note-editor';
import { OffsetPanel } from '../../../../web/components/entry/offset-panel';
import { SplitEditor } from '../../../../web/components/entry/split-editor';
import { SearchField } from '../../../../web/components/search-field';
import { TopBar } from '../../../../web/components/top-bar';
import { TxOwnerCategory } from '../../../../web/components/tx-owner-category';
import { formatBRL, formatDay, OWNER_LABEL, REVIEW_REASON_LABEL } from '../../../../web/format';
import { getAppContext } from '../../../../web/server/context';

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { busca } = await searchParams;
  const search = typeof busca === 'string' ? busca.trim() : '';
  const app = getAppContext();
  let entry: Entry;
  try {
    entry = getEntry(app.db, decodeURIComponent(id), { search });
  } catch {
    notFound();
  }
  const categories = listCategories(app.db);
  const expenseOptions = categories.filter((c) => c.kind === 'expense').map((c) => ({ id: c.id, path: c.path }));
  const incomeOptions = categories.filter((c) => c.kind === 'income').map((c) => ({ id: c.id, path: `Renda · ${c.path}` }));
  const outflow = entry.amountCents < 0;
  const options = outflow ? expenseOptions : [...incomeOptions, ...expenseOptions.map((o) => ({ ...o, path: `Devolução · ${o.path}` }))];
  const path = `/lancamento/${encodeURIComponent(entry.id)}`;
  const transfer = entry.nature === 'transfer';
  const thisYear = app.today().slice(0, 4);
  const day = entry.date.slice(0, 4) === thisYear ? formatDay(entry.date) : `${formatDay(entry.date)} de ${entry.date.slice(0, 4)}`;
  const installments = entry.installment !== null;

  return (
    <>
      <TopBar path={path} />
      <main className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-6 lg:px-12 lg:py-10">
        <BackLink />
        <header className="flex flex-col gap-1">
          <p className="text-[13px] text-ink-2">
            {[day, entry.account, installments ? `parcela ${entry.installment}` : null, entry.status === 'pending' ? 'ainda não lançada pelo banco' : null]
              .filter((x) => x !== null)
              .join(' · ')}
          </p>
          <h1 className="text-[22px] font-bold wrap-anywhere lg:text-[26px]">{entry.description}</h1>
          <span className="num text-xl">
            {outflow ? '' : '+'}
            {formatBRL(Math.abs(entry.amountCents))}
          </span>
          {entry.reviewReason !== null && <span className="text-[13px] text-warn">Na revisão: {REVIEW_REASON_LABEL[entry.reviewReason]}</span>}
        </header>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Categoria e dono</h2>
          {transfer ? (
            <p className="text-sm text-ink-2">Transferência entre contas: não conta como gasto nem como renda.</p>
          ) : entry.split !== null ? (
            <p className="text-sm text-ink-2">Dividida em {entry.split.parts.length} partes; a categoria de cada uma está em “Dividir”.</p>
          ) : (
            <>
              <p className="text-[15px]">
                {entry.category ?? 'Sem categoria'} · {entry.owner === null ? 'Casal' : OWNER_LABEL[entry.owner]}
              </p>
              <TxOwnerCategory transactionIds={[entry.id]} categoryId={entry.categoryId} owner={entry.owner ?? 'casal'} options={options} path={path} />
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold">Anotação</h2>
            {entry.note !== null && (
              <p className="text-[13px] text-ink-3">
                por {OWNER_LABEL[entry.note.by as keyof typeof OWNER_LABEL] ?? entry.note.by} em {formatDay(entry.note.at.slice(0, 10))}
              </p>
            )}
          </div>
          <NoteEditor key={entry.note?.at ?? 'nova'} transactionId={entry.id} note={entry.note?.text ?? ''} path={path} />
        </Card>

        {outflow && !transfer && (
          <Card className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">Dividir</h2>
              <p className="text-sm text-ink-2">
                Para compras com mais de uma categoria, como Shopee e Mercado Livre.{installments ? ' A divisão vale para todas as parcelas desta compra.' : ''}
              </p>
            </div>
            <SplitEditor
              key={JSON.stringify(entry.split)}
              transactionId={entry.id}
              totalCents={-entry.amountCents}
              parts={entry.split?.parts ?? []}
              categoryId={entry.categoryId}
              owner={entry.owner ?? 'casal'}
              options={expenseOptions}
              path={path}
            />
          </Card>
        )}

        {entry.purchase !== null && (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">Estorno e reembolso</h2>
              <p className="text-sm text-ink-2">
                Ligue o estorno, ou o Pix de quem pagou de volta. O valor abatido sai do gasto no mês da compra.
              </p>
              <p className="text-[13px] text-ink-2">
                {[
                  installments ? `Compra inteira: ${formatBRL(entry.purchase.totalCents)}` : null,
                  entry.purchase.offsetCents > 0 ? `voltou ${formatBRL(entry.purchase.offsetCents)}` : null,
                  entry.purchase.offsetCents > 0 ? (entry.purchase.leftCents > 0 ? `falta ${formatBRL(entry.purchase.leftCents)}` : 'voltou tudo') : null,
                ]
                  .filter((x) => x !== null)
                  .join(' · ')}
              </p>
            </div>
            <CandidateSearch search={search} />
            <OffsetPanel mode="purchase" entryId={entry.id} leftCents={entry.purchase.leftCents} links={entry.purchase.links} candidates={entry.candidates} path={path} />
          </Card>
        )}

        {entry.credit !== null && (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold">Abater uma compra</h2>
              <p className="text-sm text-ink-2">Se este crédito é estorno ou reembolso de uma compra, ligue os dois: o valor sai do gasto no mês da compra.</p>
              {entry.credit.usedCents > 0 && (
                <p className="text-[13px] text-ink-2">
                  Usado {formatBRL(entry.credit.usedCents)} · {entry.credit.leftCents > 0 ? `sobra ${formatBRL(entry.credit.leftCents)}` : 'usado por inteiro'}
                </p>
              )}
            </div>
            <CandidateSearch search={search} />
            <OffsetPanel mode="credit" entryId={entry.id} leftCents={entry.credit.leftCents} links={entry.credit.links} candidates={entry.candidates} path={path} />
          </Card>
        )}
      </main>
    </>
  );
}

function CandidateSearch({ search }: { search: string }) {
  return (
    <form method="get" className="flex gap-2">
      <SearchField name="busca" defaultValue={search} placeholder="Buscar em todas as transações" className="flex-1" />
      <Button type="submit" variant="outline" className="h-9">
        Buscar
      </Button>
    </form>
  );
}
